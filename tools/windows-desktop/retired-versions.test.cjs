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
