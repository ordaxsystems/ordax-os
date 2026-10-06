import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
} from "../system/contracts/verified-component-package-source.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";

const OWNER = "washingtonmsdj/ordax-apps";
const SOURCE_COMMIT = "a".repeat(40);
const ARTIFACT_SHA256 = "b".repeat(64);

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
      revision: "2",
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
    provenance: "ordax-apps:notes/actions/manifest.json",
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
        version: "0.4.3",
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
      appVersion: "0.4.3",
      authority: "none",
      execution: "proposal-only",
      capabilities: [action],
    },
    providerManifest: {
      schema: "ordax.application-action-provider-manifest/1",
      appId: "notes",
      appVersion: "0.4.3",
      authority: "none",
      execution: "unavailable",
      providers: [{
        kind: "first-party-native",
        adapterId: "notes-native",
        revision: "2",
        module: "actions/providers/notes-native.mjs",
        sha256: ARTIFACT_SHA256,
      }],
    },
    sourceCommit: SOURCE_COMMIT,
    revision: 12,
  };
}

function verifiedSource() {
  return Object.freeze({
    schema: VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
    metadataUrl(componentId, state) {
      return `http://127.0.0.1:31337/__ordax/native/component-runtime?component=${componentId}&state=${state}`;
    },
    fileUrl({ componentId, state, resolution, path }) {
      return (
        "http://127.0.0.1:31337/__ordax/native/component-module/"
        + `${componentId}/${state}/${resolution.version}/${resolution.sourceCommit}/${path}`
      );
    },
  });
}

async function verifiedFetch(url) {
  assert.match(url, /component=notes&state=current$/);
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        componentId: "notes",
        state: "current",
        source: "slot",
        revision: 12,
        version: "0.4.3",
        sourceCommit: SOURCE_COMMIT,
        entrypoint: "system/apps/notes/src/runtime.mjs",
        pendingHealth: null,
      };
    },
  };
}

function composition({ onArtifactIdentity = null } = {}) {
  let runtime = null;
  runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: intelligence(),
    applicationActionCapabilityRegistry: capabilityRegistry(),
    createApplicationActionPreparationId: () => "prep-artifact-1",
    resolveVerifiedApplicationSemantics: async (appId) => {
      assert.equal(appId, "notes");
      return verifiedSemantics();
    },
    verifiedComponentPackageSource: verifiedSource(),
    verifiedComponentFetch: verifiedFetch,
    applicationActionProviderArtifactIdentity: async (moduleUrl) => {
      assert.match(
        moduleUrl,
        new RegExp(
          "/component-module/notes/current/0\\.4\\.3/"
          + SOURCE_COMMIT
          + "/system/apps/notes/actions/providers/notes-native\\.mjs$",
        ),
      );
      if (onArtifactIdentity !== null) await onArtifactIdentity(runtime);
      return ARTIFACT_SHA256;
    },
    expectedApplicationActionProviderOwner: OWNER,
  });
  return runtime;
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

test("Personal OrdaX resolves exact provider artifact without creating authority or importing provider code", async () => {
  const runtime = composition();
  const { work, preparation } = prepare(runtime);
  const before = runtime.getSnapshot();

  const resolution = await runtime.resolveApplicationActionProviderArtifact(
    preparation.resourceRef,
  );

  assert.equal(resolution.schema, "ordax.application-action-provider-resolution/1");
  assert.equal(resolution.resourceRef, preparation.resourceRef);
  assert.equal(resolution.workItemId, work.id);
  assert.equal(resolution.appId, "notes");
  assert.equal(resolution.actionId, "notes.create-note");
  assert.equal(resolution.appVersion, "0.4.3");
  assert.equal(resolution.sourceCommit, SOURCE_COMMIT);
  assert.equal(resolution.componentRevision, 12);
  assert.deepEqual(resolution.provider, {
    kind: "first-party-native",
    adapterId: "notes-native",
    revision: "2",
    module: "actions/providers/notes-native.mjs",
    artifactSha256: ARTIFACT_SHA256,
  });
  assert.equal(resolution.authority, "none");
  assert.equal(resolution.executionAuthorized, false);
  assert.equal(resolution.modelDirectExecutionAuthorized, false);

  const after = runtime.getSnapshot();
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.attempts.length, before.attempts.length);
  assert.equal(typeof runtime.requestApplicationActionApproval, "undefined");
  assert.equal(typeof runtime.executeApplicationAction, "undefined");
  assert.equal(typeof runtime.loadApplicationActionProvider, "undefined");

  runtime.dispose();
});

test("Personal OrdaX rejects artifact resolution when Work changes during module hashing", async () => {
  let workId = null;
  const runtime = composition({
    onArtifactIdentity: async (compositionRuntime) => {
      compositionRuntime.pause(workId);
    },
  });
  const prepared = prepare(runtime);
  workId = prepared.work.id;

  await assert.rejects(
    () => runtime.resolveApplicationActionProviderArtifact(
      prepared.preparation.resourceRef,
    ),
    /changed during provider artifact resolution/,
  );

  assert.equal(
    runtime.resolveApplicationActionPreparation(prepared.preparation.resourceRef),
    prepared.preparation,
  );
  runtime.dispose();
});

test("Personal OrdaX requires the complete verified artifact-resolution dependency set", () => {
  assert.throws(
    () => createNativePersonalOrdaxComposition({
      windowRef: { localStorage: memoryStorage() },
      identitySession: identitySession(),
      intelligence: intelligence(),
      applicationActionCapabilityRegistry: capabilityRegistry(),
      createApplicationActionPreparationId: () => "prep-artifact-2",
      resolveVerifiedApplicationSemantics: async () => verifiedSemantics(),
      verifiedComponentPackageSource: verifiedSource(),
      expectedApplicationActionProviderOwner: OWNER,
    }),
    /requires source, fetch and artifact identity together/,
  );
});
