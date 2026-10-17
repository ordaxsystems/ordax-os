import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_MEMBERSHIP_ACTION_OUTCOME_SCHEMA,
  SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
  SPACE_MEMBERSHIP_ACTIONS,
  SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
  SPACE_MEMBERSHIP_ASSIGNABLE_ROLES,
  assertSpaceMembershipActionsPort,
  isSpaceMembershipActionSupported,
  validateSpaceMembershipActionOutcome,
  validateSpaceMembershipActionRequest,
  validateSpaceMembershipActionsSnapshot,
} from "../system/contracts/space-membership-actions.mjs";

const baseRequest = Object.freeze({
  schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
  spaceId: "space-123",
  targetUserId: "user-456",
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
});

const baseOutcome = Object.freeze({
  schema: SPACE_MEMBERSHIP_ACTION_OUTCOME_SCHEMA,
  spaceId: "space-123",
  targetUserId: "user-456",
  role: "member",
  state: "active",
  removed: false,
  changed: true,
});

test("membership actions exclude invite, add-member, owner transfer and leave", () => {
  assert.deepEqual(
    SPACE_MEMBERSHIP_ACTIONS,
    ["change-role", "suspend", "reactivate", "remove"],
  );
  for (const forbidden of ["invite", "add-member", "transfer-owner", "leave"]) {
    assert.equal(SPACE_MEMBERSHIP_ACTIONS.includes(forbidden), false);
  }
  assert.deepEqual(SPACE_MEMBERSHIP_ASSIGNABLE_ROLES, ["admin", "member", "viewer"]);
  assert.equal(SPACE_MEMBERSHIP_ASSIGNABLE_ROLES.includes("owner"), false);
});

test("membership requests are exact and never accept client authority", () => {
  const request = validateSpaceMembershipActionRequest({
    ...baseRequest,
    action: "change-role",
    role: "member",
  });
  assert.equal(request.role, "member");

  for (const [field, value] of [
    ["actorId", "actor-1"],
    ["ownerId", "actor-1"],
    ["actorRole", "owner"],
    ["authorized", true],
    ["membership", { role: "owner" }],
    ["inviteId", "invite-1"],
  ]) {
    assert.throws(
      () => validateSpaceMembershipActionRequest({
        ...baseRequest,
        action: "remove",
        [field]: value,
      }),
      new RegExp(`unsupported field ${field}`),
    );
  }
});

test("owner role cannot be assigned through membership actions", () => {
  assert.throws(
    () => validateSpaceMembershipActionRequest({
      ...baseRequest,
      action: "change-role",
      role: "owner",
    }),
    /not assignable/,
  );
  assert.throws(
    () => validateSpaceMembershipActionRequest({
      ...baseRequest,
      action: "change-role",
      role: "invalid",
    }),
    /not assignable/,
  );
});

test("non-role actions reject role and requests are bounded", () => {
  for (const action of ["suspend", "reactivate", "remove"]) {
    assert.deepEqual(
      validateSpaceMembershipActionRequest({ ...baseRequest, action }),
      { ...baseRequest, action },
    );
    assert.throws(
      () => validateSpaceMembershipActionRequest({ ...baseRequest, action, role: "member" }),
      /unsupported field role/,
    );
  }

  assert.throws(
    () => validateSpaceMembershipActionRequest({
      ...baseRequest,
      action: "remove",
      targetUserId: "   ",
    }),
    /must be bounded text/,
  );
  assert.throws(
    () => validateSpaceMembershipActionRequest({
      ...baseRequest,
      action: "remove",
      idempotencyKey: "not-a-uuid",
    }),
    /must be a UUID/,
  );
});

test("membership action outcomes are exact, bounded and server-result shaped", () => {
  assert.deepEqual(validateSpaceMembershipActionOutcome(baseOutcome), baseOutcome);
  assert.deepEqual(
    validateSpaceMembershipActionOutcome({
      ...baseOutcome,
      role: "admin",
      state: "suspended",
      removed: true,
      changed: false,
    }),
    {
      ...baseOutcome,
      role: "admin",
      state: "suspended",
      removed: true,
      changed: false,
    },
  );

  for (const [field, value, pattern] of [
    ["role", "owner", /outcome role is invalid/],
    ["state", "deleted", /outcome state is invalid/],
    ["removed", "yes", /flags must be boolean/],
    ["changed", 1, /flags must be boolean/],
  ]) {
    assert.throws(
      () => validateSpaceMembershipActionOutcome({ ...baseOutcome, [field]: value }),
      pattern,
    );
  }
  assert.throws(
    () => validateSpaceMembershipActionOutcome({ ...baseOutcome, actorRole: "owner" }),
    /unsupported field actorRole/,
  );
  const { changed, ...missingChanged } = baseOutcome;
  assert.equal(changed, true);
  assert.throws(
    () => validateSpaceMembershipActionOutcome(missingChanged),
    /missing field changed/,
  );
});

test("membership action port advertises only backend-supported operations", () => {
  const snapshot = Object.freeze({ supportedActions: Object.freeze(["suspend", "remove"]) });
  const port = Object.freeze({
    schema: SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    changeMemberRole: async () => {},
    suspendMember: async () => {},
    reactivateMember: async () => {},
    removeMember: async () => {},
  });

  assert.equal(assertSpaceMembershipActionsPort(port), port);
  assert.equal(isSpaceMembershipActionSupported(snapshot, "remove"), true);
  assert.equal(isSpaceMembershipActionSupported(snapshot, "change-role"), false);
  assert.throws(
    () => validateSpaceMembershipActionsSnapshot({ supportedActions: ["invite"] }),
    /Unsupported or duplicate/,
  );
});
