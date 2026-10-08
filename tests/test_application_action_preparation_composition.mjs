import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { APPLICATION_SEMANTIC_ROUTER_SCHEMA } from "../system/services/intelligence/application-semantic-router.mjs";
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
    switchTo(subjectId) {
      snapshot = {
        state: "signed-in",
        subjectId,
        displayName: subjectId,
      };
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

function selectedSpace() {
  let spaceId = "space-a";
  const listeners = new Set();
  const snapshot = () => ({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-a",
    selectedSpace: {
      id: spaceId,
      name: "Pizzaria",
      kind: "professional",
      state: "active",
      ownerId: "user-a",
      profilePack: "pizzaria-br",
    },
  });
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSpaceId(id) {
      spaceId = id;
      for (const listener of [...listeners]) listener(snapshot());
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
    touch() {
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

function semanticRouter() {
  return {
    schema: APPLICATION_SEMANTIC_ROUTER_SCHEMA,
    select(goal) {
      return /nota|note|anot/i.test(goal) ? [{ appId: "notes", score: 20 }] : [];
    },
    contextItemsForPrompt() { return []; },
    route(goal) { return { selection: this.select(goal), contextItems: [] }; },
  };
}

function proposalIntelligence(text) {
  const requests = [];
  return {
    requests,
    port: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready", inferenceAvailable: true, engineId: "llama.cpp",
        modelId: "qwen-test", authority: "none", toolExecution: false,
      }),
      subscribe() { return () => {}; },
      async respond(request) {
        requests.push(request);
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text, engineId: "llama.cpp", modelId: "qwen-test", authority: "none",
        };
      },
    },
  };
}

function composition({
  identity = mutableIdentitySession(),
  projects = mutableProjectCatalog(),
  spaces = selectedSpace(),
  ai = intelligence(),
  router = semanticRouter(),
} = {}) {
  let ordinal = 0;
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    spaceSelection: spaces,
    projects,
    intelligence: ai,
    applicationActionCapabilityRegistry: applicationCapabilities(),
    applicationSemanticRouter: router,
    createApplicationActionPreparationId: () => `prep-${++ordinal}`,
  });
  return { runtime, identity, projects, spaces };
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
  assert.equal(typeof runtime.requestApplicationActionApproval, "undefined");
  assert.equal(typeof runtime.executeApplicationAction, "undefined");
  assert.equal(typeof runtime.issueApplicationActionGrant, "undefined");

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


test("model suggests a verified first-party Application Action but cannot grant or execute it", async () => {
  const ai = proposalIntelligence(JSON.stringify({
    kind: "proposal", appId: "notes", actionId: "notes.create-note",
    arguments: { title: "Ideias" },
  }));
  const { runtime } = composition({ ai: ai.port });
  try {
    const work = runtime.create("Criar uma nota para Ideias", {
      spaceId: "space-a", projectId: "project-1",
    });
    const suggested = await runtime.suggestApplicationActionForWork(work.id);
    assert.equal(suggested.appId, "notes");
    assert.equal(suggested.actionId, "notes.create-note");
    assert.deepEqual(suggested.arguments, { title: "Ideias" });
    assert.equal(suggested.executionAuthorized, false);
    assert.equal(suggested.modelDirectExecutionAuthorized, false);
    assert.equal(ai.requests.length, 1);
    assert.match(ai.requests[0].prompt, /allowedActions=/);
    assert.doesNotMatch(ai.requests[0].prompt, /toolArtifactSha256|grantRef|approvalId/);

    const before = runtime.getSnapshot();
    const prepared = runtime.prepareSuggestedApplicationAction(work.id, suggested);
    const after = runtime.getSnapshot();
    assert.equal(prepared.workItemId, work.id);
    assert.equal(prepared.proposal.capabilitySha256, suggested.capabilitySha256);
    assert.equal(prepared.authority, "none");
    assert.equal(prepared.executionAuthorized, false);
    assert.equal(prepared.modelDirectExecutionAuthorized, false);
    assert.deepEqual(after.approvals, before.approvals);
    assert.deepEqual(after.decisions, before.decisions);
    assert.deepEqual(after.attempts, before.attempts);
    assert.equal(typeof runtime.executeApplicationAction, "undefined");
    await assert.rejects(
      async () => runtime.prepareSuggestedApplicationAction(work.id, suggested),
      /not current or issued/,
    );
  } finally {
    runtime.dispose();
  }
});

test("model cannot invent a capability, smuggle authority or undeclared arguments", async () => {
  for (const result of [
    { kind: "proposal", appId: "notes", actionId: "notes.delete-note", arguments: {} },
    { kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {}, authority: "model" },
    { kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: { rawPath: "/tmp" } },
    { kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: { title: "x".repeat(241) } },
  ]) {
    const { runtime } = composition({ ai: proposalIntelligence(JSON.stringify(result)).port });
    try {
      const work = runtime.create("Criar uma nota");
      await assert.rejects(() => runtime.suggestApplicationActionForWork(work.id));
      assert.deepEqual(runtime.getSnapshot().approvals, []);
      assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
    } finally {
      runtime.dispose();
    }
  }
});

