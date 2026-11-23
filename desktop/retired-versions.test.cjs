'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,existsSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {writeState,sweepRetiredVersions}=require('./dev-update.cjs');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
test('retired version cleanup preserves active and rollback, deletes only unreferenced SHA',()=>{
 const root=mkdtempSync(join(tmpdir(),'ordax-retire-'));
 try{
  writeState(root,{schema:'ordax.desktop-dev-update-state/1',activeSha:A,previousSha:B,pendingSha:null,attemptedSha:null,pinnedSha:null,rejectedSha:null,incompatibleSha:null});
  for(const sha of [A,B,C])mkdirSync(join(root,'runtime-versions',sha),{recursive:true});
  const result=sweepRetiredVersions(root);
  assert.equal(result.removed,1);
  assert.equal(existsSync(join(root,'runtime-versions',A)),true);
  assert.equal(existsSync(join(root,'runtime-versions',B)),true);
  assert.equal(existsSync(join(root,'runtime-versions',C)),false);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('Windows retired sharing violations back off without suppressing a later verified deletion',()=>{
 const root=mkdtempSync(join(tmpdir(),'ordax-retire-lock-'));
 try{
  writeState(root,{schema:'ordax.desktop-dev-update-state/1',
   activeSha:A,previousSha:null,pendingSha:null,attemptedSha:null,
   pinnedSha:null,rejectedSha:null,incompatibleSha:null});
  for(const sha of [A,C])mkdirSync(join(root,'runtime-versions',sha),{recursive:true});
  let clock=0, attempts=0, locked=true;
  const logs=[];
  const removeVersion=(path,options)=>{
    attempts++;
    if(locked)throw Object.assign(Error('directory handle still in use'),{code:'EPERM'});
    rmSync(path,options);
  };
  const sweep=()=>sweepRetiredVersions(root,{
    log:value=>logs.push(value),now:()=>clock,removeVersion,
  });
  assert.deepEqual(sweep(),{removed:0,deferred:1});
  assert.equal(attempts,1);
  assert.match(logs[0],/EPERM.*directory handle still in use.*next retry in 1m/);
  clock=30_000;
  assert.deepEqual(sweep(),{removed:0,deferred:1});
  assert.equal(attempts,1,'avoid another real delete during a known Windows handle lock');
  assert.equal(logs.length,1,'avoid minute-by-minute log noise');
  clock=60_001;
  assert.deepEqual(sweep(),{removed:0,deferred:1});
  assert.equal(attempts,2);
  assert.match(logs[1],/next retry in 2m/);
  clock=120_000;
  assert.deepEqual(sweep(),{removed:0,deferred:1});
  assert.equal(attempts,2);
  locked=false;
  clock=180_002;
  assert.deepEqual(sweep(),{removed:1,deferred:0});
  assert.equal(attempts,3);
  assert.equal(existsSync(join(root,'runtime-versions',C)),false);
  assert.equal(existsSync(join(root,'runtime-versions',A)),true,
    'the active Native revision must remain untouched');
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('retired cleanup refuses unexpected dependency directories without deleting them',()=>{
 const root=mkdtempSync(join(tmpdir(),'ordax-retire-'));
 try{
  writeState(root,{schema:'ordax.desktop-dev-update-state/1',activeSha:A,previousSha:B,pendingSha:null,attemptedSha:null,pinnedSha:null,rejectedSha:null,incompatibleSha:null});
  mkdirSync(join(root,'runtime-versions',D,'node_modules'),{recursive:true});
  writeFileSync(join(root,'runtime-versions',D,'node_modules','keep.txt'),'preserve');
  const result=sweepRetiredVersions(root);
  assert.equal(result.deferred,1);
  assert.equal(existsSync(join(root,'runtime-versions',D,'node_modules','keep.txt')),true);
 }finally{rmSync(root,{recursive:true,force:true})}
});
