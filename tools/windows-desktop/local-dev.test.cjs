'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
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
