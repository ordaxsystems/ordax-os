import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_ACTION_REQUEST_V2_SCHEMA,
  validateDeviceActionRequestV2,
} from "../system/contracts/device-action-envelope-v2.mjs";
import { DEVICE_ACTION_RECEIPT_SCHEMA } from "../system/contracts/device-action-envelope.mjs";
import {
  STUDIO_RUNTIME_V2_PORT_SCHEMA,
  assertStudioRuntimeV2Port,
  requestStudioDeviceActionV2,
} from "../system/contracts/studio-runtime-v2.mjs";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";

const noop = () => {};

function request(overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_V2_SCHEMA,
    actionId: "action-1",
    idempotencyKey: "idem-1",
    actor: { kind: "device-owner", subjectId: null },
    spaceId: null,
    projectId: null,
    deviceId: "device-1",
    client: "ordax-desktop",
    capability: "computer.windows",
    operation: "list",
    parameters: {},
    requestedAt: 1000,
    expiresAt: 2000,
    expectedDeviceRevision: null,
    ...overrides,
  };
}

function projectCatalog() {
  return {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: () => ({ persistence: "device", projects: [] }),
    subscribe: noop,
    create: noop,
    rename: noop,
    recordOpened: noop,
    recordFileOpened: noop,
    clearLastFile: noop,
    relocateLastFilePath: noop,
    remove: noop,
  };
}

function runtime(receiptOverrides = {}) {
  return {
    schema: STUDIO_RUNTIME_V2_PORT_SCHEMA,
    capabilityReader: {
      schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
      capabilities: async () => ({
        schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
        state: "ready",
        capabilities: [{ id: "computer.windows", modes: ["read"] }],
      }),
    },
    projectCatalog: projectCatalog(),
    requestAction: async (value) => ({
      schema: DEVICE_ACTION_RECEIPT_SCHEMA,
      actionId: value.actionId,
      deviceId: value.deviceId,
      state: "succeeded",
      acceptedAt: 1100,
      completedAt: 1200,
      deviceRevision: null,
      resultCode: "ok",
      message: null,
      ...receiptOverrides,
    }),
  };
}

test("device-owner v2 action needs no fabricated account, Space or project", () => {
  const value = validateDeviceActionRequestV2(request());
  assert.deepEqual(value.actor, { kind: "device-owner", subjectId: null });
  assert.equal(value.spaceId, null);
  assert.equal(value.projectId, null);
});

test("account actor requires a real subject id", () => {
  assert.throws(
    () => validateDeviceActionRequestV2(request({ actor: { kind: "account", subjectId: null } })),
    /requires a real subject id/,
  );
  const value = validateDeviceActionRequestV2(request({
    actor: { kind: "account", subjectId: "subject-123" },
    spaceId: "space-1",
    projectId: "project-1",
  }));
  assert.deepEqual(value.actor, { kind: "account", subjectId: "subject-123" });
});

test("device-owner actor rejects synthetic subject identity", () => {
  assert.throws(
    () => validateDeviceActionRequestV2(request({
      actor: { kind: "device-owner", subjectId: "local-owner" },
    })),
    /must not fabricate an account subject id/,
  );
});

test("v2 preserves forbidden capability and credential-like payload rules", () => {
  assert.throws(
    () => validateDeviceActionRequestV2(request({ capability: "shell.generic" })),
    /capability is forbidden/,
  );
  assert.throws(
    () => validateDeviceActionRequestV2(request({ parameters: { token: "not-allowed" } })),
    /credential-like field token/,
  );
});

test("Studio runtime v2 rejects raw and generic dispatch", () => {
  for (const field of ["execute", "deviceAgent", "call"]) {
    const port = { ...runtime(), [field]: noop };
    assert.throws(() => assertStudioRuntimeV2Port(port), /raw or generic dispatch/, field);
  }
});

test("Studio runtime v2 validates request and receipt correlation", async () => {
  const receipt = await requestStudioDeviceActionV2(runtime(), request());
  assert.equal(receipt.actionId, "action-1");
  assert.equal(receipt.deviceId, "device-1");

  await assert.rejects(
    requestStudioDeviceActionV2(runtime({ actionId: "other-action" }), request()),
    /does not match its request/,
  );
  await assert.rejects(
    requestStudioDeviceActionV2(runtime({ deviceId: "other-device" }), request()),
    /does not match its request/,
  );
});
