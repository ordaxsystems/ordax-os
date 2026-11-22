'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { inventory, nativeBundleComparison } = require('./package-inventory.cjs');

test('CLI inventory resolves the canonical monorepo system directory', () => {
  const command = spawnSync(process.execPath, [join(__dirname, 'package-inventory.cjs')], {
    cwd: __dirname, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(command.status, 0, command.stderr);
  const report = JSON.parse(command.stdout);
  assert.equal(report.schema, 'ordax.desktop-system-inventory/1');
  assert.ok(report.includedFiles > 0);
  assert.ok(report.groups['surface/ui']?.files > 0);
  assert.ok(report.groups['composition/native']?.files > 0);
});

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
test('unknown wildcard exclusions fail closed', () => {
  assert.throws(() => inventory('.', ['!surface/runtime/**']), /non-exact exclusion/);
});
test('untrusted symlinks fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'ordax-package-inventory-'));
  try {
    writeFileSync(join(root,'native.mjs'), 'native');
    try {symlinkSync(join(root,'native.mjs'),join(root,'alias.mjs'));}
    catch(error){if(error?.code==='EPERM') return;throw error;}
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


test('installed Desktop excludes historical runtime evidence and unsigned executables',()=>{
  const config=require('./package.json');
  const resources=config.build.extraResources;
  assert.equal(resources.some(item=>
    item.from?.startsWith('../docs/evidence/')||
    item.to?.startsWith('runtime-template/docs/evidence/')),false,
    'historical runtime proof must not become an installed or duplicate authority');
  assert.equal(resources.some(item=>
    item.to?.includes('product-runtime-dev')||
    item.from?.includes('ordax-product-agent.exe')),false,
    'unsigned DEV Runtime may never be silently bundled or installed');
  assert.equal(resources.filter(item=>
    item.from==='../docs/contracts/runtime-component-trust-policy.json' &&
    item.to==='runtime-template/docs/contracts/runtime-component-trust-policy.json').length,1,
    'the current signed runtime trust policy stays in the installed package');
});
