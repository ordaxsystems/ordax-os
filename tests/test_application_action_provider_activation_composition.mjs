import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { createNativeVerifiedComponentPackageSource } from "../system/adapters/native/verified-component-package-source.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import { EXTERNAL_FIRST_PARTY_OWNER } from "../system/services/intelligence/verified-app-semantics.mjs";

const OWNER = EXTERNAL_FIRST_PARTY_OWNER;
const SOURCE_COMMIT = "a".repeat(40);
const PROVIDER_SHA = "b".repeat(64);

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function identitySession() {
  const snapshot = {
    state: "signed-in",
    subjectId: "user-a",
    displayName: "User A",
  };
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
  };
}

function intelligence() {
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "test",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe() {
      return () => {};
    },
    async respond() {
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "ok",
        engineId: "llama.cpp",
        modelId: "test",
        authority: "none",
      };
    },
  };
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

function capabilityRegistry() {
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
  const awareness = Object.freeze({
    schema: "ordax.application-intelligence-awareness-port/1",
    list() {
      return Object.freeze([descriptor]);
    },
    get(appId) {
      return appId === "notes" ? descriptor : null;
    },
    resolveExact(appId) {
      return appId === "notes" ? descriptor : null;
    },
    contextItem() {
      return Object.freeze({
        id: "ordax-application-catalog",
        scope: "system",
        text: "{}",
        provenance: "test",
      });
    },
  });
  return createApplicationActionCapabilityRegistry({
    awareness,
    capabilities: [capability()],
  });
}

function verifiedSemantics() {
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
    providerManifest: {
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
    },
    sourceCommit: SOURCE_COMMIT,
    revision: 12,
  };
}

function metadata() {
  return {
    componentId: "notes",
    state: "current",
    source: "slot",
    revision: 12,
    version: "0.4.2",
    sourceCommit: SOURCE_COMMIT,
    entrypoint: "system/apps/notes/src/runtime.mjs",
    pendingHealth: null,
  };
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    async json() {
      return value;
    },
  };
}

function packageSource() {
  return createNativeVerifiedComponentPackageSource({
    location: { href: "http://127.0.0.1:43121/" },
  });
}

function composition({ withArtifactBoundary = true } = {}) {
  const artifactInputs = withArtifactBoundary
    ? {
        verifiedComponentPackageSource: packageSource(),
        verifiedComponentFetch: async () => jsonResponse(metadata()),
        applicationActionProviderArtifactIdentity: async () => PROVIDER_SHA,
      }
    : {};
  return createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: intelligence(),
    applicationActionCapabilityRegistry: capabilityRegistry(),
    createApplicationActionPreparationId: () => "prep-activation-1",
    resolveVerifiedApplicationSemantics: async (appId) => {
      assert.equal(appId, "notes");
      return verifiedSemantics();
    },
    expectedApplicationActionProviderOwner: OWNER,
    ...artifactInputs,
  });
}

function prepare(runtime) {
  const work = runtime.create("Criar uma nota");
  const proposal = runtime.proposeApplicationAction(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const preparation = runtime.prepareApplicationAction(work.id, proposal);
  return { work, preparation };
}

test("Personal OrdaX composes broker-only unavailable provider activation without authority", async () => {
  const runtime = composition();
  const { work, preparation } = prepare(runtime);
  const before = runtime.getSnapshot();

  const activation = await runtime.resolveApplicationActionProviderActivation(
    preparation.resourceRef,
  );

  assert.equal(activation.schema, "ordax.application-action-provider-activation/1");
  assert.equal(activation.resolution.resourceRef, preparation.resourceRef);
  assert.equal(activation.resolution.workItemId, work.id);
  assert.equal(activation.resolution.appId, "notes");
  assert.equal(activation.resolution.actionId, "notes.create-note");
  assert.equal(activation.providerExecution, "unavailable");
  assert.equal(activation.state, "unavailable");
  assert.equal(activation.brokerOnly, true);
  assert.equal(activation.authority, "none");
  assert.equal(activation.executionAuthorized, false);
  assert.equal(activation.modelDirectExecutionAuthorized, false);

  const after = runtime.getSnapshot();
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.attempts.length, before.attempts.length);
  assert.equal(typeof runtime.activateApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.deactivateApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.importApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.loadApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.executeApplicationAction, "undefined");
  assert.equal(typeof runtime.issueApplicationActionGrant, "undefined");

  runtime.dispose();
});

test("Personal OrdaX fails closed when provider artifact boundary is not configured", async () => {
  const runtime = composition({ withArtifactBoundary: false });
  const { preparation } = prepare(runtime);

  await assert.rejects(
    () => runtime.resolveApplicationActionProviderActivation(preparation.resourceRef),
    /provider activation is unavailable/,
  );
  assert.equal(typeof runtime.activateApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.executeApplicationAction, "undefined");

  runtime.dispose();
});
