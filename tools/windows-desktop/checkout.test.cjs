'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync }=require('node:fs');
const { tmpdir }=require('node:os');
const { join }=require('node:path');
const { hasDesktopHostContract }=require('./checkout.cjs');

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
    const canonical = require('../../tools/windows-emulator/desktop-host-contract.json');
    writeFileSync(join(emulator,'desktop-host-contract.json'),JSON.stringify(canonical));
    assert.equal(hasDesktopHostContract(root),true);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('canonical desktop host declares the environment variables it promises',()=>{
  const {readFileSync}=require('node:fs');
  const root=join(__dirname,'../..');
  const supervisor=readFileSync(join(root,'tools/windows-emulator/dev-supervisor.mjs'),'utf8');
  const vite=readFileSync(join(root,'tools/windows-emulator/vite.config.mjs'),'utf8');
  assert.ok(supervisor.includes('ORDAX_EMULATOR_NO_BROWSER'));
  assert.ok(vite.includes('ORDAX_EMULATOR_PORT'));
  assert.ok(vite.includes('ORDAX_EMULATOR_STATE_DIR'));
});
