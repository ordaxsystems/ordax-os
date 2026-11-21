'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {pinnedSourceLock,verifyPinnedSource,withPinnedSurface}=require('./surface-stage.cjs');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-monorepo-surface-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{
   encoding:'utf8',windowsHide:true,timeout:15000}).trim();
 git('init','-q','-b','main');
 git('config','user.email','test@example.invalid');
 git('config','user.name','Canonical Test');
 git('remote','add','origin','https://github.com/ordaxsystems/ordax-os.git');
 const put=(name,contents)=>{
   const file=path.join(root,name);
   fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.writeFileSync(file,contents);
 };
 put('docs/contracts/surface-source.json',JSON.stringify({
   $schema:'prototype-ordax.surface-source/2',status:'canonical',
   source_repository:'ordaxsystems/ordax-os',source_ref:'same-commit',
   source_policy:'tracked-git-blobs-only',
   visual_source_paths:['system/surface/ui','system/surface/workspace']
 }));
 put('system/surface/ui/view.css','body{color:#123;}\n');
 put('system/surface/workspace/entry.mjs','export const ui=true;\n');
 git('add','.');
 git('commit','-qm','canonical Surface in OS');
 return {root,git,put};
}
test('Surface from same committed OS SHA verifies without extra checkout',async t=>{
 const f=fixture(t);
 const lock=pinnedSourceLock(f.root);
 assert.equal(lock.source_ref,'same-commit');
 const proof=await verifyPinnedSource(f.root);
 assert.equal(proof.receipt.source_commit,f.git('rev-parse','HEAD'));
 assert.equal(proof.receipt.file_count,2);
 assert.match(proof.receipt.visual_source_sha256,/^[0-9a-f]{64}$/);
 const output=await withPinnedSurface(f.root,x=>x);
 assert.deepEqual(output,proof.receipt);
 assert.equal(fs.existsSync(path.join(f.root,'system/surface/ui/view.css')),true);
});
test('rejects changed visual bytes and untracked source',async t=>{
 const f=fixture(t);
 f.put('system/surface/ui/view.css','/* modified */');
 await assert.rejects(verifyPinnedSource(f.root),/differs/);
 f.git('checkout','--','system/surface/ui/view.css');
 f.put('system/surface/ui/rogue.css','/* rogue */');
 await assert.rejects(verifyPinnedSource(f.root),/differs/);
});
test('rejects invalid Surface owner and Git origin',async t=>{
 const f=fixture(t);
 f.git('remote','set-url','origin','https://github.com/other/repo.git');
 await assert.rejects(verifyPinnedSource(f.root),/origin/);
});
