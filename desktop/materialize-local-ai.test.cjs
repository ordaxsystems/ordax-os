'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {verifyPinnedVcSource}=require('./materialize-local-ai.cjs');

test('accepts only the exact three OS-pinned app-local CRT files', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-vc143-source-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const files=['msvcp140.dll','vcruntime140.dll','vcruntime140_1.dll'].map(name=>{
    const data=Buffer.from('test-only-Microsoft-placeholder:'+name);
    fs.writeFileSync(path.join(dir,name),data);
    return {name,size_bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  });
  assert.equal(verifyPinnedVcSource(dir,files),true);
  fs.writeFileSync(path.join(dir,'vcruntime140_1.dll'),'tamper');
  assert.throws(()=>verifyPinnedVcSource(dir,files),/mismatched/);
  assert.throws(()=>verifyPinnedVcSource(dir,files.slice(0,2)),/incomplete/);
  assert.throws(()=>verifyPinnedVcSource('',files),/directory required/);
});
