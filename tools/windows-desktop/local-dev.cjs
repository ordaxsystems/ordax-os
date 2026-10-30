'use strict';
// Developer-only Windows entrypoint: link the canonical Surface checkout;
// never copy visual source into OS or change packaged release verification.
const {existsSync,lstatSync,readFileSync,realpathSync,symlinkSync,mkdirSync}=require('node:fs');
const {resolve,join,dirname}=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const root=resolve(__dirname,'../..');
const source=resolve(process.env.ORDAX_SURFACE_CHECKOUT||join(root,'..','ordax-surface'));
const lock=JSON.parse(readFileSync(join(root,'docs/contracts/surface-source.json'),'utf8'));
const fail=message=>{throw Error('OrdaX local development: '+message)};
function git(...args){return execFileSync('git',['-C',source,...args],{encoding:'utf8',windowsHide:true}).trim()}
function prepare(){
  if(lock.source_repository!=='ordaxsystems/ordax-surface')fail('unrecognized visual owner');
  if(!existsSync(join(source,'.git')))fail('canonical ordax-surface checkout required: '+source);
  if(!/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)ordaxsystems\/ordax-surface(?:\.git)?$/i.test(git('remote','get-url','origin')))
    fail('Surface origin does not match the canonical repository');
  if(git('rev-parse','HEAD')!==lock.source_commit)
    fail('Surface checkout must start from pinned '+lock.source_commit+'; current '+git('rev-parse','HEAD'));
  if(!existsSync(join(root,'node_modules','vite','bin','vite.js')))fail('run npm ci at repository root');
  if(!existsSync(join(__dirname,'node_modules','electron','path.txt')))fail('Electron binary missing; complete npm ci in tools/windows-desktop');
  for(const segment of ['ui','workspace']){
    const target=join(source,'system','surface',segment);
    const link=join(root,'system','surface',segment);
    if(!lstatSync(target).isDirectory())fail('missing Surface source '+segment);
    if(existsSync(link)){
      if(realpathSync(link)!==realpathSync(target))fail('refusing to replace existing visual path '+link);
    }else{
      mkdirSync(dirname(link),{recursive:true});
      symlinkSync(target,link,'junction');
    }
  }
  return source;
}
if(require.main===module){
  try {
    const checkout=prepare();
    console.log('Canonical Surface linked for HMR: '+checkout);
    const child=spawn(process.execPath,[join(__dirname,'node_modules','electron','cli.js'),__dirname],{
      cwd:__dirname,env:{...process.env,ORDAX_DESKTOP_LOCAL_DEV:'1',ORDAX_DESKTOP_SURFACE_ROOT:checkout},stdio:'inherit',windowsHide:false});
    child.on('exit',code=>process.exitCode=code??1);
    child.on('error',err=>{console.error(err);process.exitCode=1});
  }catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={prepare};
