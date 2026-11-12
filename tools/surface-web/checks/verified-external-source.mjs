// The historical Web Central reference is not an authority for the
// independently versioned Surface. Verify the exact pinned external bytes
// before importing executable UI modules in the Web smoke.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readFile, readdir} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

const VISUAL = ['system/surface/ui', 'system/surface/workspace'];
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

async function collect(root, relative, entries) {
  const directory = join(root, ...relative.split('/'));
  const info = await lstat(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(),
    'Pinned Surface visual root must be an ordinary directory: ' + relative);
  for (const name of await readdir(directory)) {
    const path = relative + '/' + name;
    const file = join(root, ...path.split('/'));
    const type = await lstat(file);
    assert.ok(!type.isSymbolicLink(), 'Pinned Surface must not contain a symlink: ' + path);
    if (type.isDirectory()) {
      await collect(root, path, entries);
    } else {
      assert.ok(type.isFile(), 'Pinned Surface must contain only ordinary files: ' + path);
      entries.push({path, bytes: await readFile(file)});
    }
  }
}

export async function verifyPinnedExternalSurface(root, receiptPath) {
  assert.ok(typeof root === 'string' && isAbsolute(root),
    'OS root must be an absolute directory');
  assert.ok(typeof receiptPath === 'string' && isAbsolute(receiptPath),
    'Verified assembly receipt is required; never trust a historical digest');
  const lock = JSON.parse(await readFile(join(root, 'docs/contracts/surface-source.json'), 'utf8'));
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(lock.$schema, 'prototype-ordax.surface-source/1');
  assert.equal(lock.status, 'canonical');
  assert.equal(lock.source_repository, 'ordaxsystems/ordax-surface');
  assert.match(lock.source_commit, SHA40);
  assert.deepEqual(lock.visual_source_paths, VISUAL);
  assert.equal(receipt.$schema, 'prototype-ordax.surface-assembly/1');
  assert.equal(receipt.surface_source_repository, lock.source_repository);
  assert.equal(receipt.surface_source_commit, lock.source_commit);
  assert.deepEqual(receipt.visual_paths, VISUAL);
  assert.equal(receipt.old_os_visual_source_packaged, false);
  assert.equal(receipt.host_owner, 'ordaxsystems/ordax-os');
  assert.equal(receipt.user_interface_owner, lock.source_repository);
  assert.ok(Number.isSafeInteger(receipt.visual_file_count) && receipt.visual_file_count > 0);
  assert.match(receipt.visual_source_sha256, SHA256);

  const entries = [];
  for (const path of VISUAL) await collect(root, path, entries);
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  assert.equal(entries.length, receipt.visual_file_count, 'Surface file inventory differs from canonical source');
  const fingerprint = createHash('sha256');
  for (const {path, bytes} of entries) {
    fingerprint.update(Buffer.from(path + '\0', 'utf8'));
    fingerprint.update(createHash('sha256').update(bytes).digest());
  }
  assert.equal(fingerprint.digest('hex'), receipt.visual_source_sha256,
    'Pinned Surface source bytes drifted after verified materialization');
  return entries.length;
}
