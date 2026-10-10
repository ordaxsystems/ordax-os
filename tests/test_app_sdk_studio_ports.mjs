import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  DEVICE_ACTION_REQUEST_SCHEMA,
  validateDeviceActionRequest,
} from "../system/contracts/device-action-envelope.mjs";
import { DEVICE_ACTION_REQUEST_V2_SCHEMA } from "../system/contracts/device-action-envelope-v2.mjs";
import { DEVICE_ACTION_RESULT_SCHEMA } from "../system/contracts/device-action-result.mjs";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA as LEGACY_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA as LEGACY_READER_SCHEMA,
} from "../system/contracts/device-agent.mjs";
import {
  DEVICE_ACTION_RECEIPT_SCHEMA as LEGACY_RECEIPT_SCHEMA,
  DEVICE_ACTION_REQUEST_SCHEMA as LEGACY_REQUEST_SCHEMA,
} from "../system/contracts/operational-realtime.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { STUDIO_ACTION_CONTEXT_SCHEMA } from "../system/contracts/studio-action-context.mjs";
import {
  STUDIO_RUNTIME_PORT_SCHEMA,
  assertStudioRuntimePort,
  readStudioRuntimeCapabilities,
  requestStudioDeviceAction,
} from "../system/contracts/studio-runtime.mjs";
import { STUDIO_RUNTIME_V2_PORT_SCHEMA } from "../system/contracts/studio-runtime-v2.mjs";
import { STUDIO_RUNTIME_V3_PORT_SCHEMA } from "../system/contracts/studio-runtime-v3.mjs";

const rootUrl = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), "utf8"));
}

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

function request(overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "studio-action-1",
    idempotencyKey: "studio-action-1",
    accountId: "account-1",
    spaceId: "space-1",
    projectId: "project-1",
    deviceId: "device-1",
    client: "ordax-native",
    capability: "files.read",
    operation: "text.read",
    parameters: { path: "/Projects/demo/README.md" },
    requestedAt: 100,
    expiresAt: 200,
    expectedDeviceRevision: 7,
    ...overrides,
  };
}

test("legacy contracts re-export the split public schemas without changing majors", () => {
  assert.equal(LEGACY_CAPABILITIES_SCHEMA, DEVICE_AGENT_CAPABILITIES_SCHEMA);
  assert.equal(LEGACY_READER_SCHEMA, DEVICE_AGENT_CAPABILITY_READER_SCHEMA);
  assert.equal(LEGACY_REQUEST_SCHEMA, DEVICE_ACTION_REQUEST_SCHEMA);
  assert.equal(LEGACY_RECEIPT_SCHEMA, DEVICE_ACTION_RECEIPT_SCHEMA);
});

test("Studio runtime composes a narrowed reader and action-request gateway without raw execute", async () => {
  const capabilityReader = {
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    capabilities: async () => ({
      schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
      state: "ready",
      capabilities: [{ id: "files.read", modes: ["read"] }],
    }),
  };
  const runtime = {
    schema: STUDIO_RUNTIME_PORT_SCHEMA,
    capabilityReader,
    projectCatalog: projectCatalog(),
    requestAction: async (value) => ({
      schema: DEVICE_ACTION_RECEIPT_SCHEMA,
      actionId: value.actionId,
      deviceId: value.deviceId,
      state: "succeeded",
      acceptedAt: 101,
      completedAt: 102,
      deviceRevision: 8,
      resultCode: "ok",
      message: null,
    }),
  };

  assert.equal(assertStudioRuntimePort(runtime), runtime);
  const capabilities = await readStudioRuntimeCapabilities(runtime);
  assert.equal(capabilities.state, "ready");
  assert.deepEqual(capabilities.capabilities[0], { id: "files.read", modes: ["read"] });

  const receipt = await requestStudioDeviceAction(runtime, request());
  assert.equal(receipt.state, "succeeded");
  assert.equal(receipt.actionId, "studio-action-1");

  assert.throws(
    () => assertStudioRuntimePort({ ...runtime, execute() {} }),
    /must not expose raw device execution/,
  );
  assert.throws(
    () => assertStudioRuntimePort({ ...runtime, deviceAgent: {} }),
    /must not expose raw device execution/,
  );
});

test("public action envelopes remain data, not grants or credential carriers", () => {
  assert.throws(
    () => validateDeviceActionRequest(request({ capability: "shell.generic" })),
    /forbidden/,
  );
  assert.throws(
    () => validateDeviceActionRequest(request({ parameters: { token: "secret" } })),
    /credential-like/,
  );
});

test("App SDK 1.14 preserves Studio v3 result retrieval without raw authority", async () => {
  const bundle = await json("sdk/app-sdk-v1/bundle.json");
  assert.equal(bundle.bundle_version, "1.14.0");
  assert.equal(bundle.authority, "none");

  const byName = new Map(bundle.contracts.map((contract) => [contract.name, contract]));
  for (const name of [
    "app-intelligence-manifest",
    "device-action-receipt",
    "device-action-request",
    "device-action-request-v2",
    "device-action-result",
    "device-capabilities",
    "device-capability-reader",
    "project-catalog",
    "studio-action-context",
    "studio-runtime",
    "studio-runtime-v2",
    "studio-runtime-v3",
  ]) {
    assert.ok(byName.has(name), `missing App SDK contract ${name}`);
  }

  assert.equal(byName.get("app-intelligence-manifest").schema, "ordax.app-intelligence-manifest/1");
  assert.equal(byName.get("studio-runtime").schema, STUDIO_RUNTIME_PORT_SCHEMA);
  assert.equal(byName.get("studio-runtime-v2").schema, STUDIO_RUNTIME_V2_PORT_SCHEMA);
  assert.equal(byName.get("studio-runtime-v3").schema, STUDIO_RUNTIME_V3_PORT_SCHEMA);
  assert.equal(byName.get("studio-action-context").schema, STUDIO_ACTION_CONTEXT_SCHEMA);
  assert.equal(byName.get("project-catalog").schema, PROJECT_CATALOG_SCHEMA);
  assert.equal(byName.get("device-capability-reader").schema, DEVICE_AGENT_CAPABILITY_READER_SCHEMA);
  assert.equal(byName.get("device-action-request").schema, DEVICE_ACTION_REQUEST_SCHEMA);
  assert.equal(byName.get("device-action-request-v2").schema, DEVICE_ACTION_REQUEST_V2_SCHEMA);
  assert.equal(byName.get("device-action-result").schema, DEVICE_ACTION_RESULT_SCHEMA);
  assert.equal(byName.get("device-action-receipt").schema, DEVICE_ACTION_RECEIPT_SCHEMA);

  assert.equal(bundle.contracts.some((contract) => contract.schema === "ordax.device-agent/1"), false);
  assert.equal(
    bundle.contracts.some((contract) => contract.source_path === "system/contracts/device-agent.mjs"),
    false,
  );
  assert.equal(
    bundle.contracts.some((contract) => contract.source_path === "system/contracts/operational-realtime.mjs"),
    false,
  );
});
