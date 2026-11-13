import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PRODUCT_VERSION } from '../../system/contracts/product-version.mjs';
import {
  assertProductVersionIdentity, assertVersionAdvance,
} from '../../system/contracts/product-version-governance.mjs';

export const PRODUCT_VERSION_PATH = 'system/contracts/product-version.mjs';

export function productVersionFileChanged(paths) {
  if (!Array.isArray(paths)) throw new TypeError('Changed paths must be an array');
  return paths.includes(PRODUCT_VERSION_PATH);
}

export function verifyOsVersionChange({ previous, current, versionFileChanged }) {
  assertProductVersionIdentity(current);
  assertVersionAdvance(previous.semanticVersion, current.semanticVersion, {
    required: versionFileChanged === true,
  });
  return Object.freeze({
    versionFileChanged: versionFileChanged === true,
    previousVersion: previous.semanticVersion,
    currentVersion: current.semanticVersion,
  });
}

function git(...args) {
  return execFileSync('git', args, {encoding:'utf8', maxBuffer:8*1024*1024}).trim();
}

export function listVersionDiffPaths(testedBase, {head='HEAD',cwd=process.cwd()}={}) {
  const changed=execFileSync('git',[
    '-C',cwd,'diff','--no-renames','--name-only','-z',testedBase,head,
  ],{encoding:'utf8',maxBuffer:8*1024*1024});
  return changed ? changed.split('\0').filter(Boolean) : [];
}

export function readOsVersionAt(ref) {
  if (typeof ref !== 'string' || !/^[a-f0-9]{40}$/.test(ref)) {
    throw new TypeError('A verified 40-character commit SHA is required');
  }
  const old=git('show',ref+':'+PRODUCT_VERSION_PATH);
  const semantic=/semanticVersion:\s*["']([^"']+)["']/.exec(old);
  const display=/displayVersion:\s*["']([^"']+)["']/.exec(old);
  const stable=/stableRelease:\s*(true|false)/.exec(old);
  if (!semantic || !display || !stable) throw new Error('Previous OS version contract cannot be parsed');
  return {
    semanticVersion:semantic[1],
    displayVersion:display[1],
    stableRelease:stable[1]==='true',
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const base=process.argv[2];
  if (!base) {
    assertProductVersionIdentity(PRODUCT_VERSION);
    process.stdout.write('ORDAX_OS_VERSION_IDENTITY=PASS '+PRODUCT_VERSION.semanticVersion+'\n');
  } else {
    let testedBase=base;
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      const parents=git('rev-list','--parents','-n','1','HEAD').split(/\s+/);
      if (parents.length !== 3) throw new Error('Expected an attested two-parent GitHub PR merge commit');
      testedBase=parents[1];
    }
    const previous=readOsVersionAt(testedBase);
    const paths=listVersionDiffPaths(testedBase);
    const versionFileChanged=productVersionFileChanged(paths);
    const result=verifyOsVersionChange({
      previous,current:PRODUCT_VERSION,versionFileChanged,
    });
    process.stdout.write('ORDAX_OS_VERSION_DIFF_PATHS='+JSON.stringify(paths)+'\n');
    process.stdout.write('ORDAX_OS_VERSION_CHANGE=PASS '+JSON.stringify(result)+'\n');
  }
}
