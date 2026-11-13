import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PRODUCT_VERSION_PATH, productVersionFileChanged,
  verifyOsVersionChange, listVersionDiffPaths,
} from '../tools/verify/product_version_changes.mjs';

const oldVersion={semanticVersion:'0.1.0',displayVersion:'v0.1.0',displayName:'OrdaX Prototype v0.1.0',stableRelease:false};
const nextVersion={semanticVersion:'0.1.1-alpha.1',displayVersion:'v0.1.1-alpha.1',displayName:'OrdaX Prototype v0.1.1-alpha.1',stableRelease:false};

test('ordinary runtime source changes do not compete for a global SemVer',()=>{
  assert.equal(productVersionFileChanged([
    'system/surface/bin/ordax-surface',
    'bootstrap/initramfs/root/init',
  ]),false);
  assert.deepEqual(verifyOsVersionChange({
    previous:oldVersion,current:oldVersion,versionFileChanged:false,
  }),{
    versionFileChanged:false,previousVersion:'0.1.0',currentVersion:'0.1.0',
  });
});

test('an explicit product-version edit must advance SemVer',()=>{
  assert.equal(productVersionFileChanged([PRODUCT_VERSION_PATH]),true);
  assert.throws(()=>verifyOsVersionChange({
    previous:oldVersion,current:oldVersion,versionFileChanged:true,
  }),/must advance SemVer/i);
  assert.equal(verifyOsVersionChange({
    previous:oldVersion,current:nextVersion,versionFileChanged:true,
  }).currentVersion,'0.1.1-alpha.1');
});

test('version regression is forbidden even when reconciling a branch',()=>{
  assert.throws(()=>verifyOsVersionChange({
    previous:nextVersion,current:oldVersion,versionFileChanged:false,
  }),/regression/i);
});

test('git diff detects the explicit product version file without runtime heuristics',()=>{
  const worktree=mkdtempSync(join(tmpdir(),'ordax-version-explicit-'));
  const git=(...args)=>execFileSync('git',['-C',worktree,...args],{encoding:'utf8'});
  try {
    git('init','-q');
    git('config','user.email','ci@example.invalid');
    git('config','user.name','Version Fixture');
    mkdirSync(join(worktree,'system','contracts'),{recursive:true});
    mkdirSync(join(worktree,'system','surface'),{recursive:true});
    writeFileSync(join(worktree,PRODUCT_VERSION_PATH),"semanticVersion: '0.1.0'\n");
    writeFileSync(join(worktree,'system','surface','entrypoint'),'v1\n');
    git('add','.');
    git('commit','-qm','baseline');
    const base=git('rev-parse','HEAD').trim();
    writeFileSync(join(worktree,'system','surface','entrypoint'),'v2\n');
    git('add','.');
    git('commit','-qm','runtime only');
    let paths=listVersionDiffPaths(base,{cwd:worktree});
    assert.equal(productVersionFileChanged(paths),false);
    writeFileSync(join(worktree,PRODUCT_VERSION_PATH),"semanticVersion: '0.1.1-alpha.1'\n");
    git('add','.');
    git('commit','-qm','explicit composition version');
    paths=listVersionDiffPaths(base,{cwd:worktree});
    assert.equal(productVersionFileChanged(paths),true);
  } finally {
    rmSync(worktree,{recursive:true,force:true});
  }
});
