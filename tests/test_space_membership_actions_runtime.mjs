import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
  SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
} from "../system/contracts/space-membership-actions.mjs";
import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
} from "../system/contracts/spaces.mjs";
import { createSpaceMembershipActionsRuntime } from "../system/services/spaces/membership-actions.mjs";

const SPACE_ID = "space-123";
const TARGET_USER_ID = "user-456";
const IDEMPOTENCY_KEY = "123e4567-e89b-42d3-a456-426614174000";

function spacesPort(state = "ready", spaces = [{
  id: SPACE_ID,
  name: "Pizzaria",
  kind: "professional",
  role: "owner",
  state: "active",
  profileId: null,
  domain: "food",
  subtype: "pizzeria",
}]) {
  const snapshot = Object.freeze({
    schema: SPACES_SNAPSHOT_SCHEMA,
    state,
    spaces: Object.freeze(spaces),
  });
  return Object.freeze({
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    reset: () => {},
  });
}

function actionsPort({ supportedActions = ["change-role", "suspend", "reactivate", "remove"] } = {}) {
  const calls = [];
  const invoke = async (method, request) => {
    calls.push({ method, request });
    return Object.freeze({ ok: true, method });
  };
  return {
    calls,
    port: Object.freeze({
      schema: SPACE_MEMBERSHIP_ACTIONS_SCHEMA,
      getSnapshot: () => Object.freeze({ supportedActions: Object.freeze([...supportedActions]) }),
      subscribe: () => () => {},
      refresh: async () => Object.freeze({ supportedActions: Object.freeze([...supportedActions]) }),
      changeMemberRole: (request) => invoke("changeMemberRole", request),
      suspendMember: (request) => invoke("suspendMember", request),
      reactivateMember: (request) => invoke("reactivateMember", request),
      removeMember: (request) => invoke("removeMember", request),
    }),
  };
}

test("membership runtime builds canonical role request and calls only the actions port", async () => {
  const actions = actionsPort();
  const runtime = createSpaceMembershipActionsRuntime({
    spaces: spacesPort(),
    membershipActions: actions.port,
  });

  const result = await runtime.changeMemberRole(
    SPACE_ID,
    TARGET_USER_ID,
    "member",
    IDEMPOTENCY_KEY,
  );

  assert.deepEqual(result, { ok: true, method: "changeMemberRole" });
  assert.equal(actions.calls.length, 1);
  assert.deepEqual(actions.calls[0], {
    method: "changeMemberRole",
    request: {
      schema: SPACE_MEMBERSHIP_ACTION_REQUEST_SCHEMA,
      action: "change-role",
      spaceId: SPACE_ID,
      targetUserId: TARGET_USER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      role: "member",
    },
  });
});

test("membership runtime maps bounded actions to their exact port methods", async () => {
  const actions = actionsPort();
  const runtime = createSpaceMembershipActionsRuntime({
    spaces: spacesPort(),
    membershipActions: actions.port,
  });

  await runtime.suspendMember(SPACE_ID, TARGET_USER_ID, IDEMPOTENCY_KEY);
  await runtime.reactivateMember(SPACE_ID, TARGET_USER_ID, IDEMPOTENCY_KEY);
  await runtime.removeMember(SPACE_ID, TARGET_USER_ID, IDEMPOTENCY_KEY);

  assert.deepEqual(
    actions.calls.map((call) => [call.method, call.request.action]),
    [
      ["suspendMember", "suspend"],
      ["reactivateMember", "reactivate"],
      ["removeMember", "remove"],
    ],
  );
});

test("membership runtime fails closed before mutation when action is unavailable", async () => {
  const actions = actionsPort({ supportedActions: ["remove"] });
  const runtime = createSpaceMembershipActionsRuntime({
    spaces: spacesPort(),
    membershipActions: actions.port,
  });

  await assert.rejects(
    runtime.suspendMember(SPACE_ID, TARGET_USER_ID, IDEMPOTENCY_KEY),
    /action is unavailable: suspend/,
  );
  assert.equal(actions.calls.length, 0);
});

test("membership runtime rejects stale or cross-account Space targets", async () => {
  const actions = actionsPort();
  const runtime = createSpaceMembershipActionsRuntime({
    spaces: spacesPort("ready", []),
    membershipActions: actions.port,
  });

  await assert.rejects(
    runtime.removeMember(SPACE_ID, TARGET_USER_ID, IDEMPOTENCY_KEY),
    /target is not available to the current account/,
  );
  assert.equal(actions.calls.length, 0);
});

test("membership runtime blocks actions while Spaces catalog is not ready", async () => {
  const actions = actionsPort();
  const runtime = createSpaceMembershipActionsRuntime({
    spaces: spacesPort("loading", []),
    membershipActions: actions.port,
  });

  await assert.rejects(
    runtime.removeMember(SPACE_ID, TARGET_USER_ID, IDEMPOTENCY_KEY),
    /Spaces catalog is not ready/,
  );
  assert.equal(actions.calls.length, 0);
});
