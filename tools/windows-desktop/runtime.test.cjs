'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { resolveTemplate, existingCheckout, runtimeStateDirectory, OFFICIAL_REMOTE, gitArgs } = require('./runtime.cjs');

test('desktop dev loads the same repository in un-packaged mode', () => {
  assert.equal(resolveTemplate(__dirname, 'ignored', false), resolve(__dirname, '../..'));
});
test('installed host uses bundled offline snapshot instead of any USB storage', () => {
  assert.equal(resolveTemplate('ignored', 'C:\\OrdaXResources', true), join('C:\\OrdaXResources', 'runtime-template'));
});
test('native development state and Git checkout are distinct', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ordax-desktop-test-'));
  try {
    assert.equal(existingCheckout(dir), null);
    mkdirSync(join(dir, 'runtime-checkout', '.git'), { recursive: true });
    assert.equal(existingCheckout(dir), join(dir, 'runtime-checkout'));
    assert.notEqual(runtimeStateDirectory(dir), existingCheckout(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Git bootstrap uses only the canonical OrdaX repository', () => {
  const args = gitArgs('test-target');
  assert.equal(args.at(-2), OFFICIAL_REMOTE);
  assert.equal(args.at(-1), 'test-target');
  assert.ok(args.includes('--depth'));
});
