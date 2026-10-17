import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAccountSession } from '../system/composition/web/account-session.mjs';

const SPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_SPACE_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

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
      if (typeof path === 'string' && path.startsWith('/account/space-actor-capability?')) {
        return response({ schema: 'ordax.space-actor-capability/1', spaceId: SPACE_ID, userId: USER_ID, role: 'owner', state: 'active', canManageMembers: true });
      }
      if (typeof path === 'string' && path.startsWith('/account/space-members?')) {
        return response({
          schema: 'ordax.space-members-page/1',
          spaceId: SPACE_ID,
          members: [{ spaceId: SPACE_ID, userId: USER_ID, role: 'owner', state: 'active' }],
          nextCursor: null,
        });
      }
      if (path === '/account/space-membership-actions') {
        const request = JSON.parse(options.body);
        return response({
          schema: 'ordax.space-membership-action-result/1',
          spaceId: request.spaceId,
          targetUserId: request.targetUserId,
          role: request.action === 'change-role' ? request.role : 'member',
          state: request.action === 'suspend' ? 'suspended' : 'active',
          removed: request.action === 'remove',
          changed: true,
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
      () => f.session.members.list({ spaceId: OTHER_SPACE_ID }),
      /not present in the current authorized Spaces catalog/,
    );
    assert.equal(f.requests.length, before);
  } finally {
    f.session.dispose();
  }
});

test('Web account session composes server-authoritative actor capability on demand', async () => {
  const f = fixture();
  try {
    await assert.rejects(() => f.session.actorCapability.read({ spaceId: SPACE_ID }), /catalog is not ready/);
    assert.equal(f.requests.length, 0);
    await f.session.refresh();
    const capability = await f.session.actorCapability.read({ spaceId: SPACE_ID });
    assert.equal(capability.role, 'owner');
    assert.equal(capability.canManageMembers, true);
    const read = f.requests.find(request => String(request.path).startsWith('/account/space-actor-capability?'));
    assert.ok(read); assert.equal(read.options.method, 'GET'); assert.equal(read.options.credentials, 'same-origin');
  } finally { f.session.dispose(); }
});

test('Web account session composes membership actions through the canonical runtime', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      () => f.session.membershipActions.suspendMember(SPACE_ID, USER_ID, IDEMPOTENCY_KEY),
      /Spaces catalog is not ready/,
    );
    assert.equal(f.requests.length, 0);

    await f.session.refresh();
    const result = await f.session.membershipActions.changeMemberRole(
      SPACE_ID,
      USER_ID,
      'admin',
      IDEMPOTENCY_KEY,
    );
    assert.equal(result.spaceId, SPACE_ID);
    assert.equal(result.targetUserId, USER_ID);
    assert.equal(result.role, 'admin');

    const mutation = f.requests.find(request => request.path === '/account/space-membership-actions');
    assert.ok(mutation);
    assert.equal(mutation.options.method, 'POST');
    assert.equal(mutation.options.credentials, 'same-origin');
    assert.equal(mutation.options.cache, 'no-store');
    assert.equal(mutation.options.redirect, 'manual');
    assert.deepEqual(JSON.parse(mutation.options.body), {
      schema: 'ordax.space-membership-action-request/1',
      action: 'change-role',
      spaceId: SPACE_ID,
      targetUserId: USER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      role: 'admin',
    });
  } finally {
    f.session.dispose();
  }
});

test('Web membership action composition rejects cross-account Space before mutation transport', async () => {
  const f = fixture();
  try {
    await f.session.refresh();
    const before = f.requests.length;
    await assert.rejects(
      () => f.session.membershipActions.removeMember(OTHER_SPACE_ID, USER_ID, IDEMPOTENCY_KEY),
      /target is not available to the current account/,
    );
    assert.equal(f.requests.length, before);
  } finally {
    f.session.dispose();
  }
});
