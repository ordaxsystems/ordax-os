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
    capabilities: [{
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
      provenance: "test:notes-actions",
    }],
  });
}

function composition({ identity = mutableIdentitySession(), projects = mutableProjectCatalog() } = {}) {
  let ordinal = 0;
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    spaceSelection: selectedSpace(),
    projects,
    intelligence: intelligence(),
    applicationActionCapabilityRegistry: applicationCapabilities(),
    createApplicationActionPreparationId: () => `prep-${++ordinal}`,
  });
  return { runtime, identity, projects };
}

test("Native composition prepares verified Application Actions without creating authority", () => {
  const { runtime } = composition();
  const work = runtime.create("Criar uma nota", {
    spaceId: "space-a",
    projectId: "project-1",
  });

  const proposal = runtime.proposeApplicationAction(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const before = runtime.getSnapshot();
  const prepared = runtime.prepareApplicationAction(work.id, proposal);
  const after = runtime.getSnapshot();

  assert.equal(prepared.resourceRef, "application-action:prep-1");
  assert.equal(prepared.workItemId, work.id);
  assert.equal(prepared.authority, "none");
  assert.equal(prepared.executionAuthorized, false);
  assert.equal(prepared.modelDirectExecutionAuthorized, false);
  assert.equal(prepared.effect, "write");
  assert.equal(runtime.resolveApplicationActionPreparation(prepared.resourceRef), prepared);
  assert.deepEqual(runtime.listApplicationActionPreparations(work.id), [prepared]);
  assert.equal(runtime.listAvailableApplicationActions("notes").length, 1);

  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.attempts.length, before.attempts.length);

  runtime.dispose();
});

test("Application Action preparation is revoked when its Work becomes terminal", () => {
  const { runtime } = composition();
  const work = runtime.create("Criar uma nota", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const prepared = runtime.prepareApplicationAction(
    work.id,
    runtime.proposeApplicationAction("notes", "notes.create-note", { title: "Ideias" }),
  );

  runtime.cancel(work.id);

  assert.equal(runtime.resolveApplicationActionPreparation(prepared.resourceRef), null);
  assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  runtime.dispose();
});

test("Application Action preparation is revoked across owner changes", () => {
  const identity = mutableIdentitySession();
  const { runtime } = composition({ identity });
  const work = runtime.create("Criar uma nota", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const prepared = runtime.prepareApplicationAction(
    work.id,
    runtime.proposeApplicationAction("notes", "notes.create-note", { title: "Ideias" }),
  );

  identity.signOut();

  assert.equal(runtime.resolveApplicationActionPreparation(prepared.resourceRef), null);
  runtime.dispose();
});

test("Application Action preparation is revoked when bound project context disappears", () => {
  const projects = mutableProjectCatalog();
  const { runtime } = composition({ projects });
  const work = runtime.create("Criar uma nota", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const prepared = runtime.prepareApplicationAction(
    work.id,
    runtime.proposeApplicationAction("notes", "notes.create-note", { title: "Ideias" }),
  );

  projects.removeProject("project-1");

  assert.equal(runtime.resolveApplicationActionPreparation(prepared.resourceRef), null);
  runtime.dispose();
});

test("Application Action preparation remains explicit and manually revocable", () => {
  const { runtime } = composition();
  const work = runtime.create("Criar uma nota");
  const prepared = runtime.prepareApplicationAction(
    work.id,
    runtime.proposeApplicationAction("notes", "notes.create-note", { title: "Ideias" }),
  );

  assert.equal(runtime.revokeApplicationActionPreparation(prepared.resourceRef), true);
  assert.equal(runtime.resolveApplicationActionPreparation(prepared.resourceRef), null);
  assert.equal(runtime.revokeApplicationActionPreparation(prepared.resourceRef), false);

  runtime.dispose();
});
