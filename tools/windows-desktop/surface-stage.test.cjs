'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync}=require('node:fs');
const {join,dirname}=require('node:path');
const {tmpdir}=require('node:os');
const {pinnedSourceLock,verifyPinnedSource,withVerifiedSurface,cleanupPinnedSurfaceTemporary}=require('./surface-stage.cjs');

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'ordax-desktop-surface-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,'os'),source=join(dir,'surface');
  const visual=join(source,'system','surface','ui','surface.mjs');
  const workspace=join(source,'system','surface','workspace','shell.tsx');
  mkdirSync(dirname(visual),{recursive:true});
  mkdirSync(dirname(workspace),{recursive:true});
  mkdirSync(join(root,'system','surface'),{recursive:true});
  mkdirSync(join(root,'docs','contracts'),{recursive:true});
  writeFileSync(visual,'export const canonical=true;\n');
  writeFileSync(workspace,'export const workspace=true;\n');
  const git=(...argv)=>execFileSync('git',argv,{cwd:source,encoding:'utf8',windowsHide:true}).trim();
  git('init','-q');
  git('-c','core.autocrlf=false','add','.'); // working source bytes stay exact
  git('-c','user.name=OrdaX test','-c','user.email=ci@invalid.example','commit','-qm','verified fixture');
  git('remote','add','origin','https://github.com/ordaxsystems/ordax-surface.git');
  const sha=git('rev-parse','HEAD');
  const lock={$schema:'prototype-ordax.surface-source/1',status:'canonical',
    source_repository:'ordaxsystems/ordax-surface',source_commit:sha,
    visual_source_paths:['system/surface/ui','system/surface/workspace']};
  const lockPath=join(root,'docs','contracts','surface-source.json');
  writeFileSync(lockPath,JSON.stringify(lock));
  return {root,source,sha,visual,lockPath,git};
}
test('Dev candidate uses exact pinned Surface Git blobs and leaves OS source unmodified',async t=>{
  const x=fixture(t);
  assert.equal(pinnedSourceLock(x.root).source_commit,x.sha);
  const verified=await verifyPinnedSource(x.root,x.source);
  assert.equal(verified.records.length,2);
  assert.match(verified.receipt.visual_source_sha256,/^[0-9a-f]{64}$/);
  let during=false;
  const receipt=await withVerifiedSurface(x.root,x.source,async info=>{
    assert.equal(info.source_commit,x.sha);
    assert.equal(readFileSync(join(x.root,'system/surface/ui/surface.mjs'),'utf8'),
      'export const canonical=true;\n');
    during=true;return info;
  });
  assert.equal(during,true);
  assert.equal(receipt.visual_source_sha256,verified.receipt.visual_source_sha256);
  assert.equal(existsSync(join(x.root,'system/surface/ui')),false);
  assert.equal(existsSync(join(x.root,'system/surface/workspace')),false);
});
test('Pinned source fails closed on byte mismatch, wrong revision or duplicate visual tree',async t=>{
  const x=fixture(t);
  writeFileSync(x.visual,'export const canonical=false;\n');
  await assert.rejects(()=>verifyPinnedSource(x.root,x.source),/modified|blob/);
  x.git('checkout','--','system/surface/ui/surface.mjs');
  const lock=JSON.parse(readFileSync(x.lockPath,'utf8'));lock.source_commit='f'.repeat(40);
  writeFileSync(x.lockPath,JSON.stringify(lock));
  await assert.rejects(()=>verifyPinnedSource(x.root,x.source),/differs/);
  writeFileSync(x.lockPath,JSON.stringify({...lock,source_commit:x.sha}));
  mkdirSync(join(x.root,'system/surface/ui'));
  await assert.rejects(()=>withVerifiedSurface(x.root,x.source,async()=>{}),/duplicate/);
});

test('pinned Surface Git clone cleanup is shared, bounded and safe against unrelated paths',t=>{
  const temp=mkdtempSync(join(tmpdir(),'ordax-pinned-surface-'));
  t.after(()=>{if(existsSync(temp))cleanupPinnedSurfaceTemporary(temp)});
  const gitDir=join(temp,'source','.git');
  const pack=join(gitDir,'objects','pack','fixture.idx');
  mkdirSync(dirname(pack),{recursive:true});
  writeFileSync(pack,'fixture readonly Git pack index');
  if(process.platform==='win32'){
    chmodSync(pack,0o444);
    execFileSync('attrib.exe',['+R',pack],{windowsHide:true});
  }
  assert.throws(()=>cleanupPinnedSurfaceTemporary(join(temp,'outside')),/Unsafe/);
  cleanupPinnedSurfaceTemporary(temp);
  assert.equal(existsSync(temp),false,'Git readonly materialization must not mask successful pinned Surface build');
  // The packaged host must include the shared module, not a second cleanup fork.
  assert.ok(require('./package.json').build.files.includes('git-cleanup.cjs'));
});
