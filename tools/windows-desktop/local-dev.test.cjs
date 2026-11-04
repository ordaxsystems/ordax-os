'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync,existsSync,lstatSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,dirname}=require('node:path');
const entry=join(__dirname,'local-dev.cjs');
test('local Desktop refuses a missing independent visual checkout',()=>{
  const missing=join(tmpdir(),'ordax-nonexistent-surface-'+process.pid);
  const r=spawnSync(process.execPath,[entry],{encoding:'utf8',env:{...process.env,ORDAX_SURFACE_CHECKOUT:missing}});
  assert.equal(r.status,1);
  assert.match(r.stderr,/canonical ordax-surface checkout required/);
});
test('local Desktop rejects a wrong Git visual owner before creating junctions',()=>{
  const temporary=mkdtempSync(join(tmpdir(),'ordax-surface-invalid-'));
  try{
    const git=spawnSync('git',['init',temporary],{encoding:'utf8'});
    assert.equal(git.status,0,git.stderr);
    const add=spawnSync('git',['-C',temporary,'remote','add','origin','https://github.com/example/other-surface.git'],{encoding:'utf8'});
    assert.equal(add.status,0,add.stderr);
    const r=spawnSync(process.execPath,[entry],{encoding:'utf8',env:{...process.env,ORDAX_SURFACE_CHECKOUT:temporary}});
    assert.equal(r.status,1);
    assert.match(r.stderr,/Surface origin does not match/);
  }finally{rmSync(temporary,{recursive:true,force:true})}
});

function runGit(root,...args){
  const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
  assert.equal(r.status,0,r.stderr);
  return r.stdout.trim();
}
function makeDetachedFixture(){
  const outer=mkdtempSync(join(tmpdir(),'ordax-detached-dev-'));
  const root=join(outer,'ordax-os'),surface=join(outer,'ordax-surface');
  mkdirSync(root);mkdirSync(surface);
  function put(base,file,content='x'){
    const path=join(base,file);
    mkdirSync(dirname(path),{recursive:true});
    writeFileSync(path,content);
  }
  for(const [dir,origin] of [[root,'https://github.com/ordaxsystems/ordax-os.git'],
    [surface,'https://github.com/ordaxsystems/ordax-surface.git']]){
    runGit(dir,'init','-q');
    runGit(dir,'config','user.name','OrdaX Test');
    runGit(dir,'config','user.email','ordax-detached@invalid.example');
    runGit(dir,'remote','add','origin',origin);
  }
  put(surface,'system/surface/ui/view.mjs','export const x=1');
  put(surface,'system/surface/workspace/edit.mjs','export const y=2');
  runGit(surface,'add','.');runGit(surface,'commit','-qm','Exact pinned visual fixture');
  const visualSha=runGit(surface,'rev-parse','HEAD');
  const authority=readFileSync(join(__dirname,'../../docs/contracts/distribution-profiles.json'),'utf8');
  put(root,'docs/contracts/distribution-profiles.json',authority);
  put(root,'docs/contracts/surface-source.json',JSON.stringify({
    $schema:'prototype-ordax.surface-source/1',status:'canonical',
    source_repository:'ordaxsystems/ordax-surface',source_commit:visualSha,
    visual_source_paths:['system/surface/ui','system/surface/workspace'],
  }));
  put(root,'system/composition/native/index.html','<!doctype html>');
  put(root,'node_modules/vite/bin/vite.js','// fixture only; never executed');
  runGit(root,'add','docs','system');
  runGit(root,'commit','-qm','Canonical OS local fixture');
  const environment={...process.env,ORDAX_DESKTOP_OS_CHECKOUT:root,
    ORDAX_SURFACE_CHECKOUT:surface};
  return {outer,root,surface,visualSha,put,environment,
    cleanup:()=>rmSync(outer,{recursive:true,force:true})};
}
test('detached Electron shell mounts pinned Surface in independent OS checkout',()=>{
  const f=makeDetachedFixture();
  try{
    const script='const {prepare}=require('+JSON.stringify(entry)+');console.log("DETACHED_SURFACE="+prepare())';
    const r=spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:f.environment});
    assert.equal(r.status,0,r.stderr);
    assert.match(r.stdout,/DETACHED_SURFACE=/);
    for(const name of ['ui','workspace']){
      const mounted=join(f.root,'system','surface',name);
      assert.equal(lstatSync(mounted).isSymbolicLink(),true,
        'HMR mount must stay a junction, not a copied visual implementation');
    }
    // Running again must reuse those exact junctions, never overwrite them.
    const second=spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:f.environment});
    assert.equal(second.status,0,second.stderr);
  }finally{f.cleanup()}
});
test('detached OS checkout rejects untrusted Git origin before visual mounts',()=>{
  const f=makeDetachedFixture();
  try {
    runGit(f.root,'remote','set-url','origin','https://github.com/attacker/fake-os.git');
    const r=spawnSync(process.execPath,[entry],{encoding:'utf8',env:f.environment});
    assert.equal(r.status,1);
    assert.match(r.stderr,/OS origin does not match/);
    assert.equal(existsSync(join(f.root,'system/surface/ui')),false);
  }finally{f.cleanup()}
});
test('detached OS checkout refuses relative paths and incompatible Surface locks',()=>{
  const f=makeDetachedFixture();
  try {
    const relative=spawnSync(process.execPath,[entry],{
      encoding:'utf8',env:{...f.environment,ORDAX_DESKTOP_OS_CHECKOUT:'./ordax-os'}});
    assert.equal(relative.status,1);
    assert.match(relative.stderr,/absolute path/);
    f.put(f.root,'docs/contracts/surface-source.json',JSON.stringify({
      $schema:'prototype-ordax.surface-source/1',status:'legacy',
      source_repository:'ordaxsystems/ordax-surface',source_commit:f.visualSha,
      visual_source_paths:['system/surface/ui','system/surface/workspace'],
    }));
    const invalid=spawnSync(process.execPath,[entry],{encoding:'utf8',env:f.environment});
    assert.equal(invalid.status,1);
    assert.match(invalid.stderr,/unrecognized canonical visual source lock/);
    assert.equal(existsSync(join(f.root,'system/surface/ui')),false);
  }finally{f.cleanup()}
});
