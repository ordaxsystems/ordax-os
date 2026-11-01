'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { inventory, nativeBundleComparison, canonicalWindowsPackageExclusions, verifyInstalledWindowsPackage } = require('./package-inventory.cjs');

test('inventory counts included bytes and exact Linux exclusions', () => {
  const root = mkdtempSync(join(tmpdir(), 'ordax-package-inventory-'));
  try {
    mkdirSync(join(root,'surface','runtime'), { recursive:true });
    mkdirSync(join(root,'composition','native'), { recursive:true });
    writeFileSync(join(root,'surface','runtime','packages.txt'), 'linux\n');
    writeFileSync(join(root,'composition','native','main.mjs'), 'native\n');
    const report = inventory(root, ['!surface/runtime/packages.txt']);
    assert.equal(report.includedFiles, 1);
    assert.equal(report.includedBytes, 7);
    assert.equal(report.excludedFiles, 1);
    assert.equal(report.excludedBytes, 6);
    assert.deepEqual(report.missingExclusions, []);
    assert.equal(report.groups['composition/native'].files, 1);
    assert.match(report.fingerprint, /^[0-9a-f]{64}$/);
  } finally { rmSync(root,{ recursive:true, force:true }); }
});
test('NSIS exclusions are exactly the canonical dependency contract, never extra Native files', () => {
  const pkg = require('./package.json');
  const contract = require('../../docs/contracts/build-autonomy.json');
  const verified = canonicalWindowsPackageExclusions(pkg, contract);
  assert.ok(verified.includes('!composition/web/**'));
  assert.equal(verified.length, new Set(verified).size);

  const extra = structuredClone(pkg);
  extra.build.extraResources.find(x => x.from === '../../system').filter.push('!composition/native/main.mjs');
  assert.throws(() => canonicalWindowsPackageExclusions(extra, contract), /diverge/);

  const missing = structuredClone(pkg);
  missing.build.extraResources.find(x => x.from === '../../system').filter.pop();
  assert.throws(() => canonicalWindowsPackageExclusions(missing, contract), /diverge/);

  const repeat = structuredClone(pkg);
  const entry = repeat.build.extraResources.find(x => x.from === '../../system');
  entry.filter.push(entry.filter[1]);
  assert.throws(() => canonicalWindowsPackageExclusions(repeat, contract), /diverge/);

  const shadow = structuredClone(pkg);
  shadow.build.extraResources.push({from:'../../system',
    to:'runtime-template/system-shadow',filter:['**/*']});
  assert.throws(() => canonicalWindowsPackageExclusions(shadow, contract), /not unique/);

  const duplicated = structuredClone(contract);
  duplicated.client_build_independence.windows_package_forbidden_linux_shell_paths.push(
    duplicated.client_build_independence.windows_package_forbidden_linux_boot_paths[0]);
  assert.throws(() => canonicalWindowsPackageExclusions(pkg, duplicated), /Duplicate/);
});

test('real extracted NSIS verification rejects Linux/USB and Web leaks using the same contract', () => {
  const pkg = require('./package.json');
  const contract = require('../../docs/contracts/build-autonomy.json');
  const fixtures = [null, 'supervisor', 'surface/runtime/packages.txt',
    'surface/runtime/media_runtime_probe.py',
    'surface/runtime/native_host_server.py',
    'surface/runtime/ordax_browser_host.py', 'composition/web/leak.js'];
  for (const leak of fixtures) {
    const root = mkdtempSync(join(tmpdir(), 'ordax-installed-package-'));
    try {
      const native = join(root,'composition','native');
      mkdirSync(native,{recursive:true});
      writeFileSync(join(native,'index.html'),'Native source');
      if (leak) {
        const path = join(root,...leak.split('/'));
        mkdirSync(require('node:path').dirname(path),{recursive:true});
        writeFileSync(path,'Unwanted Linux/Web file');
        assert.throws(() => verifyInstalledWindowsPackage(root,pkg,contract),
          /Forbidden Linux\/Web source shipped/, leak);
      } else {
        const report = verifyInstalledWindowsPackage(root,pkg,contract);
        assert.equal(report.verifiedExclusions,
          canonicalWindowsPackageExclusions(pkg,contract).length);
        assert.equal(report.nativeEntryVerified,true);
      }
    } finally { rmSync(root,{recursive:true,force:true}); }
  }
});

