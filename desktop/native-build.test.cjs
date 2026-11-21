'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {hasNativeBundle,compiledBundleSha256,writeBundledNativeReceipt,
  verifyBundledNativeReceipt}=require('./native-build.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-native-monorepo-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(name,contents)=>{
  const out=path.join(root,name);fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,contents);return out;
 };
 const git=(...args)=>execFileSync('git',['-C',root,...args],{
  encoding:'utf8',windowsHide:true}).trim();
 git('init','-q','-b','main');
 git('config','user.name','OrdaX Test');
 git('config','user.email','test@invalid.example');
 git('remote','add','origin','https://github.com/ordaxsystems/ordax-os.git');
 write('docs/contracts/surface-source.json',JSON.stringify({
   $schema:'prototype-ordax.surface-source/2',status:'canonical',
   source_repository:'ordaxsystems/ordax-os',source_ref:'same-commit',
   source_policy:'tracked-git-blobs-only',
   visual_source_paths:['system/surface/ui','system/surface/workspace']
 }));
 write('system/surface/ui/a.css','/* ui */');
 write('system/surface/workspace/a.mjs','export const workspace=true;');
 git('add','.');
 git('commit','-qm','OS with same-commit visual');
 const sha=git('rev-parse','HEAD');
 const base='out/windows-desktop-native/';
 write(base+'system/composition/native/index.html',
  '<script type="module" src="/__ordax/desktop-assets/assets/index-123.js"></script>');
 const js=write(base+'assets/index-123.js','export const ready=true;');
 const receipt={$schema:'ordax.surface-source-materialization/2',
  source_repository:'ordaxsystems/ordax-os',source_commit:sha,
  file_count:2,visual_source_sha256:'a'.repeat(64),source_only:true,live_os_mutated:false,
  bundle_sha256:compiledBundleSha256(root)};
 write(base+'surface-source-receipt.json',JSON.stringify(receipt));
 return {root,sha,js,receipt,write,base};
}
test('same-commit Native candidate verifies both source SHA and compiled assets',t=>{
 const f=fixture(t);
 assert.equal(hasNativeBundle(f.root),true);
 fs.writeFileSync(f.js,'export const ready=false;');
 assert.equal(hasNativeBundle(f.root),false);
});
test('bundled Native evidence binds exact OS SHA and refuses tampering',t=>{
 const f=fixture(t);
 const evidence=f.write('source-receipt.json',JSON.stringify(f.receipt));
 const receipt=writeBundledNativeReceipt(f.root,evidence,f.sha);
 assert.equal(receipt.os_sha,receipt.source_commit);
 assert.equal(verifyBundledNativeReceipt(f.root,path.join(f.root,f.base)),true);
 fs.writeFileSync(f.js,'tampered');
 assert.equal(verifyBundledNativeReceipt(f.root,path.join(f.root,f.base)),false);
});
test('bundle evidence rejects mismatched source and invalid OS SHA',t=>{
 const f=fixture(t);
 const evidence=f.write('source-receipt.json',JSON.stringify({...f.receipt,
  source_commit:'f'.repeat(40)}));
 assert.throws(()=>writeBundledNativeReceipt(f.root,evidence,f.sha),/verification receipt/);
 assert.throws(()=>writeBundledNativeReceipt(f.root,evidence,'invalid'),/OS revision/);
});
