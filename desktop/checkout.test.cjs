'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync }=require('node:fs');
const { tmpdir }=require('node:os');
const { join }=require('node:path');
const { hasDesktopHostContract, git, dependenciesForStage }=require('./checkout.cjs');

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'ordax-host-contract-'));
  const emulator=join(root,'tools','windows-emulator');
  const composition=join(root,'system','composition','native');
  mkdirSync(emulator,{recursive:true});
  mkdirSync(composition,{recursive:true});
  writeFileSync(join(emulator,'dev-supervisor.mjs'),'// test native supervisor');
  writeFileSync(join(composition,'index.html'),'<!doctype html>');
  return {root,emulator};
}

test('rejects old canonical main without a desktop host contract',()=>{
  const {root}=fixture();
  try { assert.equal(hasDesktopHostContract(root),false); }
  finally { rmSync(root,{recursive:true,force:true}); }
});

test('rejects a partial or incompatible desktop host contract',()=>{
  const {root,emulator}=fixture();
  try {
    writeFileSync(join(emulator,'desktop-host-contract.json'),JSON.stringify({
      schema:1,desktopHost:{contractVersion:0,nativeSource:'system/composition/native/index.html',
        capabilities:['no-external-browser','dynamic-loopback-port']}
    }));
    assert.equal(hasDesktopHostContract(root),false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('accepts matching versioned desktop host capabilities',()=>{
  const {root,emulator}=fixture();
  try {
    // The Desktop validates the contract shape; the OS owner tests and ships
    // the actual Native host implementation. Do not reach into an old
    // monorepo-relative ../../tools path from this separated repository.
    const canonical={schema:1,desktopHost:{
      contractVersion:1,
      nativeSource:'system/composition/native/index.html',
      capabilities:['no-external-browser','dynamic-loopback-port','external-state-directory'],
    }};
    writeFileSync(join(emulator,'desktop-host-contract.json'),JSON.stringify(canonical));
    assert.equal(hasDesktopHostContract(root),true);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('staging launches Native Vite from verified cache rather than candidate junction',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-staged-vite-'));
  const candidate=join(root,'candidate');
  const verified=join(root,'verified','node_modules');
  const target=join(verified,'vite','bin');
  mkdirSync(candidate,{recursive:true});
  mkdirSync(target,{recursive:true});
  writeFileSync(join(target,'vite.js'),'// verified fixture');
  const cache=require('./toolchain-cache.cjs');
  t.mock.method(cache,'ensureRuntimeToolchainIsolated',async()=>verified);
  try{
    const result=await dependenciesForStage(candidate,root,root);
    assert.equal(result,verified);
    const {lstatSync,existsSync}=require('node:fs');
    const junction=join(candidate,'node_modules');
    assert.equal(lstatSync(junction).isSymbolicLink(),true);
    assert.equal(result,verified);
    assert.equal(existsSync(join(result,'vite','bin','vite.js')),true);
  }finally{
    t.mock.restoreAll();
    const {rmdirSync}=require('node:fs');
    const junction=join(candidate,'node_modules');
    if(require('node:fs').existsSync(junction))rmdirSync(junction);
    rmSync(root,{recursive:true,force:true});
  }
});

test('stage refuses a pre-existing junction to an unverified compiler',async t=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-staged-vite-wrong-link-'));
  const candidate=join(root,'candidate');
  const verified=join(root,'verified','node_modules');
  const wrong=join(root,'wrong','node_modules');
  mkdirSync(verified,{recursive:true});
  mkdirSync(wrong,{recursive:true});
  mkdirSync(candidate,{recursive:true});
  symlinkSync(wrong,join(candidate,'node_modules'),process.platform==='win32'?'junction':'dir');
  const cache=require('./toolchain-cache.cjs');
  t.mock.method(cache,'ensureRuntimeToolchainIsolated',async()=>verified);
  try{
    await assert.rejects(
      dependenciesForStage(candidate,root,root),
      /does not match verified cache/
    );
  }finally{
    t.mock.restoreAll();
    const junction=join(candidate,'node_modules');
    try{require('node:fs').unlinkSync(junction);}catch{try{require('node:fs').rmdirSync(junction);}catch{}}
    rmSync(root,{recursive:true,force:true});
  }
});

test('stage refuses a non-junction dependency directory',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-staged-vite-reject-'));
  const candidate=join(root,'candidate');
  mkdirSync(join(candidate,'node_modules'),{recursive:true});
  try{await assert.rejects(
    dependenciesForStage(candidate,root,root),
    /Staged compiler dependency is not a junction/
  );}finally{rmSync(root,{recursive:true,force:true});}
});

test('canonical public Git commands override interactive global credential helpers',async()=>{
  // A global GitHub CLI credential helper stalled public ls-remote for
  // 132 seconds on the owner Windows machine. The same ref resolved
  // anonymously in 1.33 seconds. Check Git's *effective* runtime config
  // without touching machine/user credential settings or using the network.
  const reply=await git(['config','--get','credential.helper'],__dirname,10000);
  assert.equal(reply.ok,true);
  assert.equal(reply.stdout,'');
});
