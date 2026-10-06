import assert from "node:assert/strict";
import test from "node:test";

import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import {
  createApplicationActionPreparationRegistry,
} from "../system/services/personal-ordax/application-action-preparations.mjs";
import {
  createApplicationActionProviderResolver,
} from "../system/services/personal-ordax/application-action-provider-bindings.mjs";

const OWNER = "washingtonmsdj/ordax-apps";
const SOURCE_COMMIT = "a".repeat(40);
const PROVIDER_SHA = "b".repeat(64);

function awareness() {
  const descriptor = Object.freeze({
    schema: "ordax.application-intelligence-awareness/1",
    appId: "notes",
    title: "Notas",
    sourceClass: "first-party",
    platform: "ordax",
    publisher: "OrdaX",
    payloadSha256: null,
    compatibilityManaged: false,
    nativeTrust: true,
    knownActionIds: ["notes.create-note"],
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
    provenance: "test:first-party",
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

function capability() {
  return {
    schema: "ordax.application-action-capability/1",
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
  };
}

function registry() {
  return createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities: [capability()],
  });
}

function semantics({ revision = 12, providerManifest = true } = {}) {
  const action = capability();
  return {
    application: {
      id: "notes",
      title: "Notas",
      component: {
        id: "notes",
        title: "Notas",
        kind: "app",
        version: "0.4.2",
        releaseMode: "component-slot",
        criticality: "optional",
        failureDomain: "app",
        restartScope: "component",
        healthMode: "runtime",
        owner: OWNER,
        dependencies: [],
      },
    },
    actionManifest: {
      schema: "ordax.application-action-manifest/1",
      appId: "notes",
      appVersion: "0.4.2",
      authority: "none",
      execution: "proposal-only",
      capabilities: [action],
    },
    providerManifest: providerManifest ? {
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
        sha256: PROVIDER_SHA,
      }],
    } : null,
    sourceCommit: SOURCE_COMMIT,
    revision,
  };
}

function setup({
  resolveArtifactSha256 = async () => PROVIDER_SHA,
  resolveSemantics = async () => semantics(),
} = {}) {
  const capabilities = registry();
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: capabilities,
    createPreparationId: () => "prep-artifact-1",
  });
  const proposal = capabilities.propose(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const preparation = preparations.prepare("work-1", proposal);
  const resolver = createApplicationActionProviderResolver({
    preparationRegistry: preparations,
    capabilityRegistry: capabilities,
    resolveVerifiedSemantics: resolveSemantics,
    resolveProviderArtifactSha256: resolveArtifactSha256,
    expectedOwner: OWNER,
  });
  return { preparation, preparations, resolver };
}

test("provider resolver binds exact provider module SHA without execution authority", async () => {
  let request = null;
  const { preparation, resolver } = setup({
    resolveArtifactSha256: async (value) => {
      request = value;
      return PROVIDER_SHA;
    },
  });

  const artifact = await resolver.resolveArtifact(preparation.resourceRef);

  assert.equal(
    artifact.schema,
    "ordax.application-action-provider-artifact-binding/1",
  );
  assert.equal(artifact.providerBinding.resourceRef, preparation.resourceRef);
  assert.equal(artifact.providerBinding.appId, "notes");
  assert.equal(artifact.providerBinding.sourceCommit, SOURCE_COMMIT);
  assert.equal(artifact.providerBinding.componentRevision, 12);
  assert.equal(artifact.module, "actions/providers/notes-native.mjs");
  assert.equal(artifact.artifactSha256, PROVIDER_SHA);
  assert.equal(artifact.authority, "none");
  assert.equal(artifact.executionAuthorized, false);
  assert.equal(artifact.modelDirectExecutionAuthorized, false);
  assert.deepEqual(request, {
    appId: "notes",
    appVersion: "0.4.2",
    sourceCommit: SOURCE_COMMIT,
    componentRevision: 12,
    module: "actions/providers/notes-native.mjs",
    declaredSha256: PROVIDER_SHA,
  });
  for (const method of ["execute", "invoke", "run", "launch", "grant", "authorize"]) {
    assert.equal(typeof resolver[method], "undefined");
  }
});

test("provider artifact resolution fails closed when manifest is unavailable", async () => {
  const { preparation, resolver } = setup({
    resolveSemantics: async () => semantics({ providerManifest: false }),
  });

  await assert.rejects(
    () => resolver.resolveArtifact(preparation.resourceRef),
    /artifact manifest is unavailable/,
  );
});

test("provider artifact resolution rejects SHA-256 mismatch", async () => {
  const { preparation, resolver } = setup({
    resolveArtifactSha256: async () => "c".repeat(64),
  });

  await assert.rejects(
    () => resolver.resolveArtifact(preparation.resourceRef),
    /SHA-256 mismatch/,
  );
});

test("provider artifact resolution rejects slot drift during hash verification", async () => {
  let revision = 12;
  const { preparation, resolver } = setup({
    resolveSemantics: async () => semantics({ revision }),
    resolveArtifactSha256: async () => {
      revision = 13;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolveArtifact(preparation.resourceRef),
    /binding changed during artifact verification/,
  );
});

test("provider artifact resolution rejects revoked preparation during hash verification", async () => {
  let preparations = null;
  const setupValue = setup({
    resolveArtifactSha256: async () => {
      preparations.revoke("application-action:prep-artifact-1");
      return PROVIDER_SHA;
    },
  });
  preparations = setupValue.preparations;

  await assert.rejects(
    () => setupValue.resolver.resolveArtifact(setupValue.preparation.resourceRef),
    /binding changed during artifact verification/,
  );
});
