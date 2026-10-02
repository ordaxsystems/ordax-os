import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  APPLICATION_ACTION_CAPABILITY_SCHEMA,
  APPLICATION_ACTION_PROPOSAL_SCHEMA,
  validateApplicationActionCapability,
  validateApplicationActionProposal,
} from "../system/contracts/application-action-capability.mjs";
import { INSTALLED_APPLICATION_SCHEMA } from "../system/contracts/installed-application.mjs";
import { createApplicationActionCapabilityRegistry } from "../system/services/intelligence/application-action-capabilities.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";

const PAYLOAD_SHA = "a".repeat(64);

function installedApplication(payloadSha256 = PAYLOAD_SHA) {
  return {
    schema: INSTALLED_APPLICATION_SCHEMA,
    id: "photo-editor",
    title: "Photo Editor",
    description: "Synthetic installed application used by capability contract tests.",
    monogram: "PE",
    origin: {
      platform: "windows",
      source: "local-file",
      payloadSha256,
      publisher: "Example Publisher",
    },
    launch: {
      kind: "compatibility-profile",
      profileId: "photo-editor-profile",
      runtimeId: "wine-11-runtime",
      entrypointId: "photo-editor-main",
    },
    lifecycle: {
      installState: "installed",
      uninstallable: true,
      updateMode: "manual",
    },
    trust: {
      nativeTrust: false,
      runtimeGrantsTrust: false,
    },
  };
}

function firstPartyCapability(appId) {
  return {
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId,
    actionId: "document.open-resource",
    title: "Open resource",
    description: "Open a resource already represented by an OrdaX grant.",
    sourceClass: "first-party",
    platform: "ordax",
    provider: {
      kind: "first-party-native",
      adapterId: "files-semantic-actions",
      revision: "1",
    },
    binding: { payloadSha256: null },
    parameters: [
      { id: "resource", type: "resource-grant-id", required: true, maxLength: 128 },
    ],
    riskClass: "read-only",
    confirmation: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: "test:first-party-files-actions@1",
  };
}

function uriCapability(appId) {
  return {
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId,
    actionId: "browser.open-url",
    title: "Open URL",
    description: "Describe navigation to an explicitly supported web URI.",
    sourceClass: "first-party",
    platform: "ordax",
    provider: {
      kind: "first-party-native",
      adapterId: "browser-semantic-actions",
      revision: "1",
    },
    binding: { payloadSha256: null },
    parameters: [
      { id: "target", type: "uri", required: true, maxLength: 2048, schemes: ["https", "http"] },
    ],
    riskClass: "read-only",
    confirmation: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: "test:first-party-browser-actions@1",
  };
}

function installedCapability(payloadSha256 = PAYLOAD_SHA) {
  return {
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId: "photo-editor",
    actionId: "image.export",
    title: "Export image",
    description: "Describe a verified export operation without authorizing execution.",
    sourceClass: "installed",
    platform: "windows",
    provider: {
      kind: "verified-integration",
      adapterId: "photo-editor-export-integration",
      revision: "2026-09-29",
    },
    binding: { payloadSha256 },
    parameters: [
      { id: "source", type: "resource-grant-id", required: true, maxLength: 128 },
      { id: "format", type: "enum", required: true, values: ["jpg", "png", "webp"] },
      { id: "quality", type: "integer", required: false, minimum: 1, maximum: 100 },
    ],
    riskClass: "local-change",
    confirmation: "policy-gated",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: `test:verified-photo-editor:${payloadSha256}`,
  };
}

function awareness() {
  return createApplicationIntelligenceAwareness({
    firstPartyApplications: [listFirstPartyApps()[0]],
    installedApplications: [installedApplication()],
  });
}

test("registry binds semantic capabilities to exact known application identity", () => {
  const nativeApp = listFirstPartyApps()[0];
  const registry = createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities: [firstPartyCapability(nativeApp.id), installedCapability()],
  });

  assert.equal(registry.list().length, 2);
  assert.equal(registry.get(nativeApp.id, "document.open-resource").provider.kind, "first-party-native");
  assert.equal(registry.listForApp("photo-editor").length, 1);
  assert.equal(registry.get("photo-editor", "image.export").binding.payloadSha256, PAYLOAD_SHA);
});

test("proposal validates declared parameters but never gains execution authority", () => {
  const nativeApp = listFirstPartyApps()[0];
  const registry = createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities: [firstPartyCapability(nativeApp.id), installedCapability()],
  });
  const proposal = registry.propose("photo-editor", "image.export", {
    source: "grant-source-image",
    format: "webp",
    quality: 88,
  });

  assert.equal(proposal.schema, APPLICATION_ACTION_PROPOSAL_SCHEMA);
  assert.deepEqual(proposal.arguments, { source: "grant-source-image", format: "webp", quality: 88 });
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.modelDirectExecutionAuthorized, false);
  assert.equal(proposal.riskClass, "local-change");
  assert.equal(proposal.confirmation, "policy-gated");
});

