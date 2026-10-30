import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
  SPACE_MEMBERSHIP_ACTION_RESULT_SCHEMA,
} from "../system/contracts/space-membership-actions.mjs";
import { createWebSpaceMembershipActions } from "../system/adapters/web/space-membership-actions.mjs";

const SPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const KEY = "33333333-3333-4333-8333-333333333333";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function result(extra = {}) {
  return {
    schema: SPACE_MEMBERSHIP_ACTION_RESULT_SCHEMA,
    spaceId: SPACE_ID,
    targetUserId: USER_ID,
    role: "member",
    state: "active",
    removed: false,
    changed: true,
    ...extra,
  };
}

test("web membership adapter sends only canonical POST action requests", async () => {
  let seen;
  const port = createWebSpaceMembershipActions({
    fetch: async (url, options) => {
      seen = { url, options };
      return response(result());
    },
  });

  const value = await port.changeMemberRole({
    schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
    action: "change-role",
    spaceId: SPACE_ID,
    targetUserId: USER_ID,
    idempotencyKey: KEY,
    role: "member",
  });

  assert.equal(seen.url, "/account/space-membership-actions");
  assert.equal(seen.options.method, "POST");
  assert.equal(seen.options.credentials, "same-origin");
  assert.equal(seen.options.cache, "no-store");
  assert.equal(seen.options.redirect, "manual");
  assert.equal(seen.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(seen.options.body), {
    schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
    action: "change-role",
    spaceId: SPACE_ID,
    targetUserId: USER_ID,
    idempotencyKey: KEY,
    role: "member",
  });
  assert.deepEqual(value, result());
});

test("web membership adapter rejects client authority before transport", async () => {
  let calls = 0;
  const port = createWebSpaceMembershipActions({
    fetch: async () => { calls += 1; return response(result()); },
  });

  await assert.rejects(
    port.removeMember({
      schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
      action: "remove",
      spaceId: SPACE_ID,
      targetUserId: USER_ID,
      idempotencyKey: KEY,
      actorRole: "owner",
    }),
    /unsupported field actorRole/,
  );
  assert.equal(calls, 0);
});

test("web membership adapter validates server result identity", async () => {
  const port = createWebSpaceMembershipActions({
    fetch: async () => response(result({ targetUserId: "44444444-4444-4444-8444-444444444444" })),
  });
  await assert.rejects(
    port.suspendMember({
      schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
      action: "suspend",
      spaceId: SPACE_ID,
      targetUserId: USER_ID,
      idempotencyKey: KEY,
    }),
    /targets another membership/,
  );
});

test("web membership adapter exposes backend operation capability, not actor authority", async () => {
  const port = createWebSpaceMembershipActions({ fetch: async () => response(result()) });
  assert.deepEqual(port.getSnapshot().supportedActions, ["change-role", "suspend", "reactivate", "remove"]);
  const refreshed = await port.refresh();
  assert.deepEqual(refreshed, port.getSnapshot());
});

test("web membership methods cannot execute another canonical action", async () => {
  let calls = 0;
  const port = createWebSpaceMembershipActions({
    fetch: async () => { calls += 1; return response(result()); },
  });
  await assert.rejects(
    port.suspendMember({
      schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
      action: "remove",
      spaceId: SPACE_ID,
      targetUserId: USER_ID,
      idempotencyKey: KEY,
    }),
    /method\/action mismatch: suspend/,
  );
  assert.equal(calls, 0);
});
