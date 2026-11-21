'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');
const {resolveInstalledPowerHelper,compileWin32PowerHelper,STAGED}=require('./power-helper.cjs');

function fixture(t) {
  const root=fs.mkdtempSync(join(tmpdir(),'ordax-power-receipt-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const path=join(root,'tools','windows-power','ordax-win32-power.exe');
  fs.mkdirSync(join(root,'tools','windows-power'),{recursive:true});
  fs.mkdirSync(join(root,'docs','evidence'),{recursive:true});
  const bytes=Buffer.alloc(3584,0);
  bytes.write('MZ',0,'ascii');
  fs.writeFileSync(path,bytes);
  const manifest={schema:'ordax.desktop-standalone-stage/2',
    product_owner:'ordaxsystems/ordax-os',
    desktop_owner:'ordaxsystems/ordax-os',
    runtime_owner:'ordaxsystems/ordax-os',os_sha:'a'.repeat(40),
    desktop_sha:'a'.repeat(40),
    files:[{path:STAGED,bytes:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex')}]};
  const receipt=join(root,'docs','evidence','desktop-stage-manifest.json');
  const save=()=>fs.writeFileSync(receipt,JSON.stringify(manifest));
  save();
  return {root,path,bytes,manifest,save};
}

test('Windows power executable is only read from the exact Desktop stage receipt',t=>{
  const f=fixture(t);
  assert.equal(resolveInstalledPowerHelper(f.root),f.path);
  f.manifest.files[0].sha256='f'.repeat(64); f.save();
  assert.throws(()=>resolveInstalledPowerHelper(f.root),/match/);
  f.manifest.files[0].sha256=createHash('sha256').update(f.bytes).digest('hex');
  f.manifest.files.push({...f.manifest.files[0]}); f.save();
  assert.throws(()=>resolveInstalledPowerHelper(f.root),/Unattested/);
  f.manifest.files.pop(); f.save();
  assert.equal(resolveInstalledPowerHelper(f.root),f.path);
  fs.writeFileSync(f.path,Buffer.alloc(3584,0));
  assert.throws(()=>resolveInstalledPowerHelper(f.root),/PE input/);
});

test('Windows power receipt fails closed for missing or wrong ownership',t=>{
  const f=fixture(t);
  f.manifest.desktop_owner='ordaxsystems/ordax-desktop';f.save();
  assert.throws(()=>resolveInstalledPowerHelper(f.root),/Untrusted/);
  f.manifest.desktop_owner='ordaxsystems/ordax-os';f.save();
  fs.unlinkSync(f.path);
  assert.throws(()=>resolveInstalledPowerHelper(f.root),/ENOENT/);
});

test('Win32 power compiler cannot run in non-Windows Native sessions',()=>{
  assert.throws(()=>compileWin32PowerHelper(tmpdir(),{platform:'linux'}),/Windows/);
});
