import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_LOGIN_PATH,
  createWebEntryLifecycle,
  decideWebEntry,
  isLocalWebLayoutPreview,
} from '../system/composition/web/auth-entry-gate.mjs';
import { mapWebAccountResponse } from '../api/web-account-proxy.mjs';

test('canonical Web mounts the workspace only for an authenticated session', () => {
  assert.equal(WEB_LOGIN_PATH, '/login/');
  assert.equal(decideWebEntry({ state: 'signed-in' }), 'workspace');
  assert.equal(decideWebEntry({ state: 'signed-out' }), 'login');
  assert.equal(decideWebEntry({ state: 'unavailable' }), 'unavailable');
  assert.equal(decideWebEntry(null), 'unavailable');
});

test('only bounded loopback layout proofs bypass the account gate', () => {
  const explicitLocal = { location: { hostname: 'localhost', pathname: '/dev/', search: '?preview=layout' } };
  const standaloneProof = { location: { hostname: '127.0.0.1', pathname: '/', search: '' } };
  const mountedProof = { location: { hostname: '127.0.0.1', pathname: '/ordax/', search: '' } };
  const unrelatedLocal = { location: { hostname: '127.0.0.1', pathname: '/private/', search: '' } };
  const remoteExplicit = { location: { hostname: 'web.ordax.com.br', pathname: '/', search: '?preview=layout' } };
  const remoteMounted = { location: { hostname: 'web.ordax.com.br', pathname: '/ordax/', search: '' } };

  assert.equal(isLocalWebLayoutPreview(explicitLocal), true);
  assert.equal(isLocalWebLayoutPreview(standaloneProof), true);
  assert.equal(isLocalWebLayoutPreview(mountedProof), true);
  assert.equal(isLocalWebLayoutPreview(unrelatedLocal), false);
  assert.equal(isLocalWebLayoutPreview(remoteExplicit), false);
  assert.equal(isLocalWebLayoutPreview(remoteMounted), false);
  assert.equal(
    decideWebEntry({ state: 'signed-out' }, { allowLocalLayoutPreview: true }),
    'workspace',
  );
});

test('successful Web password login returns to the authenticated product root', () => {
  const request = new Request(
    'https://web.ordax.com.br/api/web-account-proxy?ordax_path=%2Fauth%2Flogin',
    { method: 'POST' },
  );
  const upstream = new Response(null, {
    status: 303,
    headers: {
      location: '/conta/',
      'cache-control': 'no-store, max-age=0',
    },
  });
  const mapped = mapWebAccountResponse(request, upstream);
  assert.notEqual(mapped, upstream);
  assert.equal(mapped.status, 303);
  assert.equal(mapped.headers.get('location'), '/');
  assert.equal(mapped.headers.get('cache-control'), 'no-store, max-age=0');
});

test('Web response mapping never broadens other redirects or ambiguous rewrites', () => {
  const failure = new Response(null, { status: 303, headers: { location: '/login/?erro=credenciais' } });
  const login = new Request(
    'https://web.ordax.com.br/api/web-account-proxy?ordax_path=%2Fauth%2Flogin',
    { method: 'POST' },
  );
  assert.equal(mapWebAccountResponse(login, failure), failure);

  const ambiguous = new Request(
    'https://web.ordax.com.br/api/web-account-proxy?ordax_path=%2Fauth%2Flogin&ordax_path=%2Faccount%2Fclose',
    { method: 'POST' },
  );
  const accountRedirect = new Response(null, { status: 303, headers: { location: '/conta/' } });
  assert.equal(mapWebAccountResponse(ambiguous, accountRedirect), accountRedirect);

  const read = new Request(
    'https://web.ordax.com.br/api/web-account-proxy?ordax_path=%2Fauth%2Flogin',
    { method: 'GET' },
  );
  assert.equal(mapWebAccountResponse(read, accountRedirect), accountRedirect);
});

test('Web entry awaits the first session read and recovers without a duplicate workspace', () => {
  const events = [];
  const lifecycle = createWebEntryLifecycle({
    onWorkspace: () => events.push('mount'),
    onLogin: () => events.push('login'),
    onUnavailable: () => events.push('unavailable'),
  });
  assert.equal(lifecycle.update({ state: 'signed-in' }), null, 'No pre-verification mount');
  assert.deepEqual(events, []);
  lifecycle.start({ state: 'unavailable' });
  assert.deepEqual(events, ['unavailable']);
  lifecycle.update({ state: 'unavailable' });
  assert.deepEqual(events, ['unavailable'], 'Equivalent failure does not re-render');
  lifecycle.update({ state: 'signed-in' });
  lifecycle.update({ state: 'signed-in' });
  assert.deepEqual(events, ['unavailable', 'mount'], 'Verified reconnect mounts once');
  lifecycle.update({ state: 'unavailable' });
  lifecycle.update({ state: 'signed-in' });
  lifecycle.update({ state: 'signed-out' });
  assert.deepEqual(events, ['unavailable', 'mount', 'unavailable', 'mount', 'login']);
  lifecycle.dispose();
  assert.equal(lifecycle.update({ state: 'signed-in' }), null, 'Disposed gate must not remount');
  assert.throws(() => lifecycle.start({ state: 'signed-in' }), /already started or disposed/);
});

test('Web entry lifecycle never treats a remote preview query as session authority', () => {
  const remote = { location: { hostname: 'web.ordax.com.br', pathname: '/', search: '?preview=layout' } };
  const local = { location: { hostname: 'localhost', pathname: '/', search: '?preview=layout' } };
  assert.equal(isLocalWebLayoutPreview(remote), false);
  assert.equal(isLocalWebLayoutPreview(local), true);
  for (const [preview, expected] of [[false, 'login'], [true, 'workspace']]) {
    const events = [];
    const lifecycle = createWebEntryLifecycle({
      allowLocalLayoutPreview: preview,
      onWorkspace: () => events.push('workspace'),
      onLogin: () => events.push('login'),
      onUnavailable: () => events.push('unavailable'),
    });
    lifecycle.start({ state: 'signed-out' });
    assert.deepEqual(events, [expected]);
    lifecycle.dispose();
  }
  assert.throws(() => createWebEntryLifecycle({
    onWorkspace: () => {}, onLogin: () => {},
  }), /onUnavailable/);
});
