import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_INVITABLE_ROLES,
  SPACE_INVITE_ACTIONS,
  SPACE_INVITE_CREATE_REQUEST_SCHEMA,
  SPACE_INVITE_CREATE_RESULT_SCHEMA,
  SPACE_INVITE_REVOKE_REQUEST_SCHEMA,
  SPACE_INVITE_SCHEMA,
  SPACE_INVITE_STATES,
  SPACE_INVITE_TOKEN_REQUEST_SCHEMA,
  SPACE_INVITES_SCHEMA,
  assertSpaceInvitesPort,
  validateSpaceInvite,
  validateSpaceInviteCreateRequest,
  validateSpaceInviteCreateResult,
  validateSpaceInviteRevokeRequest,
  validateSpaceInviteTokenRequest,
  validateSpaceInvitesSnapshot,
} from "../system/contracts/space-invites.mjs";

const token = "ab".repeat(32);
const idempotencyKey = "123e4567-e89b-42d3-a456-426614174000";
const pendingInvite = Object.freeze({
  schema: SPACE_INVITE_SCHEMA,
  id: "invite-1",
  spaceId: "space-1",
  role: "member",
  state: "pending",
  targetUserId: null,
  createdAt: "2026-10-17T06:00:00Z",
  expiresAt: "2026-10-18T06:00:00Z",
});

test("invite lifecycle is separate from membership and ownership", () => {
  assert.deepEqual(SPACE_INVITE_ACTIONS, ["create", "revoke", "accept", "decline"]);
  assert.deepEqual(SPACE_INVITE_STATES, ["pending", "accepted", "declined", "expired", "revoked"]);
  assert.deepEqual(SPACE_INVITABLE_ROLES, ["admin", "member", "viewer"]);
  assert.equal(SPACE_INVITABLE_ROLES.includes("owner"), false);
});

test("invite read model never contains bearer token or token hash", () => {
  const invite = validateSpaceInvite(pendingInvite);
  assert.equal("token" in invite, false);
  assert.equal("tokenHash" in invite, false);

  assert.throws(
    () => validateSpaceInvite({ ...invite, token }),
    /unsupported field token/,
  );
});

test("create request can bind an invite to an account but never to owner authority", () => {
  assert.deepEqual(
    validateSpaceInviteCreateRequest({
      schema: SPACE_INVITE_CREATE_REQUEST_SCHEMA,
      spaceId: "space-1",
      role: "viewer",
      targetUserId: "user-2",
      idempotencyKey,
    }),
    {
      schema: SPACE_INVITE_CREATE_REQUEST_SCHEMA,
      spaceId: "space-1",
      role: "viewer",
      targetUserId: "user-2",
      idempotencyKey,
    },
  );
  assert.throws(
    () => validateSpaceInviteCreateRequest({
      schema: SPACE_INVITE_CREATE_REQUEST_SCHEMA,
      spaceId: "space-1",
      role: "owner",
      targetUserId: null,
      idempotencyKey,
    }),
    /not assignable/,
  );
});

test("create result exposes bearer token only on first successful creation", () => {
  const created = validateSpaceInviteCreateResult({
    schema: SPACE_INVITE_CREATE_RESULT_SCHEMA,
    invite: pendingInvite,
    token: token.toUpperCase(),
    created: true,
  });
  assert.equal(created.token, token);
  assert.equal(created.created, true);

  const replay = validateSpaceInviteCreateResult({
    schema: SPACE_INVITE_CREATE_RESULT_SCHEMA,
    invite: pendingInvite,
    token: null,
    created: false,
  });
  assert.equal(replay.token, null);

  assert.throws(
    () => validateSpaceInviteCreateResult({
      schema: SPACE_INVITE_CREATE_RESULT_SCHEMA,
      invite: pendingInvite,
      token,
      created: false,
    }),
    /cannot return a bearer token/,
  );
});

test("invite token actions require an exact 256-bit bearer token", () => {
  assert.deepEqual(
    validateSpaceInviteTokenRequest({
      schema: SPACE_INVITE_TOKEN_REQUEST_SCHEMA,
      token: token.toUpperCase(),
      idempotencyKey,
    }),
    {
      schema: SPACE_INVITE_TOKEN_REQUEST_SCHEMA,
      token,
      idempotencyKey,
    },
  );
  assert.throws(
    () => validateSpaceInviteTokenRequest({
      schema: SPACE_INVITE_TOKEN_REQUEST_SCHEMA,
      token: "abc",
      idempotencyKey,
    }),
    /256-bit hexadecimal token/,
  );
});

test("revoke targets invite identity and action snapshots are capability gated", () => {
  assert.deepEqual(
    validateSpaceInviteRevokeRequest({
      schema: SPACE_INVITE_REVOKE_REQUEST_SCHEMA,
      inviteId: "invite-1",
      idempotencyKey,
    }),
    {
      schema: SPACE_INVITE_REVOKE_REQUEST_SCHEMA,
      inviteId: "invite-1",
      idempotencyKey,
    },
  );

  const snapshot = Object.freeze({ supportedActions: Object.freeze(["create", "revoke"]) });
  const port = Object.freeze({
    schema: SPACE_INVITES_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    createInvite: async () => {},
    revokeInvite: async () => {},
    acceptInvite: async () => {},
    declineInvite: async () => {},
  });
  assert.equal(assertSpaceInvitesPort(port), port);
  assert.deepEqual(validateSpaceInvitesSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateSpaceInvitesSnapshot({ supportedActions: ["transfer-owner"] }),
    /Unsupported or duplicate/,
  );
});

test("calendar-invalid timestamps fail closed even when Date.parse would normalize them", () => {
  for (const value of [
    "2026-02-30T06:00:00Z",
    "2026-04-31T06:00:00Z",
    "2026-02-29T06:00:00+03:00",
    "2026-10-30T24:00:00Z",
  ]) {
    assert.throws(
      () => validateSpaceInvite({ ...pendingInvite, createdAt: value }),
      /must be an ISO timestamp/,
      value,
    );
  }
  const leapDay = validateSpaceInvite({
    ...pendingInvite,
    createdAt: "2028-02-29T05:00:00+03:00",
    expiresAt: "2028-02-29T06:00:00+03:00",
  });
  assert.equal(leapDay.createdAt, "2028-02-29T02:00:00.000Z");
  assert.equal(leapDay.expiresAt, "2028-02-29T03:00:00.000Z");
});

test("invite descriptors require strict coherent ISO expiration and reject unknown sensitive fields", () => {
  assert.throws(
    () => validateSpaceInvite({
      ...pendingInvite,
      createdAt: "2026-10-18T06:00:00Z",
      expiresAt: "2026-10-17T06:00:00Z",
    }),
    /must be after/,
  );
  assert.throws(
    () => validateSpaceInvite({
      ...pendingInvite,
      createdAt: "October 17, 2026 06:00 UTC",
    }),
    /must be an ISO timestamp/,
  );
  assert.throws(
    () => validateSpaceInviteCreateRequest({
      schema: SPACE_INVITE_CREATE_REQUEST_SCHEMA,
      spaceId: "space-1",
      role: "member",
      targetUserId: null,
      idempotencyKey,
      email: "person@example.com",
    }),
    /unsupported field email/,
  );
});
