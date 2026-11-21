import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyCommittedSurface} from './committed-source.mjs';

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'ordax-committed-surface-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const cmd of [['init','-q'],['config','user.name','test'],['config','user.email','test@example.invalid']])
    execFileSync('git',cmd,{cwd:root});
  const files=[
    ['system/surface/ui/app.mjs','export const ready=true;\n'],
    ['system/surface/workspace/component.tsx','export const Window=() => null;\n']
  ];
  for(const [path,body] of files){
    mkdirSync(join(root,...path.split('/').slice(0,-1)),{recursive:true});
    writeFileSync(join(root,path),body);
  }
  const lock={
    $schema:'prototype-ordax.surface-source/2',status:'canonical',
    source_repository:'ordaxsystems/ordax-os',source_ref:'same-commit',
    source_policy:'tracked-git-blobs-only',
    visual_source_paths:['system/surface/ui','system/surface/workspace']
  };
  mkdirSync(join(root,'docs/contracts'),{recursive:true});
  writeFileSync(join(root,'docs/contracts/surface-source.json'),JSON.stringify(lock));
  execFileSync('git',['add','-A'],{cwd:root});
  execFileSync('git',['commit','-qm','test fixture'],{cwd:root});
  return {root,files};
}

test('both Surface folders are derived from committed OS source',t=>{
  const f=fixture(t);
  assert.equal(verifyCommittedSurface(f.root),2);
});
test('changed tracked visual files fail closed',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,f.files[0][0]),'tampered');
  assert.throws(()=>verifyCommittedSurface(f.root));
});
test('unexpected visual additions fail closed',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'system/surface/ui/extra.mjs'),'untracked');
  assert.throws(()=>verifyCommittedSurface(f.root));
});
test('untrusted source contract fails closed',t=>{
  const f=fixture(t);
  writeFileSync(join(f.root,'docs/contracts/surface-source.json'),JSON.stringify({
    $schema:'prototype-ordax.surface-source/2',status:'canonical',
    source_repository:'ordaxsystems/ordax-surface',source_ref:'same-commit',
    source_policy:'tracked-git-blobs-only',
    visual_source_paths:['system/surface/ui','system/surface/workspace']
  }));
  assert.throws(()=>verifyCommittedSurface(f.root));
});
