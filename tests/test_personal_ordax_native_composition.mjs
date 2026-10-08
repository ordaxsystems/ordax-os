import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { createIntelligenceToolGrantAuthority } from "../system/services/intelligence/tool-grants.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";
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

function identitySession() {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-in", subjectId: "user-a", displayName: "User A" };
    },
    subscribe() {
      return () => {};
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

function projectCatalog() {
  return {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot() {
      return {
        persistence: "device",
        projects: [{
          id: "project-1",
          name: "Operacao",
          path: "/Operacao",
          createdAt: 1,
          lastOpenedAt: 1,
          lastFilePath: null,
        }],
      };
    },
    subscribe() {
      return () => {};
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

test("Native composition reuses canonical owner/context/intelligence ports without implicit binding", () => {
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
  });

  const work = runtime.create("Planejar o proximo passo");
  assert.equal(work.ownerKind, "account");
  assert.equal(work.ownerId, "user-a");
  assert.equal(work.spaceId, null);
  assert.equal(work.projectId, null);
  assert.deepEqual(work.contextRefs, []);
  assert.equal(runtime.getSnapshot().persistence, "device");
  runtime.dispose();
});

test("Native composition persists completed owner-bound Work Result through the native store", async () => {
  const localStorage = memoryStorage();
  const ports = {
    windowRef: { localStorage },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
  };

  const first = createNativePersonalOrdaxComposition(ports);
  const work = first.create("Executar raciocinio foreground", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  await first.run(work.id);
  const completed = first.getSnapshot();
  assert.equal(completed.workItems[0].state, "completed");
  assert.equal(completed.results.length, 1);
  assert.equal(completed.results[0].workItemId, work.id);
  assert.equal(completed.results[0].authority, "none");
  first.dispose();

  const restored = createNativePersonalOrdaxComposition(ports);
  const snapshot = restored.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.equal(snapshot.workItems[0].state, "completed");
  assert.equal(snapshot.results[0].text, "resultado");
  assert.ok(
    snapshot.activities.some((event) =>
      event.workItemId === work.id
      && event.type === "completed"
      && event.artifactRefs.includes(`result:${snapshot.results[0].id}`)
    ),
  );
  restored.dispose();
});


test("Native composition resolves approvals through the injected canonical grant registry", () => {
  const nowMs = Date.now();
  const authority = createIntelligenceToolGrantAuthority({
    now: () => nowMs,
    createGrantId: () => "grant-native-approval-1",
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
    grantAuthority: authority,
    toolResolver(toolId) {
      if (toolId !== "files-inspector") return null;
      return {
        id: "files-inspector",
        version: "1.0.0",
        artifactSha256: "a".repeat(64),
        sandbox: "wasi-component",
        actions: [{
          id: "files.document.write",
          mode: "write",
          approval: "per-use",
          scopes: [],
        }],
        network: { allowed: false, destinations: [] },
        filesystem: { allowed: true, scopes: ["/Operacao"] },
        limits: { timeoutMs: 1000, maxOutputBytes: 4096 },
      };
    },
  });

  const work = runtime.create("Atualizar documento", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    resourceRef: "file-space:/Operacao/menu.md",
    reason: "Salvar alteracao solicitada pelo usuario.",
  });
  const decision = runtime.approvalConsent.approve(work.id, approval.id);

  assert.equal(decision.decision, "allow");
  assert.equal(decision.grantRef, "grant-native-approval-1");
  assert.equal(authority.registry.resolve(decision.grantRef)?.ownerId, "user-a");
  assert.equal(authority.registry.resolve(decision.grantRef)?.toolArtifactSha256, "a".repeat(64));
  assert.equal(
    authority.registry.resolve(decision.grantRef)?.resourceRef,
    "file-space:/Operacao/menu.md",
  );
  assert.equal(runtime.getSnapshot().workItems[0].state, "queued");
  assert.equal(typeof runtime.issueGrant, "undefined");
  assert.equal(typeof runtime.grantIssuer, "undefined");
  assert.equal(typeof runtime.approvalConsent.approve, "function");
  assert.equal(typeof runtime.approvalConsent.deny, "function");

  runtime.dispose();
  authority.dispose();
});


test("Native proposal port is catalog-bound and creates no approval or authority", () => {
  const catalog = createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) {
        if (typeof value !== "string") throw new TypeError("resource must be text");
        const path = value.trim();
        if (!path.startsWith("/") || path.includes("..")) {
          throw new TypeError("resource path is invalid");
        }
        return `file-space:${path}`;
      },
      reason: "Ensure the explicitly selected directory exists.",
    }],
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
    actionCatalog: catalog,
  });

  const work = runtime.create("Planejar uma pasta para o projeto", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const before = runtime.getSnapshot();

  const proposal = runtime.proposeAvailableAction(
    work.id,
    "native-file.ensure-directory",
    {
      resourceValue: "/Operacao/Briefing",
      rationale: "Separar os artefatos do briefing sem executar nenhuma mutacao.",
    },
  );

  assert.equal(proposal.authority, "none");
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.approvalRequested, false);
  assert.equal("resourceRef" in proposal, false);
  assert.equal("toolId" in proposal, false);
  assert.equal("actionId" in proposal, false);

  const after = runtime.getSnapshot();
  assert.equal(after.approvals.length, before.approvals.length);
  assert.equal(after.decisions.length, before.decisions.length);
  assert.equal(after.attempts.length, before.attempts.length);

  assert.throws(
    () => runtime.proposeAvailableAction(
      "fabricated-work",
      "native-file.ensure-directory",
      {
        resourceValue: "/Operacao/Fora",
        rationale: "Nao deve existir proposal fora do Work corrente.",
      },
    ),
    /current owner-bound Work item/,
  );

  runtime.cancel(work.id);
  assert.throws(
    () => runtime.proposeAvailableAction(
      work.id,
      "native-file.ensure-directory",
      {
        resourceValue: "/Operacao/Fora",
        rationale: "Nao deve existir proposal em Work terminal.",
      },
    ),
    /queued or paused Work/,
  );

  runtime.dispose();
});


