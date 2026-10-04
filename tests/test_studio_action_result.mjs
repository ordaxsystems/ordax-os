import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
} from "../system/contracts/device-action-envelope.mjs";
import {
  DEVICE_ACTION_REQUEST_V2_SCHEMA,
} from "../system/contracts/device-action-envelope-v2.mjs";
import {
  DEVICE_ACTION_RESULT_SCHEMA,
  validateDeviceActionResult,
} from "../system/contracts/device-action-result.mjs";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { STUDIO_ACTION_CONTEXT_SCHEMA } from "../system/contracts/studio-action-context.mjs";
import {
  STUDIO_RUNTIME_V3_PORT_SCHEMA,
  assertStudioRuntimeV3Port,
  readStudioDeviceActionResult,
  requestStudioDeviceActionV3,
} from "../system/contracts/studio-runtime-v3.mjs";

function projectCatalog() {
  const noop = () => {};
  return {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: () => ({ persistence: "session", projects: [] }),
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

function context() {
  return {
    schema: STUDIO_ACTION_CONTEXT_SCHEMA,
    actor: { kind: "device-owner", subjectId: null },
    deviceId: "device-local-1",
    client: "ordax-desktop",
    spaceId: null,
  };
}

function request() {
  return {
    schema: DEVICE_ACTION_REQUEST_V2_SCHEMA,
    actionId: "action-1",
    idempotencyKey: "idem-1",
    actor: { kind: "device-owner", subjectId: null },
    spaceId: null,
    projectId: null,
    deviceId: "device-local-1",
    client: "ordax-desktop",
    capability: "computer.text_read",
    parameters: { path: "C:/Users/Owner/readme.txt" },
    requestedAt: 100,
    expiresAt: 200,
    expectedDeviceRevision: null,
  };
}

function receipt(overrides = {}) {
  return {
    schema: DEVICE_ACTION_RECEIPT_SCHEMA,
    actionId: "action-1",
    deviceId: "device-local-1",
    state: "succeeded",
    acceptedAt: 101,
    completedAt: 102,
    deviceRevision: null,
    resultCode: "ok",
    message: null,
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    schema: DEVICE_ACTION_RESULT_SCHEMA,
    receipt: receipt(),
    output: {
      path: "C:/Users/Owner/readme.txt",
      content: "line one\nline two\tvalue\r\n",
      size: 27,
    },
    ...overrides,
  };
}

function runtimePort(overrides = {}) {
  return {
    schema: STUDIO_RUNTIME_V3_PORT_SCHEMA,
    capabilityReader: {
      schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
      async capabilities() {
        return {
          schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
          state: "ready",
          capabilities: [{ id: "computer.text_read", modes: ["read"] }],
        };
      },
    },
    projectCatalog: projectCatalog(),
    async getActionContext() { return context(); },
    async requestAction(value) { return receipt({ actionId: value.actionId }); },
    async getActionResult() { return result(); },
    ...overrides,
  };
}

test("device action result accepts bounded multiline JSON-safe output", () => {
  const value = validateDeviceActionResult(result());
  assert.equal(value.schema, DEVICE_ACTION_RESULT_SCHEMA);
  assert.equal(value.receipt.actionId, "action-1");
  assert.match(value.output.content, /line two/);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.output), true);
});

test("device action result rejects credential-like output fields", () => {
  assert.throws(
    () => validateDeviceActionResult(result({ output: { token: "must-not-leak" } })),
    /credential-like field token/,
  );
});

test("device action result rejects oversized output", () => {
  assert.throws(
    () => validateDeviceActionResult(result({ output: { content: "x".repeat(600 * 1024) } })),
    /invalid text/,
  );
});

test("runtime v3 requires result retrieval and keeps raw dispatch forbidden", () => {
  const port = runtimePort();
  assert.equal(assertStudioRuntimeV3Port(port), port);
  assert.throws(
    () => assertStudioRuntimeV3Port(runtimePort({ getActionResult: undefined })),
    /must implement getActionResult/,
  );
  assert.throws(
    () => assertStudioRuntimeV3Port(runtimePort({ execute() {} })),
    /must not expose raw or generic dispatch/,
  );
  assert.throws(
    () => assertStudioRuntimeV3Port(runtimePort({ call() {} })),
    /must not expose raw or generic dispatch/,
  );
});

test("runtime v3 request preserves runtime v2 identity matching", async () => {
  const actionReceipt = await requestStudioDeviceActionV3(runtimePort(), request());
  assert.equal(actionReceipt.actionId, "action-1");

  await assert.rejects(
    requestStudioDeviceActionV3(
      runtimePort(),
      { ...request(), deviceId: "other-device" },
    ),
    /identity does not match host context/,
  );
});

test("runtime v3 result is correlated to requested action and host device", async () => {
  const value = await readStudioDeviceActionResult(runtimePort(), "action-1");
  assert.equal(value.receipt.deviceId, "device-local-1");
  assert.equal(value.output.path, "C:/Users/Owner/readme.txt");

  await assert.rejects(
    readStudioDeviceActionResult(
      runtimePort({ async getActionResult() { return result({ receipt: receipt({ actionId: "other" }) }); } }),
      "action-1",
    ),
    /does not match requested action id/,
  );

  await assert.rejects(
    readStudioDeviceActionResult(
      runtimePort({ async getActionResult() { return result({ receipt: receipt({ deviceId: "other-device" }) }); } }),
      "action-1",
    ),
    /device does not match host context/,
  );
});
