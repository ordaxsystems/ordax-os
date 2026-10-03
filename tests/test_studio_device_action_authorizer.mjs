import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  DEVICE_AGENT_PORT_SCHEMA,
} from "../system/contracts/device-agent.mjs";
import {
  DEVICE_ACTION_REQUEST_SCHEMA,
} from "../system/contracts/operational-realtime.mjs";
import {
  STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA,
  createStudioDeviceActionAuthorizer,
} from "../system/services/device-agent/studio-action-authorizer.mjs";

function request(overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "studio-action-1",
    idempotencyKey: "studio-idem-1",
    accountId: "account-1",
    spaceId: "space-dev",
    projectId: "ordax-project",
    deviceId: "device-1",
    client: "ordax-native",
    capability: "project.text_write",
    operation: "write",
    parameters: { path: "README.md", content: "hello" },
    requestedAt: 1_000,
    expiresAt: 10_000,
    expectedDeviceRevision: 4,
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    accountId: "account-1",
    spaceId: "space-dev",
    projectId: "ordax-project",
    deviceId: "device-1",
    client: "ordax-native",
    capability: "project.text_write",
    mode: "write",
    approved: true,
    ...overrides,
  };
}

function reader({ state = "ready", modes = ["read", "write"], id = "project.text_write" } = {}) {
  return Object.freeze({
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities({ client }) {
      assert.equal(client, "ordax-native");
      return {
        schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
        state,
        capabilities: [{ id, modes }],
      };
    },
  });
}

test("Studio authorizes only an exact live write grant for an available capability", async () => {
  const authorizer = createStudioDeviceActionAuthorizer({
    capabilityReader: reader(),
    now: () => 2_000,
  });
  const value = await authorizer.authorize(request(), grant());

  assert.equal(value.schema, STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA);
  assert.equal(value.request.actionId, "studio-action-1");
  assert.equal(value.grant.actionGateway, "ordax");
  assert.equal(value.capability.id, "project.text_write");
  assert.deepEqual(value.capability.modes, ["read", "write"]);
  assert.equal(value.authorizedAt, 2_000);
  assert.equal(value.dispatchAuthority, "none");
});

test("Studio authorization fails closed for mismatched, expired, absent or read-only authority", async () => {
  const authorizer = createStudioDeviceActionAuthorizer({
    capabilityReader: reader(),
    now: () => 2_000,
  });

  await assert.rejects(
    () => authorizer.authorize(request(), grant({ projectId: "other-project" })),
    /projectId/,
  );

  const expired = createStudioDeviceActionAuthorizer({
    capabilityReader: reader(),
    now: () => 10_000,
  });
  await assert.rejects(() => expired.authorize(request(), grant()), /expired/);

  const absent = createStudioDeviceActionAuthorizer({
    capabilityReader: reader({ id: "git.status" }),
    now: () => 2_000,
  });
  await assert.rejects(() => absent.authorize(request(), grant()), /not currently available/);

  const readOnly = createStudioDeviceActionAuthorizer({
    capabilityReader: reader({ modes: ["read"] }),
    now: () => 2_000,
  });
  await assert.rejects(() => readOnly.authorize(request(), grant()), /not currently writable/);
});

test("Studio authorization refuses degraded or malformed capability discovery", async () => {
  const degraded = createStudioDeviceActionAuthorizer({
    capabilityReader: reader({ state: "degraded" }),
    now: () => 2_000,
  });
  await assert.rejects(() => degraded.authorize(request(), grant()), /not ready/);

  const malformedReader = Object.freeze({
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities() {
      return { schema: "wrong", state: "ready", capabilities: [] };
    },
  });
  const malformed = createStudioDeviceActionAuthorizer({
    capabilityReader: malformedReader,
    now: () => 2_000,
  });
  await assert.rejects(() => malformed.authorize(request(), grant()), /failed closed/);
});

test("Studio authorizer cannot be constructed with a mutable Device Agent port", () => {
  let executeCalls = 0;
  const mutablePort = Object.freeze({
    schema: DEVICE_AGENT_PORT_SCHEMA,
    capabilities: async () => ({
      schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
      state: "ready",
      capabilities: [],
    }),
    execute() {
      executeCalls += 1;
    },
  });

  assert.throws(
    () => createStudioDeviceActionAuthorizer({ capabilityReader: mutablePort }),
    /capability reader/,
  );
  assert.equal(executeCalls, 0);
});
