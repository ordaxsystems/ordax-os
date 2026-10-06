import assert from "node:assert/strict";
import test from "node:test";

import {
  validateApplicationActionProviderManifest,
} from "../system/contracts/application-action-provider-manifest.mjs";

function actions(overrides = {}) {
  return {
    schema: "ordax.application-action-manifest/1",
    appId: "notes",
    appVersion: "0.4.2",
    authority: "none",
    execution: "proposal-only",
    capabilities: [{
      schema: "ordax.application-action-capability/1",
      appId: "notes",
      actionId: "notes.create-note",
      title: "Criar nota",
      description: "Criar uma nota.",
      sourceClass: "first-party",
      platform: "ordax",
      provider: {
        kind: "first-party-native",
        adapterId: "notes-native",
        revision: "1",
      },
      binding: { payloadSha256: null },
      parameters: [],
      riskClass: "local-change",
      confirmation: "policy-gated",
      executionAuthorized: false,
      modelDirectExecutionAuthorized: false,
      provenance: "test:notes-actions",
    }],
    ...overrides,
  };
}

function providers(overrides = {}) {
  return {
    schema: "ordax.application-action-provider-manifest/1",
    appId: "notes",
    appVersion: "0.4.2",
    authority: "none",
    execution: "unavailable",
    providers: [{
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
      module: "actions/providers/notes-native.mjs",
      sha256: "a".repeat(64),
    }],
    ...overrides,
  };
}

test("provider manifest binds exact provider artifact without execution authority", () => {
  const manifest = validateApplicationActionProviderManifest(providers(), {
    appId: "notes",
    appVersion: "0.4.2",
    actionManifest: actions(),
  });

  assert.equal(manifest.appId, "notes");
  assert.equal(manifest.appVersion, "0.4.2");
  assert.equal(manifest.authority, "none");
  assert.equal(manifest.execution, "unavailable");
  assert.equal(manifest.providers.length, 1);
  assert.deepEqual(manifest.providers[0], {
    kind: "first-party-native",
    adapterId: "notes-native",
    revision: "1",
    module: "actions/providers/notes-native.mjs",
    artifactSha256: "a".repeat(64),
  });
  assert.equal(typeof manifest.execute, "undefined");
  assert.equal(typeof manifest.invoke, "undefined");
  assert.equal(typeof manifest.run, "undefined");
});

test("provider manifest fails closed on authority, path or artifact identity drift", () => {
  assert.throws(
    () => validateApplicationActionProviderManifest(
      providers({ execution: "direct" }),
      { appId: "notes", appVersion: "0.4.2", actionManifest: actions() },
    ),
    /cannot grant execution/,
  );

  const wrongPath = providers();
  wrongPath.providers[0].module = "src/runtime.mjs";
  assert.throws(
    () => validateApplicationActionProviderManifest(wrongPath, {
      appId: "notes",
      appVersion: "0.4.2",
      actionManifest: actions(),
    }),
    /module path is not canonical/,
  );

  const badHash = providers();
  badHash.providers[0].sha256 = "deadbeef";
  assert.throws(
    () => validateApplicationActionProviderManifest(badHash, {
      appId: "notes",
      appVersion: "0.4.2",
      actionManifest: actions(),
    }),
    /SHA-256 is invalid/,
  );
});

test("provider artifacts must exactly cover capability providers", () => {
  const wrongProvider = providers();
  wrongProvider.providers[0] = {
    ...wrongProvider.providers[0],
    adapterId: "other-native",
    module: "actions/providers/other-native.mjs",
  };
  assert.throws(
    () => validateApplicationActionProviderManifest(wrongProvider, {
      appId: "notes",
      appVersion: "0.4.2",
      actionManifest: actions(),
    }),
    /exactly cover declared capabilities/,
  );

  const extraProvider = providers();
  extraProvider.providers.push({
    kind: "first-party-native",
    adapterId: "extra-native",
    revision: "1",
    module: "actions/providers/extra-native.mjs",
    sha256: "b".repeat(64),
  });
  assert.throws(
    () => validateApplicationActionProviderManifest(extraProvider, {
      appId: "notes",
      appVersion: "0.4.2",
      actionManifest: actions(),
    }),
    /exactly cover declared capabilities/,
  );
});
