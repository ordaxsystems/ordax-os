'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { inventory } = require('./package-inventory.cjs');

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
    symlinkSync(join(root,'native.mjs'),join(root,'alias.mjs'));
    assert.throws(() => inventory(root, []), /Untrusted symlink/);
  } finally { rmSync(root,{ recursive:true, force:true }); }
});
