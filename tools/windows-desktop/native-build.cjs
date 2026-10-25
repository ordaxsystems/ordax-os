'use strict';
// Compile the same canonical Native entrypoint from the exact staged Git SHA.
// No live-source mutation: Vite output belongs to ignored out/ in the isolated candidate.
const { spawn } = require('node:child_process');
const { existsSync, lstatSync, readFileSync, writeFileSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { dependencies } = require('./checkout.cjs');
const { withPinnedSurface, pinnedSourceLock } = require('./surface-stage.cjs');
const OUTPUT = join('out','windows-desktop-native');
// The actual compiled assets, not only their names, are bound to the pinned
// OS+Surface release receipt. A modified ignored out/ file must never boot.
function compiledBundleSha256(sourceRoot) {
  const root=join(sourceRoot,OUTPUT);
  const manifest=createHash('sha256');
  const html=join(root,'system','composition','native','index.html');
  const htmlStat=lstatSync(html);
  if(!htmlStat.isFile()||htmlStat.isSymbolicLink()||htmlStat.size<1||htmlStat.size>4*1024*1024)
    throw Error('Invalid Native compiled HTML');
  const htmlBytes=readFileSync(html);
  manifest.update('system/composition/native/index.html\\0');
  manifest.update(createHash('sha256').update(htmlBytes).digest());
  const assets=join(root,'assets');
  if(!lstatSync(assets).isDirectory())throw Error('Missing compiled assets');
  const queue=[{absolute:assets,relative:'assets',depth:0}];
  const records=[];let total=htmlBytes.length;
  while(queue.length) {
    const {absolute,relative,depth}=queue.shift();
    for(const entry of readdirSync(absolute,{withFileTypes:true})) {
      const path=join(absolute,entry.name),name=relative+'/'+entry.name;
      if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/.test(entry.name))
        throw Error('Unsafe compiled asset name');
      const stat=lstatSync(path);
      if(stat.isSymbolicLink())throw Error('Linked compiled asset refused');
      if(stat.isDirectory()) {
        if(depth>=5)throw Error('Compiled asset nesting limit exceeded');
        queue.push({absolute:path,relative:name,depth:depth+1});
      } else if(stat.isFile()) {
        if(stat.size<1||stat.size>32*1024*1024)throw Error('Invalid compiled asset size');
        total+=stat.size;
        if(total>512*1024*1024||records.length>=3000)
          throw Error('Compiled bundle exceeds bounds');
        const bytes=readFileSync(path);
        records.push([name,createHash('sha256').update(bytes).digest()]);
      } else throw Error('Unsupported compiled asset');
    }
  }
  if(!records.length)throw Error('Compiled bundle has no assets');
  records.sort(([a],[b])=>a<b?-1:a>b?1:0);
  for(const [name,digest] of records) {
    manifest.update(name+'\\0');
    manifest.update(digest);
  }
  return manifest.digest('hex');
}

function hasNativeBundle(sourceRoot) {
  try {
    const root=join(sourceRoot,OUTPUT);
    const htmlPath=join(root,'system','composition','native','index.html');
    if(!lstatSync(htmlPath).isFile()) return false;
    // External visual source and OS source must remain paired to exact commits.
    // An installed update is never source-only: exact OS + external Surface
    // identity is mandatory. The bundled installer fallback has its own gate.
    const lock=pinnedSourceLock(sourceRoot);
    const receipt=JSON.parse(readFileSync(join(root,'surface-source-receipt.json'),'utf8'));
    if(receipt.schema!=='ordax.surface-source-materialization/1' ||
       receipt.source_commit!==lock.source_commit ||
       receipt.source_repository!==lock.source_repository ||
       !/^[0-9a-f]{64}$/.test(receipt.visual_source_sha256) ||
       !Number.isInteger(receipt.file_count)||receipt.file_count<1 ||
       receipt.bundle_sha256!==compiledBundleSha256(sourceRoot)) return false;
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
  const receipt=await withPinnedSurface(root,sourceReceipt=>new Promise((resolve,reject)=>{
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
  }).then(()=>sourceReceipt));
  writeFileSync(join(root,OUTPUT,'surface-source-receipt.json'),
    JSON.stringify({...receipt,bundle_sha256:compiledBundleSha256(root)})+'\n',{flag:'wx'});
  if(!hasNativeBundle(root))throw Error('Compiled Native assets missing or invalid in staged Git source');
  log('Verified staged canonical Native compilation');
}
module.exports={hasNativeBundle,compiledBundleSha256,buildNativeCandidate,OUTPUT};
