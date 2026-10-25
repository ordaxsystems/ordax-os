'use strict';
// Offline contract/E2E: two real Git OS commits, two genuine pinned Surface
// commits, the actual Vite compiler and immutable Dev activation/rollback.
// No fixture is allowed to contact GitHub or alter the installed user profile.
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync}=require('node:fs');
const {join,dirname}=require('node:path');
const {tmpdir}=require('node:os');
const {OFFICIAL_REMOTE}=require('./runtime.cjs');
const {git}=require('./checkout.cjs');
const {withVerifiedSurface}=require('./surface-stage.cjs');
const {buildNativeCandidate,hasNativeBundle,compiledBundleSha256}=require('./native-build.cjs');
const {stageMain,readState,chooseBootVersion,confirmHealthy,pinPrevious,versionRoot}=require('./dev-update.cjs');

function gitCommand(cwd,...args) {
  const result=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true,
    env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
  if(result.status!==0)throw Error('Local Git fixture failed '+args.join(' ')+': '+result.stderr);
  return result.stdout.trim();
}
function put(root,path,content) {
  const target=join(root,path);mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,content);
}
function initGit(root,origin) {
  mkdirSync(root,{recursive:true});
  gitCommand(root,'init','-q','-b','main');
  gitCommand(root,'config','user.name','OrdaX Offline Contract');
  gitCommand(root,'config','user.email','ordax-fixture@invalid.example');
  gitCommand(root,'config','core.autocrlf','false');
  gitCommand(root,'remote','add','origin',origin);
}
function commit(root,message) {
  gitCommand(root,'add','.');
  gitCommand(root,'commit','-qm',message);
  return gitCommand(root,'rev-parse','HEAD');
}
function surfaceLock(commitSha) {
  return JSON.stringify({$schema:'prototype-ordax.surface-source/1',status:'canonical',
    source_repository:'ordaxsystems/ordax-surface',source_commit:commitSha,
    visual_source_paths:['system/surface/ui','system/surface/workspace']});
}
function surfaceFiles(root,revision) {
  put(root,'system/surface/ui/panel.mjs',
    'import { title } from "../workspace/brand.mjs";\nexport const label=title+"-'+revision+'";\n');
  put(root,'system/surface/workspace/brand.mjs','export const title="OrdaX";\n');
}
function osFiles(root,lock,revision) {
  put(root,'docs/contracts/surface-source.json',surfaceLock(lock));
  put(root,'system/composition/native/index.html',
    '<!doctype html><html><head><meta charset="utf-8"></head><body>'+
    '<script type="module" src="./main.mjs"></script></body></html>\n');
  put(root,'system/composition/native/main.mjs',
    'import {label} from "../../surface/ui/panel.mjs";\n'+
    'document.body.dataset.ordax=label+"-os-'+revision+'";\n');
  put(root,'system/surface/bridge.mjs','// Native adapter owner; not a visual source.\n');
  put(root,'tools/windows-emulator/dev-supervisor.mjs','// canonical host in isolated fixture\n');
  put(root,'tools/windows-emulator/desktop-host-contract.json',JSON.stringify({
    schema:1,desktopHost:{contractVersion:1,
      nativeSource:'system/composition/native/index.html',
      capabilities:['no-external-browser','dynamic-loopback-port','external-state-directory']}
  }));
  put(root,'tools/surface-web/README.md','isolated minimal build fixture');
  put(root,'tools/windows-desktop/vite-native-build.mjs',
    'import {resolve} from "node:path";\n'+
    'import {fileURLToPath} from "node:url";\n'+
    'import {defineConfig} from "vite";\n'+
    'const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));\n'+
    'export default defineConfig({root,publicDir:false,base:"/__ordax/desktop-assets/",\n'+
    'build:{outDir:resolve(root,"out/windows-desktop-native"),emptyOutDir:true,\n'+
    'rollupOptions:{input:resolve(root,"system/composition/native/index.html")}}});\n');
  put(root,'.gitignore','node_modules/\nout/\n');
}
test('Windows Dev stages and compiles two real OS/Surface revisions then rolls back verified SHA',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-dev-real-build-'));
  t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:150}));
  const original=join(root,'original-os'), visual=join(root,'original-surface');
  const userData=join(root,'userdata');
  const template=join(__dirname,'../..');
  initGit(visual,'https://github.com/ordaxsystems/ordax-surface.git');
  surfaceFiles(visual,'one');
  const surfaceOne=commit(visual,'First verified Surface');
  initGit(original,OFFICIAL_REMOTE);
  osFiles(original,surfaceOne,'one');
  const osOne=commit(original,'First canonical OS');
  let buildCount=0;
  const offlineGit=async(args,cwd,timeout)=>{
    if(args[0]==='ls-remote')
      return {ok:true,stdout:gitCommand(original,'rev-parse','HEAD')+'\trefs/heads/main'};
    if(args[0]==='clone'){
      const dest=args.at(-1);
      gitCommand(root,'clone','--quiet','--no-hardlinks',original,dest);
      gitCommand(dest,'remote','set-url','origin',OFFICIAL_REMOTE);
      return {ok:true,stdout:''};
    }
    return git(args,cwd,timeout);
  };
  const compile=async(stage,installed,options)=>{
    buildCount++;
    await buildNativeCandidate(stage,installed,{...options,timeoutMs:120000,
      materializeSurface:async(osRoot,fn)=>{
        const src=join(root,'surface-checkout-'+buildCount);
        gitCommand(root,'clone','--quiet','--no-hardlinks',visual,src);
        gitCommand(src,'remote','set-url','origin','https://github.com/ordaxsystems/ordax-surface.git');
        const lock=JSON.parse(readFileSync(join(osRoot,'docs/contracts/surface-source.json'),'utf8'));
        gitCommand(src,'checkout','--quiet','--detach',lock.source_commit);
        return withVerifiedSurface(osRoot,src,fn);
      }});
  };
  const update=()=>stageMain({userData,template,runGit:offlineGit,buildCandidate:compile});
  let stage=await update();
  assert.equal(stage.status,'staged');assert.equal(stage.sha,osOne);
  assert.equal(buildCount,1);assert.equal(readState(userData).activeSha,null);
  const one=versionRoot(userData,osOne);
  assert.equal(hasNativeBundle(one),true);
  const bytesOne=compiledBundleSha256(one);
  assert.equal(existsSync(join(one,'system/surface/ui')),false,'visual source must not be retained');
  let boot=await chooseBootVersion({userData,template});
  assert.equal(boot.trial,true);assert.equal(boot.sha,osOne);
  confirmHealthy(userData,osOne);
  assert.equal((await chooseBootVersion({userData,template})).sha,osOne);
  surfaceFiles(visual,'two');
  const surfaceTwo=commit(visual,'Second verified Surface');
  osFiles(original,surfaceTwo,'two');
  const osTwo=commit(original,'Second canonical OS');
  stage=await update();
  assert.equal(stage.status,'staged');assert.equal(stage.sha,osTwo);
  assert.equal(buildCount,2);
  const two=versionRoot(userData,osTwo);
  assert.ok(hasNativeBundle(two));
  assert.notEqual(compiledBundleSha256(two),bytesOne,'visual/OS revision must change compiled bytes');
  assert.equal(hasNativeBundle(one),true,'first revision must remain verified');
  boot=await chooseBootVersion({userData,template});
  assert.equal(boot.sha,osTwo);assert.equal(boot.trial,true);
  assert.equal(readState(userData).activeSha,osOne,'trial is not promoted early');
  confirmHealthy(userData,osTwo);
  assert.equal(readState(userData).previousSha,osOne);
  assert.equal((await chooseBootVersion({userData,template})).sha,osTwo);
  await pinPrevious(userData,template);
  assert.equal(readState(userData).activeSha,osOne);
  assert.equal(readState(userData).pinnedSha,osOne);
  assert.equal((await chooseBootVersion({userData,template})).sha,osOne);
  assert.equal((await update()).status,'pinned');
  assert.ok(hasNativeBundle(two),'rollback preserves later revision without changing it');
});
