'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {hasNativeBundle,compiledBundleSha256,verifyBundledNativeReceipt}=require('./native-build.cjs');

test('exact Native candidate requires compiled referenced JavaScript',t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-native-candidate-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bundle=join(root,'out','windows-desktop-native');
  const html=join(bundle,'system','composition','native','index.html');
  const assets=join(bundle,'assets');
  mkdirSync(join(bundle,'system','composition','native'),{recursive:true});
  mkdirSync(assets,{recursive:true});
  const lockPath=join(root,'docs','contracts','surface-source.json');
  mkdirSync(join(root,'docs','contracts'),{recursive:true});
  const sha='a'.repeat(40);
  const lock={$schema:'prototype-ordax.surface-source/1',status:'canonical',
    source_repository:'ordaxsystems/ordax-surface',source_commit:sha,
    visual_source_paths:['system/surface/ui','system/surface/workspace']};
  const receipt={schema:'ordax.surface-source-materialization/1',
    source_repository:lock.source_repository,source_commit:sha,
    visual_source_sha256:'b'.repeat(64),file_count:1};
  const receiptPath=join(bundle,'surface-source-receipt.json');
  assert.equal(hasNativeBundle(root),false);
  writeFileSync(lockPath,JSON.stringify(lock));
  writeFileSync(html,'<script type="module" src="./main.mjs"></script>');
  assert.equal(hasNativeBundle(root),false);
  writeFileSync(html,'<script type="module" crossorigin src="/__ordax/desktop-assets/assets/index-AbC123.js"></script>');
  assert.equal(hasNativeBundle(root),false);
  const js=join(assets,'index-AbC123.js');
  writeFileSync(js,'export const source = "compiled";');
  assert.equal(hasNativeBundle(root),false,'missing Surface receipt must block installable updates');
  writeFileSync(receiptPath,JSON.stringify({...receipt,source_commit:'f'.repeat(40)}));
  assert.equal(hasNativeBundle(root),false,'mismatched Surface SHA must block updates');
  writeFileSync(receiptPath,JSON.stringify({...receipt,schema:'untrusted-schema'}));
  assert.equal(hasNativeBundle(root),false,'unknown receipt contract must block updates');
  writeFileSync(receiptPath,JSON.stringify({...receipt,bundle_sha256:compiledBundleSha256(root)}));
  assert.equal(hasNativeBundle(root),true);
  writeFileSync(js,'export const source = "tampered";');
  assert.equal(hasNativeBundle(root),false,'changed compiled JS must never be trusted');
  writeFileSync(js,'export const source = "compiled";');
  writeFileSync(html,'<script src="/__ordax/desktop-assets/assets/index-AbC123.js"></script><link href="/__ordax/desktop-assets/assets/styles-AbC123.css">');
  assert.equal(hasNativeBundle(root),false);
  writeFileSync(join(assets,'styles-AbC123.css'),'body{}');
  assert.equal(hasNativeBundle(root),false,'new compiled asset invalidates earlier receipt');
  writeFileSync(receiptPath,JSON.stringify({...receipt,bundle_sha256:compiledBundleSha256(root)}));
  assert.equal(hasNativeBundle(root),true);
  unlinkSync(js);
  assert.equal(hasNativeBundle(root),false);
});

test('installed fallback rejects wrong Surface source and modified compiled bytes',t=>{
 const root=mkdtempSync(join(tmpdir(),'ordax-installed-attestation-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const built=join(root,'desktop-assets');
 mkdirSync(join(root,'docs','contracts'),{recursive:true});
 mkdirSync(join(built,'system','composition','native'),{recursive:true});
 mkdirSync(join(built,'assets'),{recursive:true});
 const sha='a'.repeat(40);
 writeFileSync(join(root,'docs','contracts','surface-source.json'),JSON.stringify({
   $schema:'prototype-ordax.surface-source/1',status:'canonical',
   source_repository:'ordaxsystems/ordax-surface',source_commit:sha,
   visual_source_paths:['system/surface/ui','system/surface/workspace']
 }));
 writeFileSync(join(built,'system','composition','native','index.html'),'<script src="/assets/app.js"></script>');
 const js=join(built,'assets','app.js');
 writeFileSync(js,'export const ok=true');
 assert.equal(verifyBundledNativeReceipt(root,built),false);
 const receipt={schema:'ordax.desktop-native-bundle-provenance/1',os_sha:'f'.repeat(40),
   source_repository:'ordaxsystems/ordax-surface',source_commit:sha,
   visual_source_sha256:'b'.repeat(64),file_count:2,
   bundle_sha256:compiledBundleSha256(root,built)};
 const target=join(built,'source-provenance.json');
 writeFileSync(target,JSON.stringify(receipt));
 assert.equal(verifyBundledNativeReceipt(root,built),true);
 writeFileSync(js,'export const ok=false');
 assert.equal(verifyBundledNativeReceipt(root,built),false);
 writeFileSync(js,'export const ok=true');
 writeFileSync(target,JSON.stringify({...receipt,source_commit:'c'.repeat(40)}));
 assert.equal(verifyBundledNativeReceipt(root,built),false);
});
