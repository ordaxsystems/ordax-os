// Git source validation is implemented once by the canonical OS Python verifier.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import assert from 'node:assert/strict';

const verifier = fileURLToPath(new URL('../../surface-source/materialize.py', import.meta.url));

export function verifyCommittedSurface(root) {
  assert.ok(typeof root === 'string' && isAbsolute(root), 'OS root must be absolute');
  const executable = process.platform === 'win32' ? 'python' : 'python3';
  const output = execFileSync(executable, [verifier, 'verify', '--os-root', root], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  });
  const proof = JSON.parse(output);
  assert.equal(proof.source_repository, 'ordaxsystems/ordax-os');
  assert.ok(Number.isSafeInteger(proof.file_count) && proof.file_count > 0);
  return proof.file_count;
}
