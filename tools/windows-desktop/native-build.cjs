'use strict';
// Compile the same canonical Native entrypoint from the exact staged Git SHA.
// No live-source mutation: Vite output belongs to ignored out/ in the isolated candidate.
const { spawn } = require('node:child_process');
const { existsSync, lstatSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { dependencies } = require('./checkout.cjs');
const OUTPUT = join('out','windows-desktop-native');
function hasNativeBundle(sourceRoot) {
  try {
    const root=join(sourceRoot,OUTPUT);
    const htmlPath=join(root,'system','composition','native','index.html');
    if(!lstatSync(htmlPath).isFile()) return false;
    const html=readFileSync(htmlPath,'utf8');
    // A source-tree entry is not an acceptable installed/candidate artifact.
    if(/<script\s+type="module"\s+src="\.\/main\.mjs"/.test(html))return false;
    const matches=[...html.matchAll(/\/__ordax\/desktop-assets\/assets\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.(?:js|css|png|svg|webp|woff2))/g)];
    if(!matches.some(([,file])=>file.endsWith('.js')))return false;
    const assetRoot=join(root,'assets');
    if(!lstatSync(assetRoot).isDirectory())return false;
    return matches.every(([,file])=>{
      const item=join(assetRoot,file);
      const stat=lstatSync(item);
      return stat.isFile() && stat.size>0;
    });
  } catch { return false; }
}
async function buildNativeCandidate(root,template,{log=()=>{},timeoutMs=120000}={}) {
  const config=join(root,'tools','windows-desktop','vite-native-build.mjs');
  const vite=join(template,'node_modules','vite','bin','vite.js');
  if(!existsSync(config) || !existsSync(vite)) {
    throw Error('Staged source or installed toolchain cannot compile canonical Native Surface');
  }
  dependencies(root,template);
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[vite,'build','--config',config],{
      cwd:root,windowsHide:true,
      env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},
      stdio:['ignore','pipe','pipe'],
    });
    let output='',settled=false;
    const cleanup=()=>clearTimeout(timer);
    const finish=error=>{
      if(settled)return;settled=true;cleanup();
      if(error)reject(error);else resolve();
    };
    const capture=chunk=>{output=(output+String(chunk)).slice(-1800);};
    const timer=setTimeout(()=>{
      child.kill('SIGTERM');
      finish(Error('Canonical Native candidate compilation exceeded bounded timeout'));
    },timeoutMs);
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    child.once('error',e=>finish(Error('Cannot spawn canonical Native compiler: '+e.message)));
    child.once('close',code=>finish(code===0?null:Error('Canonical Native compiler rejected candidate: '+output.slice(-400))));
  });
  if(!hasNativeBundle(root))throw Error('Compiled Native assets missing or invalid in staged Git source');
  log('Verified staged canonical Native compilation');
}
module.exports={hasNativeBundle,buildNativeCandidate,OUTPUT};
