'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {verifyPinnedVcSource}=require('./materialize-local-ai.cjs');

test('CLI Local AI materializer reads same-commit OS source lock', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-ai-root-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const nonexistent=path.join(dir,'unavailable');
  const result=spawnSync(process.execPath, [path.join(__dirname,'materialize-local-ai.cjs'),
    nonexistent,nonexistent,path.join(dir,'out'),nonexistent], {
    encoding:'utf8',windowsHide:true,
  });
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/candidate-receipt\.json/);
  assert.doesNotMatch(result.stderr,/source-lock\.json/);
});

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
