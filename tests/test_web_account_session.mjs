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
function fixture(sessionValue = signedOut, { online = true } = {}) {
  const windowRef = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const requests = [];
  const server = { session: sessionValue, readSpaces: () => response(catalog(server.session.subject)), readPolicy: () => ({ok: false, status: 503}) };
  const navigations = [];
  Object.assign(windowRef, {
    navigator: { onLine: online }, document, location: {assign: path => navigations.push(path)},
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/auth/session') return response(server.session);
      if (path === '/account/spaces') return server.readSpaces(options);
      if (path === '/auth/registration-policy') return server.readPolicy(options);
      if (path === '/auth/logout') { server.session = signedOut; return response({}); }
      throw Error('Unexpected endpoint');
    },
  });
  return { windowRef, requests, server, navigations, session: createWebAccountSession(windowRef) };
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
    assert.deepEqual(f.requests.map(request => request.path), ['/auth/session', '/auth/registration-policy']);
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

test('selection is explicit, uses the authorized catalog and issues no mutation requests', async () => {
  const f = fixture(signedIn('account-a'));
  try {
    assert.throws(() => f.session.selection.select('space-account-a'));
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
    assert.throws(() => f.session.selection.select('space-not-authorized'));
    const requestCount = f.requests.length;
    f.session.selection.select('space-account-a');
    assert.equal(f.session.selection.getSnapshot().selectedSpace.id, 'space-account-a');
    assert.equal(f.requests.length, requestCount);
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().selectedSpace.id, 'space-account-a');
    f.session.selection.clear();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
  } finally { f.session.dispose(); }
});

test('catalog revocation and archiving remove the selection instead of choosing another Space', async () => {
  const f = fixture(signedIn('account-a'));
  try {
    await f.session.refresh();
    f.session.selection.select('space-account-a');
    const replacement = catalog('account-a');
    replacement.spaces[0].state = 'archived';
    f.server.readSpaces = () => response(replacement);
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
    assert.throws(() => f.session.selection.select('space-account-a'));
    f.server.readSpaces = () => response(catalog('account-a'));
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
    f.session.selection.select('space-account-a');
    f.server.readSpaces = () => response({ ...catalog('account-a'), spaces: [] });
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
  } finally { f.session.dispose(); }
});

test('a failed catalog makes selection unavailable until revalidated for the same account', async () => {
  const f = fixture(signedIn('account-a'));
  try {
    await f.session.refresh();
    f.session.selection.select('space-account-a');
    f.server.readSpaces = () => ({ ok: false, status: 503 });
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unavailable');
    assert.equal(f.session.selection.getSnapshot().selectedSpace, null);
    assert.throws(() => f.session.selection.select('space-account-a'));
    f.server.readSpaces = () => response(catalog('account-a'));
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().selectedSpace.id, 'space-account-a');
  } finally { f.session.dispose(); }
});

test('switching accounts and signing out clear the previous selection permanently', async () => {
  const f = fixture(signedIn('account-a'));
  try {
    await f.session.refresh();
    f.session.selection.select('space-account-a');
    f.server.session = signedIn('account-b');
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().subjectId, 'account-b');
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
    f.server.session = signedIn('account-a');
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
    f.session.selection.select('space-account-a');
    await f.session.actions.execute('sign-out');
    assert.equal(f.session.selection.getSnapshot().state, 'unavailable');
    f.server.session = signedIn('account-a');
    await f.session.refresh();
    assert.equal(f.session.selection.getSnapshot().state, 'unselected');
  } finally { f.session.dispose(); }
});

test('a new Web composition does not inherit session-only selection after disposal', async () => {
  const f = fixture(signedIn('account-a'));
  await f.session.refresh();
  f.session.selection.select('space-account-a');
  f.session.dispose();
  assert.equal(f.session.selection.getSnapshot().state, 'unavailable');
  assert.throws(() => f.session.selection.select('space-account-a'));
  const next = createWebAccountSession(f.windowRef);
  try {
    await next.refresh();
    assert.equal(next.selection.getSnapshot().state, 'unselected');
  } finally { next.dispose(); }
});

test('offline initialization and visibility/focus refreshes perform no network reads', async () => {
  const f = fixture(signedIn('account-a'), { online: false });
  try {
    await f.session.refresh();
    f.windowRef.dispatchEvent(new Event('focus'));
    f.windowRef.document.dispatchEvent(new Event('visibilitychange'));
    await f.session.refresh();
    assert.equal(f.requests.length, 0);
    assert.equal(f.session.surface.getSnapshot().connectivity, 'offline');
    assert.equal(f.session.identity.getSnapshot().state, 'unavailable');
  } finally { f.session.dispose(); }
});

