import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAccountSession } from '../system/composition/web/account-session.mjs';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const signedIn = {
  $schema: 'prototype-ordax.public-identity-session/1',
  provider: 'configured',
  authenticated: true,
  status: 'authenticated',
  subject: USER_ID,
  email: 'member@example.invalid',
};
const response = value => ({ ok: true, status: 200, json: async () => structuredClone(value) });

function fixture() {
  const windowRef = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const requests = [];
  Object.assign(windowRef, {
    navigator: { onLine: true },
    document,
    location: { assign() {} },
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/auth/session') return response(signedIn);
      if (path === '/account/spaces') {
        return response({
          $schema: 'prototype-ordax.account-spaces/1',
          spaces: [{ id: SPACE_ID, name: 'Space A', kind: 'professional', state: 'active', ownerId: USER_ID }],
        });
      }
      if (typeof path === 'string' && path.startsWith('/account/space-members?')) {
        return response({
          schema: 'ordax.space-members-page/1',
          spaceId: SPACE_ID,
          members: [{ spaceId: SPACE_ID, userId: USER_ID, role: 'owner', state: 'active' }],
          nextCursor: null,
        });
      }
      throw new Error(`Unexpected endpoint: ${path}`);
    },
  });
  return { session: createWebAccountSession(windowRef), requests };
}

test('Web account session composes members as an on-demand authorized read', async () => {
  const f = fixture();
  try {
    await f.session.refresh();
    assert.equal(f.requests.some(request => String(request.path).startsWith('/account/space-members?')), false);

    const page = await f.session.members.list({ spaceId: SPACE_ID });
    assert.equal(page.spaceId, SPACE_ID);
    assert.equal(page.members[0].role, 'owner');

    const memberRequest = f.requests.find(request => String(request.path).startsWith('/account/space-members?'));
    assert.ok(memberRequest);
    assert.equal(memberRequest.options.method, 'GET');
    assert.equal(memberRequest.options.credentials, 'same-origin');
    assert.equal(memberRequest.options.cache, 'no-store');
  } finally {
    f.session.dispose();
  }
});

test('Web members composition rejects stale or unauthorized Space before transport', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () => f.session.members.list({ spaceId: SPACE_ID }),
      /catalog is not ready/,
    );
    assert.equal(f.requests.length, 0);

    await f.session.refresh();
    const before = f.requests.length;
    await assert.rejects(
      () => f.session.members.list({ spaceId: '33333333-3333-4333-8333-333333333333' }),
      /not present in the current authorized Spaces catalog/,
    );
    assert.equal(f.requests.length, before);
  } finally {
    f.session.dispose();
  }
});