test("semantic router abstains from irrelevant Work instead of exposing random app actions", async () => {
  const ai = proposalIntelligence(JSON.stringify({ kind: "none" }));
  const { runtime } = composition({ ai: ai.port });
  try {
    const work = runtime.create("Qual é a previsão do tempo?");
    assert.equal(await runtime.suggestApplicationActionForWork(work.id), null);
    assert.equal(ai.requests.length, 0);
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});

test("model suggestion is revoked before preparation when owner changes", async () => {
  const account = mutableIdentitySession();
  const ai = proposalIntelligence(JSON.stringify({
    kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
  }));
  const { runtime } = composition({ ai: ai.port, identity: account });
  try {
    const work = runtime.create("Criar uma nota");
    const suggestion = await runtime.suggestApplicationActionForWork(work.id);
    account.signOut();
    assert.throws(
      () => runtime.prepareSuggestedApplicationAction(work.id, suggestion),
      /Work|owner|scope|current/i,
    );
    assert.deepEqual(runtime.getSnapshot().approvals, []);
  } finally {
    runtime.dispose();
  }
});

test("model suggestion is revoked if bound Project is removed", async () => {
  const projects = mutableProjectCatalog();
  const ai = proposalIntelligence(JSON.stringify({
    kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
  }));
  const { runtime } = composition({ ai: ai.port, projects });
  try {
    const work = runtime.create("Criar uma nota", {
      spaceId: "space-a", projectId: "project-1",
    });
    const suggestion = await runtime.suggestApplicationActionForWork(work.id);
    projects.removeProject("project-1");
    assert.throws(
      () => runtime.prepareSuggestedApplicationAction(work.id, suggestion),
      /scope|Work|current/i,
    );
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});

test("account switch during asynchronous model planning discards the pending Application Action", async () => {
  const account = mutableIdentitySession();
  let complete;
  const ai = proposalIntelligence("{}");
  ai.port.respond = async () => new Promise((resolve) => {
    complete = () => resolve({
      schema: INTELLIGENCE_RESPONSE_SCHEMA,
      text: JSON.stringify({
        kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
      }),
      engineId: "llama.cpp", modelId: "qwen-test", authority: "none",
    });
  });
  const { runtime } = composition({ ai: ai.port, identity: account });
  try {
    const work = runtime.create("Criar uma nota");
    const pending = runtime.suggestApplicationActionForWork(work.id);
    account.signOut();
    complete();
    await assert.rejects(pending, /owner changed|Work/);
    assert.deepEqual(runtime.getSnapshot().approvals, []);
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});


test("A -> B -> A owner switch cannot resurrect an already-issued app suggestion", async () => {
  const identity = mutableIdentitySession();
  const ai = proposalIntelligence(JSON.stringify({
    kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
  }));
  const { runtime } = composition({ identity, ai: ai.port });
  try {
    const work = runtime.create("Criar uma nota");
    const suggestion = await runtime.suggestApplicationActionForWork(work.id);
    identity.switchTo("user-b");
    identity.switchTo("user-a");
    assert.throws(
      () => runtime.prepareSuggestedApplicationAction(work.id, suggestion),
      /context|scope|Work/i,
    );
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});

test("A -> B -> A owner switch during pending inference cannot resurrect app response", async () => {
  const identity = mutableIdentitySession();
  let finish;
  const ai = proposalIntelligence("{}");
  ai.port.respond = () => new Promise((resolve) => {
    finish = () => resolve({
      schema: INTELLIGENCE_RESPONSE_SCHEMA,
      text: JSON.stringify({
        kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
      }),
      engineId: "llama.cpp", modelId: "qwen-test", authority: "none",
    });
  });
  const { runtime } = composition({ identity, ai: ai.port });
  try {
    const work = runtime.create("Criar uma nota");
    const pending = runtime.suggestApplicationActionForWork(work.id);
    identity.switchTo("user-b");
    identity.switchTo("user-a");
    finish();
    await assert.rejects(pending, /context changed|owner changed/);
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});

test("Space A -> B -> A invalidates app suggestion even when Work is unchanged", async () => {
  const spaces = selectedSpace();
  const ai = proposalIntelligence(JSON.stringify({
    kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
  }));
  const { runtime } = composition({ spaces, ai: ai.port });
  try {
    const work = runtime.create("Criar uma nota"); // no Space-bound Work mutation
    const suggestion = await runtime.suggestApplicationActionForWork(work.id);
    spaces.setSpaceId("space-b");
    spaces.setSpaceId("space-a");
    assert.throws(
      () => runtime.prepareSuggestedApplicationAction(work.id, suggestion),
      /context|scope/i,
    );
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});

test("project catalog change invalidates issued app suggestions with no authority leakage", async () => {
  const projects = mutableProjectCatalog();
  const ai = proposalIntelligence(JSON.stringify({
    kind: "proposal", appId: "notes", actionId: "notes.create-note", arguments: {},
  }));
  const { runtime } = composition({ projects, ai: ai.port });
  try {
    const work = runtime.create("Criar uma nota");
    const suggestion = await runtime.suggestApplicationActionForWork(work.id);
    projects.touch(); // conservatively invalidate even if the Work revision is unchanged
    assert.throws(
      () => runtime.prepareSuggestedApplicationAction(work.id, suggestion),
      /context|scope/i,
    );
    assert.deepEqual(runtime.getSnapshot().approvals, []);
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});

test("prepared app action reference cannot return after A -> B -> A account switch", () => {
  const identity = mutableIdentitySession();
  const { runtime } = composition({ identity });
  try {
    const work = runtime.create("Criar uma nota");
    const proposal = runtime.proposeApplicationAction("notes", "notes.create-note", {});
    const prepared = runtime.prepareApplicationAction(work.id, proposal);
    identity.switchTo("user-b");
    identity.switchTo("user-a");
    assert.equal(runtime.resolveApplicationActionPreparation(prepared.resourceRef), null);
    assert.deepEqual(runtime.listApplicationActionPreparations(work.id), []);
  } finally {
    runtime.dispose();
  }
});