test('offline invalidates catalog and selected context; reconnect revalidates the same record', async () => {
  const f = fixture(signedIn('account-a'));
  try {
    await f.session.refresh();
    f.session.selection.select('space-account-a');
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    assert.equal(f.session.identity.getSnapshot().subjectId, 'account-a');
    assert.equal(f.session.spaces.getSnapshot().state, 'unavailable');
    assert.equal(f.session.selection.getSnapshot().state, 'unavailable');
    const count = f.requests.length;
    await f.session.refresh();
    assert.equal(f.requests.length, count);
    f.windowRef.navigator.onLine = true;
    f.windowRef.dispatchEvent(new Event('online'));
    await f.session.refresh();
    assert.equal(f.requests.length, count + 2);
    assert.equal(f.session.selection.getSnapshot().state, 'selected');
    assert.equal(f.session.selection.getSnapshot().selectedSpace.id, 'space-account-a');
  } finally { f.session.dispose(); }
});

test('offline between identity response and catalog read suppresses Spaces request', async () => {
  const f = fixture(signedIn('account-a'));
  const originalFetch = f.windowRef.fetch;
  const lateSession = deferred();
  f.windowRef.fetch = async (path, options) => path === '/auth/session'
    ? lateSession.promise : originalFetch(path, options);
  try {
    const pending = f.session.refresh();
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    lateSession.resolve(response(signedIn('account-a')));
    await pending;
    assert.equal(f.requests.some(request => request.path === '/account/spaces'), false);
    assert.equal(f.session.spaces.getSnapshot().state, 'unavailable');
  } finally { f.session.dispose(); }
});

test('reconnect during an old catalog read aborts and suppresses late data before one fresh pass', async () => {
  const f = fixture(signedIn('account-a'));
  const lateCatalog = deferred();
  const started = deferred();
  let signal;
  f.server.readSpaces = options => {
    signal = options.signal; started.resolve(); return lateCatalog.promise;
  };
  try {
    const pending = f.session.refresh();
    await started.promise;
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    assert.equal(signal.aborted, true);
    f.windowRef.navigator.onLine = true;
    f.windowRef.dispatchEvent(new Event('online'));
    assert.equal(f.session.refresh(), pending);
    f.server.readSpaces = () => response(catalog('account-a'));
    lateCatalog.resolve(response(catalog('stale-account')));
    await pending;
    assert.deepEqual(f.requests.map(request => request.path), [
      '/auth/session', '/account/spaces', '/auth/session', '/account/spaces',
    ]);
    assert.equal(f.session.spaces.getSnapshot().spaces[0].ownerId, 'account-a');
    assert.equal(f.requests.some(request => request.options.method === 'POST'), false);
  } finally { f.session.dispose(); }
});

test('disposed account composition ignores subsequent connectivity events', async () => {
  const f = fixture(signedIn('account-a'));
  await f.session.refresh();
  f.session.dispose();
  const count = f.requests.length;
  f.windowRef.navigator.onLine = false;
  f.windowRef.dispatchEvent(new Event('offline'));
  f.windowRef.navigator.onLine = true;
  f.windowRef.dispatchEvent(new Event('online'));
  await f.session.refresh();
  assert.equal(f.requests.length, count);
});

test('offline releases a stalled identity read so online can start a fresh account pass', async () => {
  const f = fixture(signedIn('account-a'));
  const fetch = f.windowRef.fetch;
  let first = true;
  f.windowRef.fetch = (path, options) => {
    if (first && path === '/auth/session') { first = false; return new Promise(() => {}); }
    return fetch(path, options);
  };
  try {
    const pending = f.session.refresh();
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    await pending;
    assert.equal(f.session.identity.getSnapshot().state, 'unavailable');
    f.windowRef.navigator.onLine = true;
    f.windowRef.dispatchEvent(new Event('online'));
    await f.session.refresh();
    assert.equal(f.session.identity.getSnapshot().subjectId, 'account-a');
    assert.equal(f.session.spaces.getSnapshot().state, 'ready');
    assert.deepEqual(f.requests.map(request => request.path), ['/auth/session', '/account/spaces']);
  } finally { f.session.dispose(); }
});

