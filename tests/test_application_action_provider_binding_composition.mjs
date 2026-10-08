import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { createNativeVerifiedComponentPackageSource } from "../system/adapters/native/verified-component-package-source.mjs";
import { EXTERNAL_FIRST_PARTY_OWNER } from "../system/services/apps/external-first-party-policy.mjs";

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
  let snapshot = {
    state: "signed-in",
    subjectId: "user-a",
    displayName: "User A",
  };
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    switchTo(subjectId) {
      snapshot = { state: "signed-in", subjectId, displayName: subjectId };
      for (const listener of [...listeners]) listener(snapshot);
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

function composition({
  onResolve = null,
  onArtifactIdentity = null,
  withArtifactBoundary = true,
  identity = identitySession(),
} = {}) {
  let runtime = null;
  const artifactInputs = withArtifactBoundary
    ? {
        verifiedComponentPackageSource: packageSource(),
        verifiedComponentFetch: async () => jsonResponse(metadata()),
        applicationActionProviderArtifactIdentity: async (url) => {
          if (onArtifactIdentity !== null) await onArtifactIdentity(runtime, url);
          return PROVIDER_SHA;
        },
      }
    : {};
  runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    intelligence: intelligence(),
    applicationActionCapabilityRegistry: capabilityRegistry(),
    createApplicationActionPreparationId: () => "prep-provider-1",
    resolveVerifiedApplicationSemantics: async (appId) => {
      assert.equal(appId, "notes");
      if (onResolve !== null) await onResolve(runtime);
      return verifiedSemantics();
    },
    expectedApplicationActionProviderOwner: OWNER,
    ...artifactInputs,
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

test("Personal OrdaX resolves current verified provider binding without creating authority", async () => {
  const runtime = composition();
  const { work, preparation } = prepare(runtime);
  const before = runtime.getSnapshot();

  const binding = await runtime.resolveApplicationActionProviderBinding(
    preparation.resourceRef,
  );

  assert.equal(binding.schema, "ordax.application-action-provider-binding/1");
  assert.equal(binding.resourceRef, preparation.resourceRef);
  assert.equal(binding.workItemId, work.id);
  assert.equal(binding.appId, "notes");
  assert.equal(binding.actionId, "notes.create-note");
  assert.equal(binding.appVersion, "0.4.2");
  assert.equal(binding.sourceCommit, SOURCE_COMMIT);
  assert.equal(binding.componentRevision, 12);
  assert.deepEqual(binding.provider, {
    kind: "first-party-native",
    adapterId: "notes-native",
    revision: "1",
  });
  assert.equal(binding.authority, "none");
  assert.equal(binding.executionAuthorized, false);
  assert.equal(binding.modelDirectExecutionAuthorized, false);

  const after = runtime.getSnapshot();
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.attempts.length, before.attempts.length);
  assert.equal(typeof runtime.requestApplicationActionApproval, "undefined");
  assert.equal(typeof runtime.executeApplicationAction, "undefined");
  assert.equal(typeof runtime.issueApplicationActionGrant, "undefined");

  runtime.dispose();
});

test("Personal OrdaX discards provider binding when Work changes during verified revalidation", async () => {
  let workId = null;
  const runtime = composition({
    onResolve: async (compositionRuntime) => {
      compositionRuntime.pause(workId);
    },
  });
  const prepared = prepare(runtime);
  workId = prepared.work.id;

  await assert.rejects(
    () => runtime.resolveApplicationActionProviderBinding(
      prepared.preparation.resourceRef,
    ),
    /changed during provider binding resolution/,
  );

  assert.equal(
    runtime.resolveApplicationActionPreparation(prepared.preparation.resourceRef),
    prepared.preparation,
  );
  runtime.dispose();
});

test("Personal OrdaX refuses provider binding after preparation revocation", async () => {
  const runtime = composition();
  const { preparation } = prepare(runtime);

  assert.equal(runtime.revokeApplicationActionPreparation(preparation.resourceRef), true);
  await assert.rejects(
    () => runtime.resolveApplicationActionProviderBinding(preparation.resourceRef),
    /preparation is no longer current/,
  );

  runtime.dispose();
});

test("Personal OrdaX resolves exact provider artifact identity without loading the provider", async () => {
  const artifactUrls = [];
  const runtime = composition({
    onArtifactIdentity: async (_runtime, url) => {
      artifactUrls.push(url);
    },
  });
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
  assert.equal(resolution.appVersion, "0.4.2");
  assert.equal(resolution.sourceCommit, SOURCE_COMMIT);
  assert.equal(resolution.componentRevision, 12);
  assert.deepEqual(resolution.provider, {
    kind: "first-party-native",
    adapterId: "notes-native",
    revision: "1",
    module: "actions/providers/notes-native.mjs",
    artifactSha256: PROVIDER_SHA,
  });
  assert.equal(resolution.authority, "none");
  assert.equal(resolution.executionAuthorized, false);
  assert.equal(resolution.modelDirectExecutionAuthorized, false);
  assert.equal(artifactUrls.length, 1);
  assert.match(
    new URL(artifactUrls[0]).pathname,
    /\/actions\/providers\/notes-native\.mjs$/,
  );

  const after = runtime.getSnapshot();
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.attempts.length, before.attempts.length);
  assert.equal(typeof runtime.importApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.loadApplicationActionProvider, "undefined");
  assert.equal(typeof runtime.executeApplicationAction, "undefined");

  runtime.dispose();
});

