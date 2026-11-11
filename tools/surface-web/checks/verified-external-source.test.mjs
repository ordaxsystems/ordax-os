import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyPinnedExternalSurface} from './verified-external-source.mjs';

const SHA = 'a'.repeat(40);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ordax-surface-pin-test-'));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const files = [
    ['system/surface/ui/app.mjs', 'export const ready=true;\n'],
    ['system/surface/workspace/components/central/central.tsx', 'export const Central=() => null;\n'],
  ];
  const visualPaths = ['system/surface/ui', 'system/surface/workspace'];
  for (const [path, content] of files) {
    mkdirSync(join(root, ...path.split('/').slice(0,-1)), {recursive:true});
    writeFileSync(join(root, ...path.split('/')), content);
  }
  const lock = {
    $schema:'prototype-ordax.surface-source/1', status:'canonical',
    source_repository:'ordaxsystems/ordax-surface', source_commit:SHA,
    visual_source_paths:visualPaths,
  };
  const lockFile=join(root,'docs/contracts/surface-source.json');
  mkdirSync(join(root,'docs/contracts'),{recursive:true});
  writeFileSync(lockFile,JSON.stringify(lock));
  const digest=createHash('sha256');
  for (const [path, content] of files) {
    digest.update(Buffer.from(path+'\0'));
    digest.update(createHash('sha256').update(Buffer.from(content)).digest());
  }
  const receipt = {
    $schema:'prototype-ordax.surface-assembly/1',
    surface_source_repository:lock.source_repository,
    surface_source_commit:SHA,
    visual_paths:visualPaths, visual_file_count:files.length,
    visual_source_sha256:digest.digest('hex'),
    old_os_visual_source_packaged:false,
    host_owner:'ordaxsystems/ordax-os',
    user_interface_owner:'ordaxsystems/ordax-surface',
  };
  const receiptPath=join(root,'provenance.json');
  const saveReceipt=()=>writeFileSync(receiptPath,JSON.stringify(receipt));
  saveReceipt();
  return {root,files,receipt,receiptPath,saveReceipt};
}

test('exact pinned external visual bytes pass without a historical Central hash',async t=>{
  const f=fixture(t);
  assert.equal(await verifyPinnedExternalSurface(f.root,f.receiptPath),2);
});

test('changed UI bytes fail closed despite unchanged source commit and receipt',async t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,...f.files[1][0].split('/')), 'changed visual bytes\n');
  await assert.rejects(verifyPinnedExternalSurface(f.root,f.receiptPath),/drifted/);
});

test('missing or mismatched canonical provenance cannot be bypassed',async t=>{
  const f=fixture(t);
  await assert.rejects(verifyPinnedExternalSurface(f.root,''),/receipt is required/);
  f.receipt.surface_source_commit='b'.repeat(40);
  f.saveReceipt();
  await assert.rejects(verifyPinnedExternalSurface(f.root,f.receiptPath));
});

test('unexpected visual file changes the authenticated inventory',async t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'system/surface/ui/extra.mjs'),'tamper');
  await assert.rejects(verifyPinnedExternalSurface(f.root,f.receiptPath),/inventory/);
});

test('symlink injection is not accepted as authenticated source',async t=>{
  const f=fixture(t);
  try {
    symlinkSync(join(f.root,'provenance.json'),join(f.root,'system/surface/ui/link.mjs'));
  }catch(err) {
    if(process.platform==='win32' && err.code==='EPERM')return t.skip('Windows symlink privilege unavailable');
    throw err;
  }
  await assert.rejects(verifyPinnedExternalSurface(f.root,f.receiptPath),/symlink/);
});