test('late cancelled identity body cannot replace the subject verified after reconnect', async () => {
  const f = fixture(signedIn('account-a'));
  const fetch = f.windowRef.fetch;
  const lateBody = deferred();
  let first = true;
  f.windowRef.fetch = (path, options) => {
    if (first && path === '/auth/session') {
      first = false;
      return Promise.resolve({ ok: true, status: 200, json: () => lateBody.promise });
    }
    return fetch(path, options);
  };
  try {
    const pending = f.session.refresh();
    await Promise.resolve();
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    await pending;
    f.windowRef.navigator.onLine = true;
    f.windowRef.dispatchEvent(new Event('online'));
    await f.session.refresh();
    lateBody.resolve(signedIn('stale-account'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(f.session.identity.getSnapshot().subjectId, 'account-a');
    assert.equal(f.session.spaces.getSnapshot().spaces[0].ownerId, 'account-a');
  } finally { f.session.dispose(); }
});


const registrationPolicy = enabled => ({
  $schema: 'prototype-ordax.registration-legal-policy/1', active: true, registrationEnabled: enabled,
  policyId: '11111111-1111-4111-8111-111111111111',
  privacy: {version: '2026-10-02', effectiveDate: '2026-10-02', sha256: 'a'.repeat(64), url: 'https://ordax.example/privacidade/'},
  terms: {version: '2026-10-02', effectiveDate: '2026-10-02', sha256: 'b'.repeat(64), url: 'https://ordax.example/termos/'},
});

test('anonymous Web registration follows validated server policy and revalidates before navigation', async () => {
  const f = fixture();
  let enabled = true;
  f.server.readPolicy = options => {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    return response(registrationPolicy(enabled));
  };
  try {
    await f.session.refresh();
    assert.deepEqual(f.session.actions.getSnapshot().supportedActions, ['sign-in', 'register']);
    await f.session.actions.execute('register');
    assert.deepEqual(f.navigations, ['/cadastro/']);
    enabled = false;
    await assert.rejects(f.session.actions.execute('register'));
    assert.deepEqual(f.navigations, ['/cadastro/'], 'Revoked policy must not navigate again');
    assert.deepEqual(f.session.actions.getSnapshot().supportedActions, ['sign-in']);
  } finally { f.session.dispose(); }
});

test('invalid or failed registration policy never enables signup and does not block sign-in', async () => {
  const f = fixture();
  try {
    f.server.readPolicy = () => response({registrationEnabled: true});
    await f.session.refresh();
    assert.deepEqual(f.session.actions.getSnapshot().supportedActions, ['sign-in']);
    f.server.readPolicy = () => { throw Error('gateway unavailable'); };
    await f.session.refresh();
    await assert.rejects(f.session.actions.execute('register'));
    assert.equal(f.requests.some(request => request.path === '/account/spaces'), false);
    await f.session.actions.execute('sign-in');
    assert.deepEqual(f.navigations, ['/login/']);
  } finally { f.session.dispose(); }
});

test('signed-in and unavailable identities do not query public signup policy', async () => {
  for (const value of [signedIn('account-a'), {$schema: 'prototype-ordax.public-identity-session/1', provider: 'unconfigured'}]) {
    const f = fixture(value);
    try {
      await f.session.refresh();
      assert.equal(f.requests.some(request => request.path === '/auth/registration-policy'), false);
      assert.equal(f.session.actions.getSnapshot().supportedActions.includes('register'), false);
    } finally { f.session.dispose(); }
  }
});

test('offline aborts a stalled signup policy and ignores its late permission', async () => {
  const f = fixture();
  const late = deferred(), started = deferred();
  let signal;
  f.server.readPolicy = options => { signal = options.signal; started.resolve(); return late.promise; };
  try {
    const pending = f.session.refresh();
    await started.promise;
    f.windowRef.navigator.onLine = false;
    f.windowRef.dispatchEvent(new Event('offline'));
    await pending;
    assert.equal(signal.aborted, true);
    late.resolve(response(registrationPolicy(true)));
    await Promise.resolve();
    assert.equal(f.session.actions.getSnapshot().supportedActions.includes('register'), false);
  } finally { f.session.dispose(); }
});

test('account replacement cancels old anonymous signup permission', async () => {
  const f = fixture();
  const late = deferred(), started = deferred();
  let signal;
  f.server.readPolicy = options => { signal = options.signal; started.resolve(); return late.promise; };
  try {
    const pending = f.session.refresh();
    await started.promise;
    f.server.session = signedIn('account-b');
    await f.session.identity.refresh();
    await pending;
    assert.equal(signal.aborted, true);
    late.resolve(response(registrationPolicy(true)));
    await Promise.resolve();
    assert.deepEqual(f.session.actions.getSnapshot().supportedActions, ['sign-out']);
  } finally { f.session.dispose(); }
});

test('disposing Web session aborts a pending registration policy', async () => {
  const f = fixture();
  const late = deferred(), started = deferred();
  let signal;
  f.server.readPolicy = options => { signal = options.signal; started.resolve(); return late.promise; };
  const pending = f.session.refresh();
  await started.promise;
  f.session.dispose();
  await pending;
  assert.equal(signal.aborted, true);
  late.resolve(response(registrationPolicy(true)));
  await Promise.resolve();
  assert.equal(f.session.actions.getSnapshot().supportedActions.includes('register'), false);
});
