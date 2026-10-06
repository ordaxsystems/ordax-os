import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ACTION_CAPABILITY_SCHEMA,
} from "../system/contracts/application-action-capability.mjs";
import {
  APPLICATION_ACTION_PREPARATION_REGISTRY_SCHEMA,
  assertApplicationActionPreparationRegistry,
} from "../system/contracts/application-action-preparation.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import {
  createApplicationActionPreparationRegistry,
} from "../system/services/personal-ordax/application-action-preparations.mjs";

function awareness() {
  const descriptor = Object.freeze({
    schema: "ordax.application-intelligence-awareness/1",
    appId: "notes",
    title: "Notas",
    sourceClass: "first-party",
    platform: "ordax",
    payloadSha256: null,
    semantics: null,
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
  });
  return Object.freeze({
    schema: "ordax.application-intelligence-awareness-port/1",
    list() { return Object.freeze([descriptor]); },
    get(appId) { return appId === "notes" ? descriptor : null; },
    resolveExact(appId) { return appId === "notes" ? descriptor : null; },
    contextItem() {
      return Object.freeze({
        id: "ordax-application-catalog",
        scope: "system",
        text: "{}",
        provenance: "test",
      });
    },
  });
}

function capability(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId: "notes",
    actionId: "notes.create-note",
    title: "Criar nota",
    description: "Criar uma nova nota.",
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
    provenance: "ordax-apps:notes",
    ...overrides,
  };
}

function registry(capabilities = [capability()]) {
  return createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities,
  });
}

test("preparation binds exact current proposal to opaque work-scoped resource ref", () => {
  const capabilities = registry();
  const proposal = capabilities.propose(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: capabilities,
    createPreparationId: () => "prep-1",
  });

  const prepared = preparations.prepare("work-1", proposal);

  assert.equal(prepared.schema, "ordax.application-action-preparation/1");
  assert.equal(prepared.preparationId, "prep-1");
  assert.equal(prepared.resourceRef, "application-action:prep-1");
  assert.equal(prepared.workItemId, "work-1");
  assert.equal(prepared.proposal.actionId, "notes.create-note");
  assert.deepEqual(prepared.proposal.arguments, { title: "Ideias" });
  assert.equal(prepared.provider.adapterId, "notes-native");
  assert.equal(prepared.effect, "write");
  assert.equal(prepared.authority, "none");
  assert.equal(prepared.executionAuthorized, false);
  assert.equal(prepared.modelDirectExecutionAuthorized, false);
  assert.equal(preparations.resolve(prepared.resourceRef), prepared);
  assert.deepEqual(preparations.listForWork("work-1"), [prepared]);
});

test("preparation maps risk classes conservatively and never executes", () => {
  const cases = [
    ["read-only", "none", "read"],
    ["local-change", "policy-gated", "write"],
    ["external-effect", "policy-gated", "external-egress"],
    ["privileged", "always", "device-control"],
  ];
  let ordinal = 0;
  for (const [riskClass, confirmation, effect] of cases) {
    ordinal += 1;
    const capabilities = registry([capability({
      riskClass,
      confirmation,
      actionId: `notes.action-${ordinal}`,
    })]);
    const proposal = capabilities.propose(
      "notes",
      `notes.action-${ordinal}`,
      { title: "x" },
    );
    const preparations = createApplicationActionPreparationRegistry({
      capabilityRegistry: capabilities,
      createPreparationId: () => `prep-${ordinal}`,
    });
    assert.equal(preparations.prepare("work-1", proposal).effect, effect);
    for (const method of ["execute", "invoke", "run", "grant", "authorize", "confirm"]) {
      assert.equal(typeof preparations[method], "undefined");
    }
  }
});

test("stale proposal is rejected after capability identity changes", () => {
  const oldRegistry = registry();
  const proposal = oldRegistry.propose(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const currentRegistry = registry([capability({
    provenance: "ordax-apps:notes:revision-2",
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
    },
  })]);
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: currentRegistry,
    createPreparationId: () => "prep-stale",
  });

  assert.throws(
    () => preparations.prepare("work-1", proposal),
    /stale or no longer matches capability/,
  );
  assert.equal(preparations.resolve("application-action:prep-stale"), null);
});

test("foreign or payload-bound capability cannot enter first-party preparation path", () => {
  const installedAwareness = Object.freeze({
    schema: "ordax.application-intelligence-awareness-port/1",
    list() {
      return Object.freeze([Object.freeze({
        schema: "ordax.application-intelligence-awareness/1",
        appId: "foreign-app",
        title: "Foreign",
        sourceClass: "installed",
        platform: "windows",
        payloadSha256: "b".repeat(64),
        semantics: null,
        actionExecutionAuthorized: false,
        modelToolExecutionAuthorized: false,
      })]);
    },
    get() { return null; },
    resolveExact() { return null; },
    contextItem() {
      return Object.freeze({
        id: "ordax-application-catalog",
        scope: "system",
        text: "{}",
        provenance: "test",
      });
    },
  });
  const capabilities = createApplicationActionCapabilityRegistry({
    awareness: installedAwareness,
    capabilities: [{
      ...capability(),
      appId: "foreign-app",
      actionId: "foreign-app.inspect",
      sourceClass: "installed",
      platform: "windows",
      provider: {
        kind: "verified-integration",
        adapterId: "foreign-integration",
        revision: "1",
      },
      binding: { payloadSha256: "b".repeat(64) },
    }],
  });
  const proposal = capabilities.propose(
    "foreign-app",
    "foreign-app.inspect",
    { title: "x" },
  );
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: capabilities,
    createPreparationId: () => "prep-foreign",
  });

  assert.throws(
    () => preparations.prepare("work-1", proposal),
    /only supports verified first-party providers/,
  );
});

test("revoke removes preparation and capacity fails closed", () => {
  const capabilities = registry();
  let ordinal = 0;
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: capabilities,
    createPreparationId: () => `prep-${++ordinal}`,
    maxPreparations: 1,
  });
  const proposal = capabilities.propose(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );

  const first = preparations.prepare("work-1", proposal);
  assert.throws(
    () => preparations.prepare("work-1", proposal),
    /registry is full/,
  );
  assert.equal(preparations.revoke(first.resourceRef), true);
  assert.equal(preparations.resolve(first.resourceRef), null);
  assert.deepEqual(preparations.listForWork("work-1"), []);
  assert.equal(preparations.revoke(first.resourceRef), false);

  const replacement = preparations.prepare("work-1", proposal);
  assert.equal(replacement.resourceRef, "application-action:prep-2");
});

test("registry contract rejects authority-bearing methods", () => {
  const capabilities = registry();
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: capabilities,
    createPreparationId: () => "prep-contract",
  });
  assert.equal(preparations.schema, APPLICATION_ACTION_PREPARATION_REGISTRY_SCHEMA);
  assert.equal(assertApplicationActionPreparationRegistry(preparations), preparations);

  assert.throws(
    () => assertApplicationActionPreparationRegistry({
      ...preparations,
      execute() {},
    }),
    /must not expose execute/,
  );
});
