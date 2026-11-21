'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {win32}=require('node:path');
const {readFileSync}=require('node:fs');
const {resolveInstalledGit,bundledGit}=require('./checkout.cjs');
const lock=require('./git-toolchain-lock.json');

test('the private MinGit has one official digest-locked source of truth',()=>{
  assert.equal(lock.schema,'ordax.windows-min-git-lock/1');
  assert.equal(lock.version,'2.56.0.4');
  assert.equal(lock.sha256,'e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877');
  assert.match(lock.git_exe_sha256,/^[0-9a-f]{64}$/);
  assert.match(lock.core_exe_sha256,/^[0-9a-f]{64}$/);
  assert.equal(lock.url,'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.4/'+lock.archive);
});

test('bundled private Git fails closed if a packaged Windows app lacks its files',()=>{
  const missing=()=>{const e=Error('missing');e.code='ENOENT';throw e;};
  assert.throws(()=>resolveInstalledGit({
    platform:'win32',resourcesPath:'C:\\OrdaX\\resources',
    env:{ProgramFiles:'C:\\Program Files'},stat:missing,
  }),/Packaged Desktop Git missing/);
  assert.equal(resolveInstalledGit({
    platform:'win32',resourcesPath:null,env:{},stat:missing,
  }),'git');
  assert.equal(resolveInstalledGit({platform:'linux'}),'git');
});

test('bad private Git receipt never falls back to system Git',()=>{
  const resources='C:\\OrdaX\\resources';
  const root=win32.join(resources,'runtime-template','toolchain');
  const receiptPath=win32.join(root,'git-receipt.json');
  const gitRoot=win32.join(root,'git');
  const file={isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false};
  const dir={isFile:()=>false,isDirectory:()=>true,isSymbolicLink:()=>false};
  const stat=p=>{
    if(p===receiptPath)return file;
    if(p===gitRoot)return dir;
    const e=Error('missing');e.code='ENOENT';throw e;
  };
  const read=p=>{
    if(p!==receiptPath)throw Error('Must reject receipt before reading executables');
    return JSON.stringify({schema:'ordax.windows-min-git-receipt/1',
      version:lock.version,archive_sha256:lock.sha256,
      git_exe_sha256:'a'.repeat(64),core_exe_sha256:'b'.repeat(64)});
  };
  assert.throws(()=>resolveInstalledGit({
    platform:'win32',resourcesPath:resources,stat,read,
    env:{ProgramFiles:'C:\\Program Files'},
  }),/receipt disagrees/);
});

test('the installer owns exactly one private Git rather than a global Git dependency',()=>{
  const pkg=require('./package.json');
  const files=pkg.build.extraResources;
  assert.equal(files.filter(x=>x.to==='runtime-template/toolchain/git').length,1);
  assert.equal(files.filter(x=>x.to==='runtime-template/toolchain/git-receipt.json').length,1);
  assert.equal(files.find(x=>x.to==='runtime-template/toolchain/git').from,
    '../../out/windows-desktop-toolchain/git');
  assert.ok(pkg.build.files.includes('git-toolchain-lock.json'));
  assert.equal(pkg.build.nsis.perMachine,false);
  const workflow=readFileSync(require('node:path').join(__dirname,'../../.github/workflows/windows-desktop-dev.yml'),'utf8');
  const stage=workflow.indexOf('name: Materialize pinned private MinGit for Windows Dev updates');
  const audit=workflow.indexOf('name: Reject unprovided MSVC dependencies in Windows Aura package');
  const build=workflow.indexOf('name: Build unsigned Windows installer');
  assert.ok(stage>=0 && audit>stage && build>audit,
    'MinGit must be verified before the independent Aura gate and the installer must remain blocked by it');
  assert.match(workflow,/package-git-toolchain\.ps1/);
});

test('private MinGit caches only the upstream ZIP and revalidates every restored cache',()=>{
  const {join}=require('node:path');
  const workflow=readFileSync(join(__dirname,'../../.github/workflows/windows-desktop-dev.yml'),'utf8');
  const script=readFileSync(join(__dirname,'package-git-toolchain.ps1'),'utf8');
  const restore=workflow.indexOf('name: Restore exact private MinGit source archive cache');
  const materialize=workflow.indexOf('name: Materialize pinned private MinGit for Windows Dev updates',restore);
  const verify=workflow.indexOf('name: Verify source-pinned private MinGit on cache hit and miss',materialize);
  const save=workflow.indexOf('name: Save source-pinned private MinGit archive cache',verify);
  assert.ok(restore>=0 && materialize>restore && verify>materialize && save>verify);
  const restored=workflow.slice(restore,materialize);
  const produced=workflow.slice(materialize,verify);
  const saved=workflow.slice(save,workflow.indexOf('name: Restore content-pinned Windows Aura engine and model cache',save));
  assert.match(restored,/path: out\/windows-desktop-toolchain\/source/);
  assert.match(saved,/path: out\/windows-desktop-toolchain\/source/);
  assert.doesNotMatch(restored,/out\/windows-desktop-toolchain\/git(?:\r?\n|$)|git-receipt\.json/);
  assert.doesNotMatch(saved,/out\/windows-desktop-toolchain\/git(?:\r?\n|$)|git-receipt\.json/);
  assert.match(restored,/ordax-windows-mingit-source-v2/);
  assert.doesNotMatch(produced,/\n\s+if:/,'ZIP must be verified and re-extracted even on a cache hit');
  assert.match(script,/Join-Path \$out 'source'/);
  assert.match(script,/Get-ChildItem -LiteralPath \$sourceCache -Force/);
  assert.match(script,/Untrusted MinGit source cache contents/);
  const digest=script.indexOf('Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256');
  const extract=script.indexOf('Expand-Archive -LiteralPath $archiveFile');
  assert.ok(digest>=0 && extract>digest,'hash the complete archive before any extraction');
});
