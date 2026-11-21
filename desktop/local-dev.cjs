'use strict';
// One same-commit OS checkout supplies Electron, Native and Surface.
const {existsSync,lstatSync}=require('node:fs');
const {join}=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {resolveInstalledGit}=require('./checkout.cjs');
const {developmentOsRoot}=require('./runtime.cjs');
function prepare(){
  const root=developmentOsRoot(__dirname);
  const git=(...args)=>execFileSync(resolveInstalledGit({resourcesPath:''}),
    ['-c','credential.helper=','-C',root,...args],{
      encoding:'utf8',windowsHide:true,timeout:15000,
      env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
    }).trim();
  if(!existsSync(join(root,'.git')))throw Error('Canonical OS checkout required');
  const origin=git('remote','get-url','origin');
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ordaxsystems\/ordax-os(?:\.git)?$/i.test(origin)
      || git('rev-parse','--show-prefix')!=='')
    throw Error('Desktop development requires canonical OS Git root');
  const lock=require(join(root,'docs/contracts/surface-source.json'));
  if(lock.$schema!=='prototype-ordax.surface-source/2' ||
      lock.status!=='canonical' || lock.source_repository!=='ordaxsystems/ordax-os' ||
      lock.source_ref!=='same-commit' || lock.source_policy!=='tracked-git-blobs-only' ||
      JSON.stringify(lock.visual_source_paths)!==
        JSON.stringify(['system/surface/ui','system/surface/workspace']))
    throw Error('Same-commit Surface contract unavailable');
  for(const path of lock.visual_source_paths){
    const stat=lstatSync(join(root,path));
    if(!stat.isDirectory()||stat.isSymbolicLink())
      throw Error('Native Surface must be a real directory in OS: '+path);
  }
  if(!existsSync(join(root,'node_modules','vite','bin','vite.js')))
    throw Error('Install OS root dependencies first');
  if(!existsSync(join(__dirname,'node_modules','electron','path.txt')))
    throw Error('Install Desktop dependencies first');
  return root;
}
if(require.main===module){
  try{
    const root=prepare();
    const child=spawn(process.execPath,[join(__dirname,'node_modules','electron','cli.js'),__dirname],{
      cwd:__dirname,env:{...process.env,ORDAX_DESKTOP_LOCAL_DEV:'1',
        ORDAX_DESKTOP_MCP_DEV:'1',ORDAX_DESKTOP_OS_CHECKOUT:root},stdio:'inherit'});
    child.on('exit',code=>process.exitCode=code??1);
    child.on('error',err=>{console.error(err);process.exitCode=1});
  }catch(err){console.error(err.message);process.exitCode=1}
}
module.exports={prepare};
