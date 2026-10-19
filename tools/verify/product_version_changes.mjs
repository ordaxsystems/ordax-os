import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PRODUCT_VERSION } from '../../system/contracts/product-version.mjs';
import {
  assertProductVersionIdentity, assertVersionAdvance,
} from '../../system/contracts/product-version-governance.mjs';

// Product behavior, not tests/docs/build attestations. Existing independently
// versioned app/component manifests remain their own authority.
const RUNTIME_PREFIXES = Object.freeze([
  'system/contracts/','system/composition/','system/surface/','system/services/','system/adapters/','system/apps/',
  'src/system/','bootstrap/','boot/','kernel/','initramfs/',
]);
const RUNTIME_EXCLUDED = /(?:^|\/)(?:tests?|__tests__|fixtures|docs)\//;
const VERSION_CONTROL_FILES = new Set([
  'system/contracts/product-version.mjs',
  'system/contracts/product-version-governance.mjs',
]);
// Runtime classification is path/owner based, never filename-extension based:
// actual boot/Surface launchers and device artifacts are often extensionless.
const NON_PRODUCT_BASENAMES = new Set([
  '.gitkeep', '.gitignore', '.editorconfig', 'README', 'README.md',
  'CHANGELOG', 'CHANGELOG.md', 'LICENSE', 'LICENSE.md', 'NOTICE', 'NOTICE.md',
]);

export function osProductCodeChanged(paths) {
  if (!Array.isArray(paths)) throw new TypeError('Changed paths must be an array');
  return paths.some(path =>
    typeof path === 'string' &&
    RUNTIME_PREFIXES.some(prefix => path.startsWith(prefix)) &&
    !VERSION_CONTROL_FILES.has(path) &&
    !RUNTIME_EXCLUDED.test(path) &&
    !NON_PRODUCT_BASENAMES.has(path.split('/').at(-1))
  );
}

export function verifyOsVersionChange({ previous, current, paths }) {
  const changedRuntime = osProductCodeChanged(paths);
  assertProductVersionIdentity(current);
  if (changedRuntime) {
    assertVersionAdvance(previous.semanticVersion, current.semanticVersion);
  } else {
    // Still deny downgrade or malformed channel on non-runtime PRs.
    assertVersionAdvance(previous.semanticVersion, current.semanticVersion, {changedRuntime:false});
  }
  return Object.freeze({
    changedRuntime, previousVersion:previous.semanticVersion,
    currentVersion:current.semanticVersion,
  });
}

function git(...args) {
  return execFileSync('git', args,{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
}

// Disable Git rename detection: a move from system/ to docs/ must still
// expose the removed runtime path, not only the non-runtime destination.
// This is intentionally independent of user/repository diff.renames settings.
export function listOsVersionDiffPaths(testedBase, {head='HEAD',cwd=process.cwd()}={}) {
  const changed=execFileSync('git',[
    '-C',cwd,'diff','--no-renames','--name-only',testedBase,head,
  ],{encoding:'utf8',maxBuffer:8*1024*1024}).trim();
  return changed ? changed.split('\\n').filter(Boolean) : [];
}

export function readOsVersionAt(ref) {
  if (typeof ref !== 'string' || !/^[a-f0-9]{40}$/.test(ref)) {
    throw new TypeError('A verified 40-character commit SHA is required');
  }
  const old=git('show',ref+':system/contracts/product-version.mjs');
  const match=/semanticVersion:\s*["']([^"']+)["']/.exec(old);
  const label=/displayVersion:\s*["']([^"']+)["']/.exec(old);
  const stable=/stableRelease:\s*(true|false)/.exec(old);
  if (!match || !label || !stable) throw new Error('Previous OS version contract cannot be parsed');
  return {semanticVersion:match[1],displayVersion:label[1],stableRelease:stable[1]==='true'};
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const base=process.argv[2];
  if (!base) {
    assertProductVersionIdentity(PRODUCT_VERSION);
    process.stdout.write('ORDAX_OS_VERSION_IDENTITY=PASS '+PRODUCT_VERSION.semanticVersion+'\n');
  } else {
    // pull_request checks out GitHub's synthetic merge commit. Its FIRST
    // parent is the exact tested base; event.base.sha may be stale. Comparing
    // that parent to HEAD matches the PR's introduced bytes and avoids
    // attributing concurrent main changes to this branch.
    let testedBase = base;
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      const parents = git('rev-list','--parents','-n','1','HEAD').split(/\s+/);
      if (parents.length !== 3) throw new Error('Expected an attested two-parent GitHub PR merge commit');
      testedBase = parents[1];
    }
    const previous=readOsVersionAt(testedBase);
    const paths=listOsVersionDiffPaths(testedBase);
    process.stdout.write('ORDAX_OS_VERSION_DIFF_PATHS='+JSON.stringify(paths)+'\n');
    const result=verifyOsVersionChange({previous,current:PRODUCT_VERSION,paths});
    process.stdout.write('ORDAX_OS_VERSION_CHANGE=PASS '+JSON.stringify(result)+'\n');
  }
}
