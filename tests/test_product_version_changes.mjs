import assert from 'node:assert/strict';
import test from 'node:test';
import { osProductCodeChanged, verifyOsVersionChange } from '../tools/verify/product_version_changes.mjs';

const oldVersion={semanticVersion:'0.1.0',displayVersion:'v0.1.0',displayName:'OrdaX Prototype v0.1.0',stableRelease:false};
const nextVersion={semanticVersion:'0.1.1-alpha.1',displayVersion:'v0.1.1-alpha.1',displayName:'OrdaX Prototype v0.1.1-alpha.1',stableRelease:false};

test('runtime changes automatically require OS version increase',()=>{
  for(const path of [
    'system/surface/entrypoint.mjs','system/composition/native/main.mjs',
    'system/composition/web/main.tsx','system/services/app-service.mjs',
    'system/contracts/component-manifest.mjs','bootstrap/release-agent/activate.sh',
    'boot/esp/init.sh','kernel/net.c','src/system/surface/view.ts',
    'system/surface/assets/wallpaper.webp','system/adapters/native/ordax.service',
    'system/surface/bin/ordax-surface','system/surface/bin/ordax-mvp-smoke',
    'bootstrap/initramfs/root/init','system/services/runtime/runtime.wasm',
    'system/surface/workspace/assets/demo-salvador-1.jpg',
    'system/services/network/provider.yaml',
  ]) assert.equal(osProductCodeChanged([path]),true,path);
  assert.throws(()=>verifyOsVersionChange({
    previous:oldVersion,current:oldVersion,paths:['system/surface/entrypoint.mjs'],
  }),/require a version advance/i);
  assert.equal(verifyOsVersionChange({
    previous:oldVersion,current:nextVersion,paths:['system/surface/entrypoint.mjs'],
  }).changedRuntime,true);
});

test('version policy, docs and tests do not force fictional new OS release numbers',()=>{
  for(const path of [
    'tests/test_product_family.mjs','docs/CURRENT-STATE.md',
    'system/contracts/product-version-governance.mjs',
    'system/contracts/product-version.mjs',
    'system/surface/tests/test_launcher.mjs',
    'system/surface/docs/CURRENT-STATE.md',
    'system/surface/ui/README.md','system/surface/bin/.gitkeep',
    '.github/workflows/foundation.yml',
  ]) assert.equal(osProductCodeChanged([path]),false,path);
  const result=verifyOsVersionChange({
    previous:oldVersion,current:oldVersion,paths:[
      'tests/test_product_family.mjs','docs/VERSION-GOVERNANCE.md',
      'system/contracts/product-version-governance.mjs',
      'system/contracts/product-version.mjs',
    ],
  });
  assert.equal(result.changedRuntime,false);
});

test('OS version changes cannot regress even in docs-only PRs',()=>{
  assert.throws(()=>verifyOsVersionChange({
    previous:nextVersion,current:oldVersion,paths:['docs/README.md'],
  }),/Version regression/);
  assert.throws(()=>verifyOsVersionChange({
    previous:oldVersion,current:{
      semanticVersion:'0.1.1-alpha.1',displayVersion:'v0.1.0',displayName:'OrdaX Prototype v0.1.0',stableRelease:false,
    },paths:['system/services/new-feature.mjs'],
  }),/Displayed version must be derived/);
});
