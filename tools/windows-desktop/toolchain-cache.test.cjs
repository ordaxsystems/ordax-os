'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync,renameSync,symlinkSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {archiveReceipt,ensureRuntimeToolchain,calculateTreeDigest}=require('./toolchain-cache.cjs');
const hash=data=>createHash('sha256').update(data).digest('hex');
const run=(args)=>{
  const p=spawnSync('tar',args,{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(p.status,0,p.stderr||p.error?.message);
};
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'ordax-packed-toolchain-'));
  t.after(()=>rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:120}));
  const build=join(root,'build'),template=join(root,'template'),profile=join(root,'user');
  const modules=join(build,'node_modules');
  mkdirSync(join(modules,'vite','bin'),{recursive:true});
  mkdirSync(join(modules,'react'),{recursive:true});
  mkdirSync(join(template,'toolchain'),{recursive:true});
  mkdirSync(profile);
  writeFileSync(join(modules,'vite','bin','vite.js'),'console.log("locked compiler");');
  writeFileSync(join(modules,'react','package.json'),'{"name":"react"}');
  const archive=join(template,'toolchain','node_modules.tar.gz');
  run(['-czf',archive,'-C',build,'node_modules']);
  const bytes=readFileSync(archive);
  const receipt={schema:'ordax.desktop-runtime-toolchain-archive/1',
    archive:'node_modules.tar.gz',archive_sha256:hash(bytes),
    archive_size:bytes.length,canonical_lock_sha256:'f'.repeat(64),
    tree_sha256:calculateTreeDigest(modules),installed_packages:2};
  writeFileSync(join(template,'toolchain','toolchain-receipt.json'),JSON.stringify(receipt));
  return {root,archive,receipt,template,profile};
}
test('exact offline compiler archive is SHA verified, extracted outside Program Files and reused',t=>{
  const f=fixture(t);
  assert.equal(archiveReceipt(f.template).receipt.archive_sha256,f.receipt.archive_sha256);
  const path=ensureRuntimeToolchain(f.template,f.profile);
  assert.match(readFileSync(join(path,'vite','bin','vite.js'),'utf8'),/locked compiler/);
  assert.equal(path,ensureRuntimeToolchain(f.template,f.profile));
  assert.equal(readdirSync(join(f.profile,'runtime-toolchains')).length,1);
  assert.equal(existsSync(join(f.template,'node_modules')),false);
});
test('tampered archive fails closed before creating a compiler cache',t=>{
  const f=fixture(t);
  writeFileSync(f.archive,Buffer.concat([readFileSync(f.archive),Buffer.from('tamper')]));
  assert.throws(()=>ensureRuntimeToolchain(f.template,f.profile),/archive digest mismatch/);
  assert.equal(existsSync(join(f.profile,'runtime-toolchains')),false);
});
test('toolchain cache cannot reuse a directory without its verified marker',t=>{
  const f=fixture(t);
  const root=join(f.profile,'runtime-toolchains',f.receipt.archive_sha256);
  mkdirSync(root,{recursive:true});
  assert.throws(()=>ensureRuntimeToolchain(f.template,f.profile),/Untrusted existing/);
});
test('legacy canonical expanded compiler remains supported during rollback',t=>{
  const f=fixture(t);
  mkdirSync(join(f.template,'node_modules','vite'),{recursive:true});
  const legacy=ensureRuntimeToolchain(f.template,f.profile);
  assert.equal(legacy,join(f.template,'node_modules'));
  assert.equal(existsSync(join(f.profile,'runtime-toolchains')),false);
});

test('modified expanded compiler cache is rejected even with its original marker',t=>{
  const f=fixture(t);
  const tree=ensureRuntimeToolchain(f.template,f.profile);
  writeFileSync(join(tree,'vite','bin','vite.js'),'console.log("tampered compiler");');
  assert.throws(()=>ensureRuntimeToolchain(f.template,f.profile),/content digest mismatch/);
});

test('final compiler cache cannot be redirected via symlink or Windows junction',t=>{
  const f=fixture(t);
  const original=ensureRuntimeToolchain(f.template,f.profile);
  assert.ok(existsSync(join(original,'vite','bin','vite.js')));
  const target=join(f.profile,'runtime-toolchains',f.receipt.archive_sha256);
  const outside=join(f.root,'outside-user-cache');
  renameSync(target,outside);
  // The outside tree has the EXACT bytes and receipt. Its content digest
  // alone must not authorize following a path outside the user's cache.
  symlinkSync(outside,target,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>ensureRuntimeToolchain(f.template,f.profile),
    /Untrusted linked Desktop compiler cache target/);
});
test('a non-directory cache target fails closed before reading its marker',t=>{
  const f=fixture(t);
  const base=join(f.profile,'runtime-toolchains');
  mkdirSync(base,{recursive:true});
  const target=join(base,f.receipt.archive_sha256);
  writeFileSync(target,'not a compiler');
  assert.throws(()=>ensureRuntimeToolchain(f.template,f.profile),
    /Untrusted linked Desktop compiler cache target/);
});