test('real extracted NSIS verifier fails closed if Native source entry is absent', () => {
  const root = mkdtempSync(join(tmpdir(),'ordax-installed-no-native-'));
  try {
    assert.throws(() => verifyInstalledWindowsPackage(root,
      require('./package.json'),require('../../docs/contracts/build-autonomy.json')),
    /ENOENT|Native source entry/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('unknown wildcard exclusions fail closed', () => {
  assert.throws(() => inventory('.', ['!surface/runtime/**']), /non-exact exclusion/);
});
test('untrusted symlinks fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'ordax-package-inventory-'));
  try {
    writeFileSync(join(root,'native.mjs'), 'native');
    symlinkSync(join(root,'native.mjs'),join(root,'alias.mjs'));
    assert.throws(() => inventory(root, []), /Untrusted symlink/);
  } finally { rmSync(root,{ recursive:true, force:true }); }
});

test('comparison measures source and compiled Native separately and authorizes no deletion', () => {
  const root = mkdtempSync(join(tmpdir(), 'ordax-native-representations-'));
  try {
    const system = join(root, 'system');
    const built = join(root, 'compiled');
    mkdirSync(join(system, 'surface', 'ui'), { recursive: true });
    mkdirSync(join(system, 'surface', 'workspace'), { recursive: true });
    mkdirSync(join(built, 'system', 'composition', 'native'), { recursive: true });
    mkdirSync(join(built, 'assets'), { recursive: true });
    writeFileSync(join(system, 'surface', 'ui', 'a.js'), 'source');
    writeFileSync(join(system, 'surface', 'workspace', 'b.js'), 'code');
    writeFileSync(join(built, 'system', 'composition', 'native', 'index.html'), 'built');
    writeFileSync(join(built, 'assets', 'main.js'), 'js');
    const result = nativeBundleComparison(inventory(system, []), built);
    assert.equal(result.visualSourceFiles, 2);
    assert.equal(result.visualSourceBytes, 10);
    assert.equal(result.compiledNativeFiles, 2);
    assert.equal(result.compiledNativeBytes, 7);
    assert.equal(result.deletionAuthorized, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('comparison fails closed when compiled assets are missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ordax-native-representation-empty-'));
  try {
    assert.throws(() => nativeBundleComparison({ groups: { 'surface/ui': { files: 1, bytes: 1 }, 'surface/workspace': { files: 1, bytes: 1 } } }, root), /compiled Native/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('installed Desktop includes exactly the OS-pinned DEV provenance but no unsigned executable',()=>{
  const config=require('./package.json');
  const resources=config.build.extraResources;
  const target='runtime-template/docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json';
  const selected=resources.filter(item=>item.to===target);
  assert.equal(selected.length,1,'DEV evidence must not be a second file authority');
  assert.equal(selected[0].from,'../../docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json');
  const evidence=require('../../docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json');
  assert.equal(evidence.status,'unsigned-candidate-physically-offline-proven');
  assert.equal(evidence.candidate.platform,'windows-amd64');
  assert.equal(evidence.candidate.signature_present,false);
  assert.equal(evidence.candidate.stable_activation_authorized,false);
  assert.equal(resources.some(item=>
    item.to?.includes('product-runtime-dev')||
    item.from?.includes('ordax-product-agent.exe')),false,
    'unsigned DEV Runtime may never be silently bundled or installed');
});

test('Desktop artifact excludes Linux/USB boot executables without removing shared Native Surface',()=>{
  const contract=require('../../docs/contracts/build-autonomy.json').client_build_independence;
  const config=require('./package.json');
  const selected=config.build.extraResources.filter(item=>
    item.from==='../../system'&&item.to==='runtime-template/system');
  assert.equal(selected.length,1);
  const filter=selected[0].filter;
  assert.ok(filter.includes('**/*'),'single shared Native source must remain included');
  const roots=contract.windows_package_forbidden_linux_boot_paths;
  assert.deepEqual(roots,['entrypoint','supervisor','surface/entrypoint','surface/bin/ordax-surface']);
  for(const path of roots)assert.ok(filter.includes('!'+path),'USB Linux boot executable still packaged: '+path);
  const source=join(__dirname,'..','..','system');
  const report=inventory(source,filter.slice(1));
  assert.equal(roots.filter(path=>report.missingExclusions.includes(path)).length,0,
    'Linux executable exclusion must be observed in the real source tree');
  assert.ok(report.groups['composition/native']?.files>0,
    'Windows still requires the single Native composition source');
});

test('NSIS payload contains no POSIX service or USB diagnostic shell executables',()=>{
  const scope=require('../../docs/contracts/build-autonomy.json').client_build_independence;
  const config=require('./package.json');
  const resources=config.build.extraResources.filter(item=>
    item.from==='../../system' && item.to==='runtime-template/system');
  assert.equal(resources.length,1);
  const filter=resources[0].filter;
  const scripts=scope.windows_package_forbidden_linux_shell_paths;
  assert.equal(new Set(scripts).size,scripts.length,'source lock must not duplicate a shell entry');
  assert.ok(scripts.length>=20,'all current Linux service + diagnostic scripts must be isolated');
  const root=join(__dirname,'..','..','system');
  const report=inventory(root,filter.slice(1));
  for(const path of scripts){
    assert.equal(readFileSync(join(root,path),'utf8').startsWith('#!/bin/sh\n'),true,
      'only actual POSIX executables may be excluded from Windows: '+path);
    assert.ok(filter.includes('!'+path),'POSIX executable was packaged: '+path);
    assert.equal(report.missingExclusions.includes(path),false,
      'POSIX exclusion not proved against real source bytes: '+path);
  }
  assert.ok(report.groups['composition/native']?.files>0,
    'removing Linux shell must never remove the compiled Native source');
});

test('Windows package never carries the Web-only composition while retaining Native',()=>{
  const cfg=require('./package.json');
  const resources=cfg.build.extraResources.filter(x=>x.from==='../../system'&&x.to==='runtime-template/system');
  assert.equal(resources.length,1);
  const exclusions=resources[0].filter.slice(1);
  assert.equal(exclusions.filter(x=>x==='!composition/web/**').length,1);
  const graph=require('../../docs/contracts/build-autonomy.json').client_build_independence;
  assert.ok(graph.client_only_source_prefixes.includes('system/composition/web/'));
  assert.ok(graph.shared_native_changes_require_usb_proof);
  const result=inventory(join(__dirname,'..','..','system'),exclusions);
  assert.ok(result.excludedFiles>0);
  assert.equal(result.missingExclusions.includes('composition/web/**'),false);
  assert.equal(result.groups['composition/web'],undefined);
  assert.ok(result.groups['composition/native']?.files>0);
});

test('source inventory accepts ONLY the reviewed Web-only subtree exclusion',()=>{
  const root=mkdtempSync(join(tmpdir(),'ordax-web-composition-exclusion-'));
  try{
    mkdirSync(join(root,'composition','web'),{recursive:true});
    mkdirSync(join(root,'composition','native'),{recursive:true});
    writeFileSync(join(root,'composition','web','main.tsx'),'web');
    writeFileSync(join(root,'composition','web','index.html'),'html');
    writeFileSync(join(root,'composition','native','main.mjs'),'native');
    const result=inventory(root,['!composition/web/**']);
    assert.equal(result.excludedFiles,2);
    assert.equal(result.includedFiles,1);
    assert.deepEqual(result.missingExclusions,[]);
    assert.equal(result.groups['composition/native'].files,1);
    assert.throws(()=>inventory(root,['!composition/native/**']),/non-exact exclusion/);
    assert.throws(()=>inventory(root,['!surface/**']),/non-exact exclusion/);
    assert.throws(()=>inventory(root,['!composition/w?b']),/non-exact exclusion/);
  } finally{rmSync(root,{recursive:true,force:true});}
});

test('Windows NSIS includes no Web-only build tools but retains its own Native compiler',()=>{
  const config=require('./package.json');
  const resources=config.build.extraResources;
  assert.equal(resources.some(x=>x.from==='../surface-web'||
    x.to==='runtime-template/tools/surface-web'),false);
  assert.equal(resources.filter(x=>x.from==='../windows-emulator'&&
    x.to==='runtime-template/tools/windows-emulator').length,1);
  assert.ok(config.build.files.includes('native-build.cjs'),
    'Windows must retain the canonical Native compiler');
  assert.ok(resources.some(x=>x.to==='runtime-template/toolchain/node_modules.tar.gz'),
    'Windows must preserve verified offline Vite for staged Native updates');
});

test('Windows package excludes verified Linux-only Python diagnostic probes',()=>{
  const client=require('../../docs/contracts/build-autonomy.json').client_build_independence;
  const system=require('./package.json').build.extraResources.filter(x=>
    x.from==='../../system'&&x.to==='runtime-template/system');
  assert.equal(system.length,1);
  const filter=system[0].filter;
  const probes=client.linux_only_client_probe_paths;
  assert.equal(probes.length,4);
  const root=join(__dirname,'..','..','system');
  const report=inventory(root,filter.slice(1));
  for(const path of probes){
    assert.equal(readFileSync(join(root,path),'utf8').startsWith('#!/usr/bin/env python3\n'),true,
      'only verified source probes may be excluded: '+path);
    assert.ok(filter.includes('!'+path),'Linux probe re-entered Windows package: '+path);
    assert.ok(!report.missingExclusions.includes(path),'Linux probe exclusion unproven: '+path);
  }
  assert.ok(report.groups['composition/native']?.files>0,
    'Linux probe exclusions must not remove the shared Native consumer');
});
