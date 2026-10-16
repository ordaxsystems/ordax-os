import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_LOGIN_PATH,
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

test('only loopback layout proofs bypass the account gate', () => {
  const explicitLocal = { location: { hostname: 'localhost', pathname: '/', search: '?preview=layout' } };
  const mountedProof = { location: { hostname: '127.0.0.1', pathname: '/ordax/', search: '' } };
  const remoteExplicit = { location: { hostname: 'web.ordax.com.br', pathname: '/', search: '?preview=layout' } };
  const remoteMounted = { location: { hostname: 'web.ordax.com.br', pathname: '/ordax/', search: '' } };
  assert.equal(isLocalWebLayoutPreview(explicitLocal), true);
  assert.equal(isLocalWebLayoutPreview(mountedProof), true);
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
