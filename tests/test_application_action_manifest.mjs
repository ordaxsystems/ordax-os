import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ACTION_CAPABILITY_SCHEMA,
} from "../system/contracts/application-action-capability.mjs";
import {
  APPLICATION_ACTION_MANIFEST_EXECUTION_MODE,
  APPLICATION_ACTION_MANIFEST_SCHEMA,
  validateApplicationActionManifest,
} from "../system/contracts/application-action-manifest.mjs";

function capability(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId: "notes",
    actionId: "notes.create-note",
    title: "Criar nota",
    description: "Criar uma nota por um binding first-party futuro.",
    sourceClass: "first-party",
    platform: "ordax",
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
    },
    binding: { payloadSha256: null },
    parameters: [{
      id: "title",
      type: "string",
      required: false,
      maxLength: 240,
    }],
    riskClass: "local-change",
    confirmation: "policy-gated",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: "ordax-apps:notes/actions",
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_MANIFEST_SCHEMA,
    appId: "notes",
    appVersion: "0.4.1",
    authority: "none",
    execution: APPLICATION_ACTION_MANIFEST_EXECUTION_MODE,
    capabilities: [capability()],
    ...overrides,
  };
}

test("first-party action manifest binds capabilities to exact app identity without authority", () => {
  const value = validateApplicationActionManifest(manifest(), {
    appId: "notes",
    appVersion: "0.4.1",
  });

  assert.equal(value.schema, "ordax.application-action-manifest/1");
  assert.equal(value.appId, "notes");
  assert.equal(value.appVersion, "0.4.1");
  assert.equal(value.authority, "none");
  assert.equal(value.execution, "proposal-only");
  assert.equal(value.capabilities.length, 1);
  assert.equal(value.capabilities[0].actionId, "notes.create-note");
  assert.equal(value.capabilities[0].executionAuthorized, false);
  assert.equal(value.capabilities[0].modelDirectExecutionAuthorized, false);
});

test("action manifest rejects identity/version/authority drift", () => {
  assert.throws(
    () => validateApplicationActionManifest(manifest({ appId: "studio" }), { appId: "notes" }),
    /appId mismatch/,
  );
  assert.throws(
    () => validateApplicationActionManifest(manifest({ appVersion: "0.4.2" }), { appVersion: "0.4.1" }),
    /appVersion mismatch/,
  );
  assert.throws(
    () => validateApplicationActionManifest(manifest({ authority: "write" })),
    /must not carry authority/,
  );
  assert.throws(
    () => validateApplicationActionManifest(manifest({ execution: "direct" })),
    /cannot grant execution/,
  );
});

test("action manifest rejects non-namespaced, duplicated or foreign capabilities", () => {
  assert.throws(
    () => validateApplicationActionManifest(manifest({
      capabilities: [capability({ actionId: "studio.create-note" })],
    })),
    /namespaced by manifest appId/,
  );

  assert.throws(
    () => validateApplicationActionManifest(manifest({
      capabilities: [capability(), capability()],
    })),
    /action ids must be unique/,
  );

  assert.throws(
    () => validateApplicationActionManifest(manifest({
      capabilities: [capability({
        sourceClass: "installed",
        platform: "windows",
        provider: {
          kind: "verified-integration",
          adapterId: "notes-windows",
          revision: "1",
        },
        binding: { payloadSha256: "a".repeat(64) },
      })],
    })),
    /first-party OrdaX declarations/,
  );
});

test("action manifest rejects capabilities that attempt execution authority", () => {
  assert.throws(
    () => validateApplicationActionManifest(manifest({
      capabilities: [capability({ executionAuthorized: true })],
    })),
    /foundation must remain non-executing/,
  );
  assert.throws(
    () => validateApplicationActionManifest(manifest({
      capabilities: [capability({ modelDirectExecutionAuthorized: true })],
    })),
    /foundation must remain non-executing/,
  );
});
