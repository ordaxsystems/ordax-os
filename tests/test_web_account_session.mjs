import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAccountSession } from '../system/composition/web/account-session.mjs';

const signedIn = subject => ({
  $schema: 'prototype-ordax.public-identity-session/1',
  provider: 'configured', authenticated: true, status: 'authenticated',
  subject, email: subject + '@example.invalid',
});
const signedOut = { $schema: 'prototype-ordax.public-identity-session/1', provider: 'configured', authenticated: false, status: 'signed-out' };
const catalog = subject => ({
  $schema: 'prototype-ordax.account-spaces/1',
  spaces: [{ id: 'space-' + subject, name: 'Space ' + subject, kind: 'personal', state: 'active', ownerId: subject }],
});
const response = value => ({ ok: true, status: 200, json: async () => structuredClone(value) });
function fixture(sessionValue = signedOut) {
  const windowRef = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const requests = [];
  const server = { session: sessionValue, readSpaces: () => response(catalog(server.session.subject)) };
  Object.assign(windowRef, {
    navigator: { onLine: true }, document,
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/auth/session') return response(server.session);
      if (path === '/account/spaces') return server.readSpaces(options);
      if (path === '/auth/logout') { server.session = signedOut; return response({}); }
      throw Error('Unexpected endpoint');
    },
  });
  return { windowRef, requests, server, session: createWebAccountSession(windowRef) };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('anonymous refresh reads no Spaces and shares one in-flight session request', async () => {
  const f = fixture();
  try {
    const first = f.session.refresh();
    assert.equal(f.session.refresh(), first);
    await first;
    assert.equal(f.requests.length, 1);
    assert.equal(f.session.identity.getSnapshot().state, 'signed-out');
    assert.deepEqual(f.session.actions.getSnapshot().supportedActions, ['sign-in']);
    assert.equal(f.session.spaces.getSnapshot().state, 'idle');
  } finally { f.session.dispose(); }
});

test('authenticated session and logout use existing same-origin ports', async () => {
  const f = fixture(signedIn('account-a'));
  try {
    await f.session.refresh();
    assert.equal(f.session.identity.getSnapshot().displayName, 'account-a');
    assert.equal(f.session.spaces.getSnapshot().spaces[0].ownerId, 'account-a');
    assert.equal(f.session.surface.getSnapshot().capabilityIds.includes('account.identity'), true);
    for (const request of f.requests) {
      assert.equal(request.options.credentials, 'same-origin');
      assert.equal(request.options.cache, 'no-store');
    }
    await f.session.actions.execute('sign-out');
    assert.equal(f.session.identity.getSnapshot().state, 'signed-out');
    assert.deepEqual(f.session.spaces.getSnapshot().spaces, []);
  } finally { f.session.dispose(); }
});

test('account replacement invalidates a previous catalog before its late response', async () => {
  const f = fixture(signedIn('account-a'));
  const oldResponse = deferred();
  const started = deferred();
  let oldSignal;
  f.server.readSpaces = options => { oldSignal = options.signal; started.resolve(); return oldResponse.promise; };
  try {
    const pending = f.session.refresh();
    await started.promise;
    f.server.session = signedIn('account-b');
    await f.session.identity.refresh();
    assert.equal(oldSignal.aborted, true);
    assert.deepEqual(f.session.spaces.getSnapshot().spaces, []);
    oldResponse.resolve(response(catalog('account-a')));
    await pending;
    assert.deepEqual(f.session.spaces.getSnapshot().spaces, []);
    f.server.readSpaces = () => response(catalog('account-b'));
    await f.session.refresh();
    assert.equal(f.session.spaces.getSnapshot().spaces[0].ownerId, 'account-b');
  } finally { f.session.dispose(); }
});

test('unconfigured identity does not become authenticated or request account data', async () => {
  const f = fixture({ ...signedIn('account-a'), provider: 'unconfigured' });
  try {
    await f.session.refresh();
    assert.equal(f.session.identity.getSnapshot().state, 'unavailable');
    assert.deepEqual(f.session.actions.getSnapshot().supportedActions, []);
    assert.equal(f.requests.some(request => request.path === '/account/spaces'), false);
  } finally { f.session.dispose(); }
});

test('disposal removes refresh listeners and ignores a late session read', async () => {
  const f = fixture();
  const late = deferred();
  f.windowRef.fetch = () => { f.requests.push({ path: '/auth/session' }); return late.promise; };
  const pending = f.session.refresh();
  f.session.dispose();
  f.windowRef.dispatchEvent(new Event('focus'));
  f.windowRef.dispatchEvent(new Event('online'));
  f.windowRef.document.dispatchEvent(new Event('visibilitychange'));
  late.resolve(response(signedIn('account-a')));
  await pending;
  assert.equal(f.requests.length, 1);
  assert.equal(f.session.identity.getSnapshot().state, 'unavailable');
  assert.deepEqual(f.session.spaces.getSnapshot().spaces, []);
});