test("proposal rejects undeclared, missing, invalid enum and non-grant resource arguments", () => {
  const registry = createApplicationActionCapabilityRegistry({ awareness: awareness(), capabilities: [installedCapability()] });
  assert.throws(() => registry.propose("photo-editor", "image.export", { format: "png" }), /missing required argument: source/);
  assert.throws(
    () => registry.propose("photo-editor", "image.export", { source: "grant-source", format: "tiff" }),
    /outside the declared enum/,
  );
  assert.throws(
    () => registry.propose("photo-editor", "image.export", { source: "C:\\Users\\me\\image.png", format: "png" }),
    /opaque resource grant id/,
  );
  assert.throws(
    () => registry.propose("photo-editor", "image.export", { source: "grant-source", format: "png", command: "do it" }),
    /undeclared argument: command/,
  );
});

test("URI parameters require explicit schemes and reject undeclared schemes", () => {
  const nativeApp = listFirstPartyApps()[0];
  const registry = createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities: [uriCapability(nativeApp.id)],
  });
  const proposal = registry.propose(nativeApp.id, "browser.open-url", { target: "https://example.com/path" });
  assert.equal(proposal.arguments.target, "https://example.com/path");
  assert.throws(
    () => registry.propose(nativeApp.id, "browser.open-url", { target: "javascript:alert(1)" }),
    /undeclared URI scheme/,
  );

  const missingSchemes = uriCapability(nativeApp.id);
  missingSchemes.parameters = [{ id: "target", type: "uri", required: true, maxLength: 2048 }];
  assert.throws(() => validateApplicationActionCapability(missingSchemes), /URI schemes are invalid/);
});

test("installed capabilities are bound to the exact installed payload digest", () => {
  const mismatched = installedCapability("b".repeat(64));
  assert.throws(
    () => createApplicationActionCapabilityRegistry({ awareness: awareness(), capabilities: [mismatched] }),
    /payload binding drifted/,
  );
});

test("foreign apps cannot claim first-party providers and raw authority parameter ids are rejected", () => {
  const foreignNative = installedCapability();
  foreignNative.provider = { ...foreignNative.provider, kind: "first-party-native" };
  assert.throws(() => validateApplicationActionCapability(foreignNative), /cannot claim first-party native/);

  const rawPath = installedCapability();
  rawPath.parameters = [{ id: "path", type: "string", required: true, maxLength: 1024 }];
  assert.throws(() => validateApplicationActionCapability(rawPath), /exposes raw authority/);
});

test("risk policy rejects unconfirmed privileged and external-effect capabilities and proposals", () => {
  const privileged = installedCapability();
  privileged.riskClass = "privileged";
  privileged.confirmation = "policy-gated";
  assert.throws(() => validateApplicationActionCapability(privileged), /Privileged application actions require confirmation/);

  const external = installedCapability();
  external.riskClass = "external-effect";
  external.confirmation = "none";
  assert.throws(() => validateApplicationActionCapability(external), /External-effect application actions require policy or confirmation/);

  assert.throws(() => validateApplicationActionProposal({
    schema: APPLICATION_ACTION_PROPOSAL_SCHEMA,
    appId: "photo-editor",
    actionId: "system.privileged-change",
    arguments: {},
    riskClass: "privileged",
    confirmation: "none",
    capabilityProvenance: "test:invalid-proposal",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  }), /Privileged application actions require confirmation/);
});

test("capability context is bounded semantic data and hides provider/payload internals", () => {
  const nativeApp = listFirstPartyApps()[0];
  const registry = createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities: [uriCapability(nativeApp.id), installedCapability()],
  });
  const item = registry.contextItem();
  const value = JSON.parse(item.text);

  assert.equal(item.scope, "system");
  assert.equal(value.authority, "none");
  assert.equal(value.toolExecution, false);
  assert.equal(value.actions.length, 2);
  assert.equal(value.actions[0].parameters[0].schemes.includes("https"), true);
  assert.equal(value.actions[1].parameters[1].values.includes("webp"), true);
  assert.equal(value.actions[1].executionAuthorized, false);
  assert.equal(value.actions[1].modelDirectExecutionAuthorized, false);
  assert.equal(item.text.includes(PAYLOAD_SHA), false);
  assert.equal(item.text.includes("photo-editor-export-integration"), false);
  assert.equal(item.text.includes("wine"), false);
});

test("registry exposes no execution, mutation, grant or confirmation methods", () => {
  const registry = createApplicationActionCapabilityRegistry({ awareness: awareness(), capabilities: [] });
  for (const method of ["register", "mutate", "execute", "invoke", "run", "launch", "install", "uninstall", "shell", "spawn", "writeFile", "grant", "authorize", "confirm"]) {
    assert.equal(typeof registry[method], "undefined", method);
  }
});
