'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {planRuntimePackages}=require('./runtime-toolchain.cjs');
const root=join(__dirname,'../..');
const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));

test('installed Dev Native toolchain follows one canonical npm lock without TypeScript or Babel dev compiler forks',()=>{
  const packages=planRuntimePackages(manifest,lock);
  assert.ok(packages.includes('node_modules/vite'));
  assert.ok(packages.includes('node_modules/react'));
  assert.ok(packages.includes('node_modules/react-dom'));
  assert.ok(!packages.includes('node_modules/typescript'));
  assert.ok(!packages.includes('node_modules/@vitejs/plugin-react'));
  assert.ok(packages.length<Object.keys(lock.packages).length-1);
  assert.equal(new Set(packages).size,packages.length);
});

test('Native installed toolchain is generated, not sourced from entire development node_modules',()=>{
  const build=require('./package.json').build;
  const entry=build.extraResources.find(e=>e.to==='runtime-template/node_modules');
  assert.equal(entry.from,'../../out/windows-desktop-toolchain/node_modules');
  const workflow=readFileSync(join(root,'.github/workflows/windows-desktop-dev.yml'),'utf8');
  const buildStep=workflow.indexOf('name: Build unsigned Windows installer');
  const runtimeStep=workflow.indexOf('name: Materialize minimal canonical Native runtime dependencies');
  assert.ok(runtimeStep>=0&&runtimeStep<buildStep);
  assert.ok(workflow.includes('runtime-toolchain.cjs'));
});

test('runtime closure rejects any missing required root, stale lock or malicious package identifier',()=>{
  assert.throws(()=>planRuntimePackages({...manifest,devDependencies:{...manifest.devDependencies,vite:'0.0.0'}},lock),/diverged/);
  const missing=structuredClone(lock);
  delete missing.packages['node_modules/vite'];
  assert.throws(()=>planRuntimePackages(manifest,missing),/unavailable/);
  const unsafe=structuredClone(manifest);
  unsafe.dependencies={'../../tamper':'1.0.0'};
  const aligned=structuredClone(lock);
  aligned.packages[''].dependencies={'../../tamper':'1.0.0'};
  assert.throws(()=>planRuntimePackages(unsafe,aligned),/Unsafe canonical npm dependency/);
});
