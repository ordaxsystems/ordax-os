import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-agent.mjs";
import { DEVICE_ACTION_REQUEST_SCHEMA } from "../system/contracts/device-action-envelope.mjs";
import {
  DEVICE_ACTION_PREFLIGHT_SCHEMA,
  createDeviceActionPreflight,
} from "../system/services/device-agent/action-preflight.mjs";

function action(client, overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "action-1",
    idempotencyKey: "idempotency-1",
    accountId: "account-1",
    spaceId: "space-1",
    projectId: "project-1",
    deviceId: "device-1",
    client,
    capability: "orders.update",
    operation: "update",
    parameters: { status: "ready" },
    requestedAt: 1000,
    expiresAt: 10000,
    ...overrides,
  };
}

function grant(client, overrides = {}) {
  return {
    accountId: "account-1",
    spaceId: "space-1",
    projectId: "project-1",
    deviceId: "device-1",
    client,
    capability: "orders.update",
    mode: "write",
    approved: true,
    ...overrides,
  };
}

function reader(state = "ready") {
  const callers = [];
  return {
    callers,
    port: Object.freeze({
      schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
      async capabilities({ client }) {
        callers.push(client);
        return {
          schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
          state,
          capabilities: [{ id: "orders.update", modes: ["write"] }],
        };
      },
    }),
  };
}

test("system device preflight can serve independent native apps, web and external MCP clients", async () => {
  const { port, callers } = reader();
  const preflight = createDeviceActionPreflight({ capabilityReader: port, now: () => 2000 });
  for (const client of ["ordax-native", "ordax-web", "mcp"]) {
    const result = await preflight.check(action(client), grant(client));
    assert.equal(result.schema, DEVICE_ACTION_PREFLIGHT_SCHEMA);
    assert.equal(result.request.client, client);
    assert.equal(result.grant.client, client);
    assert.equal(result.capability.id, "orders.update");
    assert.equal(result.dispatchAuthority, "none");
    assert.equal("execute" in result, false);
    assert.equal("grant" in preflight, false);
  }
  assert.deepEqual(callers, ["ordax-native", "ordax-web", "mcp"]);
});

test("a client, Space, project, device or capability mismatch fails before discovery", async () => {
  const { port, callers } = reader();
  const preflight = createDeviceActionPreflight({ capabilityReader: port, now: () => 2000 });
  for (const overrides of [
    { client: "ordax-native" },
    { spaceId: "another-space" },
    { projectId: "another-project" },
    { deviceId: "another-device" },
    { capability: "another.action" },
    { accountId: "another-account" },
  ]) {
    await assert.rejects(() => preflight.check(action("mcp"), grant("mcp", overrides)), TypeError);
  }
  assert.equal(callers.length, 0);
});

test("preflight never becomes an authority: missing approval, expired or degraded fail closed", async () => {
  const available = createDeviceActionPreflight({ capabilityReader: reader().port, now: () => 2000 });
  await assert.rejects(() => available.check(action("ordax-native"), grant("ordax-native", { approved: false })), /approval|approved/);
  await assert.rejects(() => available.check(action("ordax-native", { expiresAt: 2000 }), grant("ordax-native")), /expired/);
  const degraded = createDeviceActionPreflight({ capabilityReader: reader("degraded").port, now: () => 2000 });
  await assert.rejects(() => degraded.check(action("mcp"), grant("mcp")), /not ready/);
  assert.equal(typeof available.check, "function");
  assert.equal("execute" in available, false);
  assert.equal("authorize" in available, false);
  assert.equal("requestAction" in available, false);
});
