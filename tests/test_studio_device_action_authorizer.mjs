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
    capability: "files.write",
    operation: "text.write",
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
    capability: "files.write",
    mode: "write",
    approved: true,
    ...overrides,
  };
}

function reader({ state = "ready", modes = ["write"], id = "files.write" } = {}) {
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

test("Studio authorizes only a catalog-bound exact live write grant", async () => {
  const authorizer = createStudioDeviceActionAuthorizer({
    capabilityReader: reader(),
    now: () => 2_000,
  });
  const value = await authorizer.authorize(request(), grant());

  assert.equal(value.schema, STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA);
  assert.equal(value.request.actionId, "studio-action-1");
  assert.equal(value.grant.actionGateway, "ordax");
  assert.equal(value.capability.id, "files.write");
  assert.deepEqual(value.capability.modes, ["write"]);
  assert.equal(value.binding.capability, "files.write");
  assert.equal(value.binding.operation, "text.write");
  assert.equal(value.binding.confirmation, "policy-gated");
  assert.equal(value.authorizedAt, 2_000);
  assert.equal(value.dispatchAuthority, "none");
});

test("Studio authorization rejects a capability-operation pair outside the canonical catalog", async () => {
  const authorizer = createStudioDeviceActionAuthorizer({
    capabilityReader: reader(),
    now: () => 2_000,
  });
  await assert.rejects(
    () => authorizer.authorize(request({ operation: "unknown.write" }), grant()),
    /not in the Studio action catalog/,
  );
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
    capabilityReader: reader({ id: "git.read" }),
    now: () => 2_000,
  });
  await assert.rejects(() => absent.authorize(request(), grant()), /not currently available/);

  const readOnly = createStudioDeviceActionAuthorizer({
    capabilityReader: reader({ modes: ["read"] }),
    now: () => 2_000,
  });
  await assert.rejects(() => readOnly.authorize(request(), grant()), /not currently writable/);
});

test("Studio mutation authorizer refuses read catalog bindings", async () => {
  const readAuthorizer = createStudioDeviceActionAuthorizer({
    capabilityReader: reader({ modes: ["read"], id: "files.read" }),
    now: () => 2_000,
  });
  await assert.rejects(
    () => readAuthorizer.authorize(
      request({ capability: "files.read", operation: "text.read", parameters: { path: "README.md" } }),
      grant({ capability: "files.read", mode: "write" }),
    ),
    /write catalog binding/,
  );
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