test("Personal OrdaX fails closed when Work changes during provider artifact hashing", async () => {
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
    /changed during provider binding resolution/,
  );
  assert.equal(typeof runtime.executeApplicationAction, "undefined");

  runtime.dispose();
});

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


test("artifact resolution cannot return a stale provider across A -> B -> A identity switching", async () => {
  const identity = identitySession();
  let switched = false;
  const runtime = composition({
    identity,
    onArtifactIdentity: async () => {
      if (switched) return;
      switched = true;
      identity.switchTo("user-b");
      identity.switchTo("user-a");
    },
  });
  try {
    const { preparation } = prepare(runtime);
    await assert.rejects(
      () => runtime.resolveApplicationActionProviderArtifact(preparation.resourceRef),
      /changed|context|current/i,
    );
    assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
    assert.equal(runtime.getSnapshot().approvals.length, 0);
    assert.equal(typeof runtime.executeApplicationAction, "undefined");
  } finally {
    runtime.dispose();
  }
});

test("provider activation cannot return prior-context result across A -> B -> A", async () => {
  const identity = identitySession();
  let switched = false;
  const runtime = composition({
    identity,
    onResolve: async () => {
      if (switched) return;
      switched = true;
      identity.switchTo("user-b");
      identity.switchTo("user-a");
    },
  });
  try {
    const { preparation } = prepare(runtime);
    await assert.rejects(
      () => runtime.resolveApplicationActionProviderActivation(preparation.resourceRef),
      /changed|context|current/i,
    );
    assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
    assert.equal(runtime.getSnapshot().attempts.length, 0);
    assert.equal(typeof runtime.activateApplicationActionProvider, "undefined");
  } finally {
    runtime.dispose();
  }
});

test("explicit revocation during artifact hashing cannot leak an obsolete resolution", async () => {
  const runtime = composition({
    onArtifactIdentity: async (current) => {
      for (const preparation of current.listApplicationActionPreparations("personal-work-1")) {
        current.revokeApplicationActionPreparation(preparation.resourceRef);
      }
    },
  });
  try {
    const { preparation } = prepare(runtime);
    await assert.rejects(
      () => runtime.resolveApplicationActionProviderArtifact(preparation.resourceRef),
      /changed|context|current/i,
    );
    assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
  } finally {
    runtime.dispose();
  }
});