test("model proposal remains authority-free until explicit conversion to approval", async () => {
  const catalog = createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) {
        const path = String(value).trim();
        if (!path.startsWith("/") || path.includes("..")) {
          throw new TypeError("resource path is invalid");
        }
        return "file-space:" + path;
      },
      reason: "Trusted catalog reason for explicit directory approval.",
    }],
  });
  const requests = [];
  const proposalIntelligence = {
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
    async respond(request) {
      requests.push(request);
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: JSON.stringify({
          kind: "proposal",
          entryId: "native-file.ensure-directory",
          resourceValue: "/Operacao/Briefing",
          rationale: "Model rationale is advisory only.",
        }),
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: proposalIntelligence,
    actionCatalog: catalog,
  });

  const work = runtime.create("Organizar briefing", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const before = runtime.getSnapshot();
  const proposal = await runtime.proposeActionForWork(work.id);

  assert.equal(proposal.authority, "none");
  assert.equal(proposal.approvalRequested, false);
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.rationale, "Model rationale is advisory only.");
  assert.equal(runtime.getSnapshot().approvals.length, before.approvals.length);
  assert.equal(runtime.getSnapshot().decisions.length, before.decisions.length);
  assert.equal(runtime.getSnapshot().attempts.length, before.attempts.length);
  assert.equal(requests.length, 1);

  assert.throws(
    () => runtime.requestProposedAction({ ...proposal }),
    /binding is unavailable/,
  );
  assert.equal(runtime.getSnapshot().approvals.length, before.approvals.length);

  const approval = runtime.requestProposedAction(proposal);
  const after = runtime.getSnapshot();
  assert.equal(after.approvals.length, before.approvals.length + 1);
  assert.equal(after.workItems.find((item) => item.id === work.id)?.state, "waiting-approval");
  assert.equal(approval.reason, "Trusted catalog reason for explicit directory approval.");
  assert.notEqual(approval.reason, proposal.rationale);
  assert.equal(approval.resourceRef, "file-space:/Operacao/Briefing");

  await assert.rejects(
    () => runtime.proposeActionForWork(work.id),
    /queued or paused|unresolved authority/,
  );
  assert.equal(requests.length, 1);

  runtime.dispose();
});


test("model proposal is discarded when owner changes during inference", async () => {
  const listeners = new Set();
  let identitySnapshot = { state: "signed-in", subjectId: "user-a", displayName: "User A" };
  const mutableIdentity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return identitySnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const changeOwner = (subjectId) => {
    identitySnapshot = {
      state: "signed-in",
      subjectId,
      displayName: subjectId,
    };
    for (const listener of [...listeners]) listener(identitySnapshot);
  };

  let resolveInference;
  const proposalIntelligence = {
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
    respond() {
      return new Promise((resolve) => {
        resolveInference = resolve;
      });
    },
  };
  const catalog = createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) {
        return "file-space:" + String(value).trim();
      },
      reason: "Trusted catalog reason.",
    }],
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: mutableIdentity,
    intelligence: proposalIntelligence,
    actionCatalog: catalog,
  });
  const work = runtime.create("Criar uma pasta para o briefing");
  const pending = runtime.proposeActionForWork(work.id);

  changeOwner("user-b");
  resolveInference({
    schema: INTELLIGENCE_RESPONSE_SCHEMA,
    text: JSON.stringify({
      kind: "proposal",
      entryId: "native-file.ensure-directory",
      resourceValue: "/Briefing",
      rationale: "Sugestao tardia do owner anterior.",
    }),
    engineId: "llama.cpp",
    modelId: "qwen-test",
    authority: "none",
  });

  await assert.rejects(pending, /owner changed/);
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.ownerId, "user-b");
  assert.equal(snapshot.workItems.length, 0);
  assert.equal(snapshot.approvals.length, 0);
  assert.equal(snapshot.decisions.length, 0);
  assert.equal(snapshot.attempts.length, 0);

  runtime.dispose();
});


