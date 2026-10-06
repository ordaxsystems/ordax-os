import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";

const OWNER = "washingtonmsdj/ordax-apps";
const SOURCE_COMMIT = "a".repeat(40);

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

function mutableIdentitySession() {
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
      return () => listeners.delete(listener);
    },
    signOut() {
      snapshot = {
        state: "signed-out",
        subjectId: null,
        displayName: null,
      };
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function selectedSpace() {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      return {
        schema: SPACE_SELECTION_SCHEMA,
        state: "selected",
        subjectId: "user-a",
        selectedSpace: {
          id: "space-a",
          name: "Pizzaria",
          kind: "professional",
          state: "active",
          ownerId: "user-a",
          profilePack: "pizzaria-br",
        },
      };
    },
    subscribe() {
      return () => {};
    },
    select() {},
    clear() {},
  };
}

function mutableProjectCatalog() {
  let projects = [{
    id: "project-1",
    name: "Operacao",
    path: "/Operacao",
    createdAt: 1,
    lastOpenedAt: 1,
    lastFilePath: null,
  }];
  const listeners = new Set();
  const snapshot = () => ({
    persistence: "device",
    projects: [...projects],
  });
  return {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    removeProject(id) {
      projects = projects.filter((project) => project.id !== id);
      for (const listener of [...listeners]) listener(snapshot());
    },
    create() {},
    rename() {},
    recordOpened() {},
    recordFileOpened() {},
    clearLastFile() {},
    relocateLastFilePath() {},
    remove() {},
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
        modelId: "qwen-test",
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
        text: "resultado",
        engineId: "llama.cpp",
        modelId: "qwen-test",
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

function applicationCapabilities() {
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
    sourceCommit: SOURCE_COMMIT,
    revision: 12,
  };
}

function composition({
  identity = mutableIdentitySession(),
  projects = mutableProjectCatalog(),
  onResolve = null,
} = {}) {
  let ordinal = 0;
  const registry = applicationCapabilities();
  let runtime = null;
  runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    spaceSelection: selectedSpace(),
    projects,
    intelligence: intelligence(),
    applicationActionCapabilityRegistry: registry,
    resolveVerifiedApplicationSemantics: async (appId) => {
      assert.equal(appId, "notes");
      if (onResolve !== null) await onResolve(runtime);
      return verifiedSemantics();
    },
    expectedApplicationActionProviderOwner: OWNER,
    createApplicationActionPreparationId: () => `prep-${++ordinal}`,
  });
  return { runtime, identity, projects };
}

function prepare(runtime, options = {}) {
  const work = runtime.create("Criar uma nota", {
    spaceId: options.spaceId ?? "space-a",
    projectId: options.projectId ?? "project-1",
  });
  const proposal = runtime.proposeApplicationAction(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const preparation = runtime.prepareApplicationAction(work.id, proposal);
  return { work, proposal, preparation };
}

test("Personal OrdaX composes proposal, preparation and current verified provider binding without authority", async () => {
  const { runtime } = composition();
  const before = runtime.getSnapshot();
  const { work, preparation } = prepare(runtime);

  assert.equal(preparation.resourceRef, "application-action:prep-1");
  assert.equal(preparation.workItemId, work.id);
  assert.equal(preparation.authority, "none");
  assert.equal(preparation.executionAuthorized, false);
  assert.equal(preparation.modelDirectExecutionAuthorized, false);

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

test("Application Action preparation is revoked when its Work becomes terminal", () => {
  const { runtime } = composition();
  const { work, preparation } = prepare(runtime);

  runtime.cancel(work.id);

  assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
  assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  runtime.dispose();
});

test("Application Action preparation is revoked on any Work revision drift", () => {
  const { runtime } = composition();
  const { work, preparation } = prepare(runtime);

  runtime.pause(work.id);

  assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
  runtime.dispose();
});

test("Application Action preparation is revoked across owner changes", () => {
  const identity = mutableIdentitySession();
  const { runtime } = composition({ identity });
  const { preparation } = prepare(runtime);

  identity.signOut();

  assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
  runtime.dispose();
});

test("Application Action preparation is revoked when bound project context disappears", () => {
  const projects = mutableProjectCatalog();
  const { runtime } = composition({ projects });
  const { preparation } = prepare(runtime);

  projects.removeProject("project-1");

  assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
  runtime.dispose();
});

test("provider binding result is discarded if Work changes during verified revalidation", async () => {
  let workId = null;
  const { runtime } = composition({
    onResolve: async (compositionRuntime) => {
      compositionRuntime.cancel(workId);
    },
  });
  const prepared = prepare(runtime);
  workId = prepared.work.id;

  await assert.rejects(
    () => runtime.resolveApplicationActionProviderBinding(
      prepared.preparation.resourceRef,
    ),
    /changed during provider binding resolution|preparation is no longer current/,
  );
  assert.equal(
    runtime.resolveApplicationActionPreparation(prepared.preparation.resourceRef),
    null,
  );
  runtime.dispose();
});

test("Application Action preparation remains manually revocable and provider binding then fails closed", async () => {
  const { runtime } = composition();
  const { preparation } = prepare(runtime);

  assert.equal(runtime.revokeApplicationActionPreparation(preparation.resourceRef), true);
  assert.equal(runtime.resolveApplicationActionPreparation(preparation.resourceRef), null);
  assert.equal(runtime.revokeApplicationActionPreparation(preparation.resourceRef), false);
  await assert.rejects(
    () => runtime.resolveApplicationActionProviderBinding(preparation.resourceRef),
    /preparation is no longer current/,
  );

  runtime.dispose();
});
