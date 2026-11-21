'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {prepare}=require('./local-dev.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordax-desktop-local-monorepo-'));
 const before=process.env.ORDAX_DESKTOP_OS_CHECKOUT;
 t.after(()=>{
   if(before===undefined)delete process.env.ORDAX_DESKTOP_OS_CHECKOUT;
   else process.env.ORDAX_DESKTOP_OS_CHECKOUT=before;
   fs.rmSync(root,{recursive:true,force:true});
 });
 const git=(...args)=>execFileSync('git',['-C',root,...args],{
   encoding:'utf8',windowsHide:true,timeout:10000}).trim();
 const put=(name,txt)=>{
   const target=path.join(root,name);
   fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.writeFileSync(target,txt);
 };
 git('init','-q','-b','main');
 git('config','user.email','test@invalid.example');
 git('config','user.name','OrdaX Test');
 git('remote','add','origin','https://github.com/ordaxsystems/ordax-os.git');
 put('docs/contracts/surface-source.json',JSON.stringify({
   $schema:'prototype-ordax.surface-source/2',status:'canonical',
   source_repository:'ordaxsystems/ordax-os',source_ref:'same-commit',
   source_policy:'tracked-git-blobs-only',
   visual_source_paths:['system/surface/ui','system/surface/workspace']
 }));
 put('system/surface/ui/identity.css','body{}');
 put('system/surface/workspace/app.mjs','export default true');
 git('add','.');git('commit','-qm','OS visual fixture');
 process.env.ORDAX_DESKTOP_OS_CHECKOUT=root;
 return {root,git,put};
}
test('local Desktop refuses a non-OS source origin',t=>{
 const f=fixture(t);
 f.git('remote','set-url','origin','https://github.com/other/repo.git');
 assert.throws(()=>prepare(),/canonical OS Git root/);
});
test('local Desktop rejects a second Surface pin instead of mounting it',t=>{
 const f=fixture(t);
 f.put('docs/contracts/surface-source.json',JSON.stringify({
   $schema:'prototype-ordax.surface-source/1',status:'canonical',
   source_repository:'ordaxsystems/ordax-surface',
   source_commit:'f'.repeat(40)
 }));
 assert.throws(()=>prepare(),/Same-commit Surface contract/);
});
test('same-commit source only needs installed dependencies, not a second repository',t=>{
 const f=fixture(t);
 assert.throws(()=>prepare(),/Install OS root dependencies/);
 assert.ok(fs.existsSync(path.join(f.root,'system/surface/ui/identity.css')));
 const contents=fs.readFileSync(path.join(__dirname,'local-dev.cjs'),'utf8');
 assert.doesNotMatch(contents,/ORDAX_SURFACE_CHECKOUT|symlinkSync|ordax-surface[.]git/);
});