test("issued proposal cannot cross owners even when local work ids are reused", async () => {
  const listeners = new Set();
  let identitySnapshot = { state: "signed-in", subjectId: "user-a", displayName: "User A" };
  const mutableIdentity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return identitySnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const switchOwner = (subjectId) => {
    identitySnapshot = { state: "signed-in", subjectId, displayName: subjectId };
    for (const listener of [...listeners]) listener(identitySnapshot);
  };
  const proposalIntelligence = {
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
        text: JSON.stringify({
          kind: "proposal",
          entryId: "native-file.ensure-directory",
          resourceValue: "/OwnerA",
          rationale: "Suggestion for owner A only.",
        }),
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
  const catalog = createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) {
        return "file-space:" + String(value).trim();
      },
      reason: "Trusted catalog reason.",
    }],
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: mutableIdentity,
    intelligence: proposalIntelligence,
    actionCatalog: catalog,
  });

  const ownerAWork = runtime.create("Owner A work");
  assert.equal(ownerAWork.id, "personal-work-1");
  const proposal = await runtime.proposeActionForWork(ownerAWork.id);

  switchOwner("user-b");
  const ownerBWork = runtime.create("Owner B work");
  assert.equal(ownerBWork.id, "personal-work-1");

  assert.throws(
    () => runtime.requestProposedAction(proposal),
    /different owner/,
  );
  assert.equal(runtime.getSnapshot().ownerId, "user-b");
  assert.equal(runtime.getSnapshot().approvals.length, 0);

  runtime.dispose();
});


test("issued proposal becomes stale when its Work revision changes", () => {
  const catalog = createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) {
        return "file-space:" + String(value).trim();
      },
      reason: "Trusted catalog reason.",
    }],
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    intelligence: intelligence(),
    actionCatalog: catalog,
  });
  const work = runtime.create("Work revision proof");
  const proposal = runtime.proposeAvailableAction(
    work.id,
    "native-file.ensure-directory",
    {
      resourceValue: "/Revision",
      rationale: "Proposal before Work state changes.",
    },
  );

  runtime.pause(work.id);
  assert.throws(
    () => runtime.requestProposedAction(proposal),
    /Work revision is stale/,
  );
  assert.equal(runtime.getSnapshot().approvals.length, 0);

  runtime.dispose();
});


test("Native model proposal cannot survive an A -> B -> A owner round trip", async () => {
  let current = { state: "signed-in", subjectId: "user-a", displayName: "A" };
  const listeners = new Set();
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    switchTo(subjectId) {
      current = { state: "signed-in", subjectId, displayName: subjectId };
      for (const listener of [...listeners]) listener(current);
    },
  };
  const catalog = createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) { return "file-space:" + String(value).trim(); },
      reason: "Trusted catalog approval reason.",
    }],
  });
  let complete;
  const intelligence = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "ready", inferenceAvailable: true,
      engineId: "llama.cpp", modelId: "qwen-test",
      authority: "none", toolExecution: false,
    }),
    subscribe() { return () => {}; },
    respond() {
      return new Promise((resolve) => {
        complete = () => resolve({
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: JSON.stringify({
            kind: "proposal",
            entryId: "native-file.ensure-directory",
            resourceValue: "/Relatorios",
            rationale: "Criar diretório para arquivos.",
          }),
          engineId: "llama.cpp", modelId: "qwen-test", authority: "none",
        });
      });
    },
  };
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    intelligence,
    actionCatalog: catalog,
  });
  try {
    const work = runtime.create("Crie uma pasta para relatórios");
    const issued = runtime.proposeAvailableAction(work.id, "native-file.ensure-directory", {
      resourceValue: "/Relatorios", rationale: "Preparar pasta",
    });
    const pending = runtime.proposeActionForWork(work.id);
    identity.switchTo("user-b");
    identity.switchTo("user-a");
    complete();
    await assert.rejects(pending, /owner or context changed/);
    assert.throws(() => runtime.requestProposedAction(issued), /owner or context/);
    assert.equal(runtime.getSnapshot().approvals.length, 0);
  } finally {
    runtime.dispose();
  }
});
