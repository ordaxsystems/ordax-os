import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SYSTEM_CAPABILITY_STATE_SCHEMA,
  validateSystemCapabilityId,
  validateSystemCapabilityState,
} from '../system/contracts/system-foundation.mjs';
import {
  SURFACE_HOST_SCHEMA,
  assertSurfaceHost,
  validateSurfaceSnapshot,
} from '../system/contracts/surface-host.mjs';
import { createWebSurfaceHost } from '../system/adapters/web/runtime.mjs';
import { createNativeSurfaceHost } from '../system/adapters/native/runtime.mjs';

test('Foundation and Surface share a stable capability ID grammar', () => {
  for (const id of ['network.https', 'account.identity', 'filesystem.user-space', 'intelligence.system']) {
    assert.equal(validateSystemCapabilityId(id), id);
    assert.deepEqual(validateSurfaceSnapshot({ capabilityIds: [id] }).capabilityIds, [id]);
    assert.equal(validateSystemCapabilityState({
      schema: SYSTEM_CAPABILITY_STATE_SCHEMA,
      id, available: false, source: 'test.provider',
    }).id, id);
  }
  for (const badId of ['', 'Network.https', 'network..https', 'network.https ', 'network_https', '__proto__', '.', 42, null]) {
    assert.throws(() => validateSystemCapabilityId(badId), TypeError);
    assert.throws(() => validateSurfaceSnapshot({ capabilityIds: [badId] }), TypeError);
  }
});

test('Surface rejects malformed provided lists instead of silently dropping capabilities', () => {
  assert.deepEqual(validateSurfaceSnapshot({ connectivity: 'unknown' }).capabilityIds, []);
  for (const capabilityIds of [null, 'network.https', { id: 'network.https' }, 7]) {
    assert.throws(() => validateSurfaceSnapshot({ capabilityIds }), /must be an array/);
  }
  assert.throws(() => validateSurfaceSnapshot({ capabilityIds: ['network.https', 'network.https'] }), /unique/);
  assert.throws(() => validateSurfaceSnapshot([]), /must be an object/);
  const input = ['network.https'];
  const snapshot = validateSurfaceSnapshot({ capabilityIds: input, connectivity: 'online' });
  input.push('account.identity');
  assert.deepEqual(snapshot.capabilityIds, ['network.https']);
  assert.equal(Object.isFrozen(snapshot.capabilityIds), true);
  assert.equal(Object.isFrozen(snapshot), true);
});

test('Surface host assertion fails closed on a malformed provider snapshot', () => {
  const host = {
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot: () => ({ capabilityIds: 'network.https', connectivity: 'online' }),
    subscribe: () => () => {},
  };
  assert.throws(() => assertSurfaceHost(host), /must be an array/);
});

test('Web and Native hosts continue to expose only validated, observed capabilities', () => {
  const listeners = new Map();
  const browser = {
    navigator: { onLine: true },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const web = createWebSurfaceHost(browser, {
    readAccountIdentityAvailable: () => true,
    readSyncSafeStateAvailable: () => true,
  });
  assert.deepEqual(web.getSnapshot().capabilityIds, ['network.https', 'account.identity', 'sync.safe-state']);
  web.dispose();
  const native = createNativeSurfaceHost(browser, {
    userFileSpaceAvailable: true,
    systemMetricsAvailable: true,
  });
  const capabilities = native.getSnapshot().capabilityIds;
  assert.ok(capabilities.includes('filesystem.user-space'));
  assert.ok(capabilities.includes('system.metrics'));
  assert.ok(!capabilities.includes('account.identity'));
  assert.ok(!capabilities.includes('sync.safe-state'));
  native.dispose();
  assert.equal(listeners.size, 0);
});
