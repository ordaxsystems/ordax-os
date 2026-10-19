import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_VERSION } from '../system/contracts/product-version.mjs';
import {
  productVersionChannel, assertProductVersionIdentity,
  assertVersionAdvance, versionGovernancePolicy,
} from '../system/contracts/product-version-governance.mjs';

test('OrdaX OS has one validated prototype version without publication authority',()=>{
  const identity=assertProductVersionIdentity(PRODUCT_VERSION);
  assert.equal(identity.version,PRODUCT_VERSION.semanticVersion);
  assert.equal(PRODUCT_VERSION.displayVersion,'v'+identity.version);
  assert.equal(PRODUCT_VERSION.displayName,'OrdaX Prototype '+PRODUCT_VERSION.displayVersion);
  assert.equal(PRODUCT_VERSION.maturity,'prototype');
  assert.equal(PRODUCT_VERSION.stableRelease,false);
  assert.equal(identity.stableRelease,false);
  assert.equal(versionGovernancePolicy().unqualifiedMeansPublished,false);
  assert.equal(versionGovernancePolicy().sourceVersionAuthorizesRelease,false);
});

test('all OrdaX products can progress by SemVer with alpha/beta/rc channels',()=>{
  for(const [version,channel] of [
    ['0.1.0','unqualified'],['0.1.1-alpha.1','alpha'],
    ['0.1.1-beta.1','beta'],['0.1.1-rc.1','rc'],['1.0.0','unqualified'],
  ]) assert.equal(productVersionChannel(version),channel);
  assert.deepEqual(assertVersionAdvance('0.1.0','0.1.1-alpha.1'),{
    previous:'0.1.0',next:'0.1.1-alpha.1',changedRuntime:true,
  });
  assertVersionAdvance('0.1.1-alpha.1','0.1.1-alpha.2');
  assertVersionAdvance('0.1.1-beta.1','0.1.1-rc.1');
  assertVersionAdvance('0.1.1-rc.1','0.1.1');
});

test('versioning rejects regression, unversioned runtime edits and invalid prereleases',()=>{
  assert.throws(()=>assertVersionAdvance('0.2.0','0.2.0-alpha.1'),/regression/i);
  assert.throws(()=>assertVersionAdvance('0.1.0','0.1.0'),/require a version advance/i);
  assertVersionAdvance('0.1.0','0.1.0',{changedRuntime:false});
  for(const version of ['0.1.0-alpha','0.1.0-preview.1','0.1.0-alpha.01','0.01.0','v0.1.0']){
    assert.throws(()=>productVersionChannel(version),TypeError);
  }
});

test('version label and publication authority cannot be minted by an alpha tag',()=>{
  assert.deepEqual(assertProductVersionIdentity({
    semanticVersion:'0.1.1-alpha.1',displayVersion:'v0.1.1-alpha.1',displayName:'OrdaX Prototype v0.1.1-alpha.1',stableRelease:false,
  }),{version:'0.1.1-alpha.1',channel:'alpha',stableRelease:false});
  assert.throws(()=>assertProductVersionIdentity({
    semanticVersion:'0.1.1-alpha.1',displayVersion:'v0.1.1-alpha.1',displayName:'OrdaX Prototype v0.1.1-alpha.1',stableRelease:true,
  }),/cannot claim stable/i);
  assert.throws(()=>assertProductVersionIdentity({
    semanticVersion:'0.1.1-alpha.1',displayVersion:'v0.1.1',displayName:'OrdaX Prototype v0.1.1',stableRelease:false,
  }),/Displayed version/i);
});
