import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { createNativePersonalOrdaxFileActions } from "../system/adapters/native/personal-ordax-file-actions.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";

const ACTION = "native-file.ensure-directory";
const PATH = "/Documentos/Relatorios";
const ARTIFACT_SHA = "c".repeat(64);

function storage() {
  const entries = new Map();
  return {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(String(key), String(value)); },
    removeItem(key) { entries.delete(String(key)); },
  };
}

function identity() {
  let current = { state: "signed-in", subjectId: "user-a", displayName: "Conta A" };
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() { return current; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    switchTo(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
  };
}

// An actual typed Native file-space adapter consumes this port. Only the
// OS boundary is in memory; no side effect is simulated by the AI or planner.
function boundedFileSpace() {
  const directoryByPath = new Map([["/Documentos", []]]);
  const mutations = [];
  return {
    mutations,
    port: {
      schema: FILE_SPACE_SCHEMA,
      async list(path = "/") {
        return { path, entries: [...(directoryByPath.get(path) ?? [])] };
      },
      async createDirectory(path, name) {
        mutations.push({ path, name });
        const entries = directoryByPath.get(path);
        if (!entries) throw new Error("Parent directory is not present");
        if (entries.some((entry) => entry.name === name)) {
          throw new Error("Directory was unexpectedly created twice");
        }
        entries.push({ name, kind: "directory", size: 0, modifiedAt: 1 });
        directoryByPath.set(path === "/" ? `/${name}` : `${path}/${name}`, []);
        return { path, entries: [...entries] };
      },
      async readTextFile() { throw new Error("not authorized"); },
      async renameEntry() { throw new Error("not authorized"); },
      async copyFile() { throw new Error("not authorized"); },
      async moveEntry() { throw new Error("not authorized"); },
      async trashEntry() { throw new Error("not authorized"); },
      async listTrash() { throw new Error("not authorized"); },
      async restoreTrashEntry() { throw new Error("not authorized"); },
      async exportFile() { throw new Error("not authorized"); },
      async importFile() { throw new Error("not authorized"); },
    },
  };
}

function planningInference(answer) {
  const requests = [];
  return {
    requests,
    port: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot() {
        return {
          schema: INTELLIGENCE_PORT_SCHEMA,
          state: "ready",
          inferenceAvailable: true,
          engineId: "llama.cpp",
          modelId: "controlled-model-fixture",
          authority: "none",
          toolExecution: false,
        };
      },
      subscribe() { return () => {}; },
      async respond(request) {
        requests.push(request);
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: answer,
          engineId: "llama.cpp",
          modelId: "controlled-model-fixture",
          authority: "none",
        };
      },
    },
  };
}

function candidate(entryId = ACTION, resourceValue = PATH) {
  return JSON.stringify({
    kind: "proposal",
    entryId,
    resourceValue,
    rationale: "Organizar relatórios na pasta escolhida.",
  });
}

async function harness(answer = candidate()) {
  const files = boundedFileSpace();
  const account = identity();
  const ai = planningInference(answer);
  const actions = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace: files.port,
    artifactIdentity: async () => ARTIFACT_SHA,
  });
  const catalog = createPersonalActionCatalog({ registrations: actions.actionRegistrations });
  const personal = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: storage() },
    identitySession: account,
    intelligence: ai.port,
    toolResolver: actions.toolResolver,
    adapterResolver: actions.adapterResolver,
    actionCatalog: catalog,
  });
  return { personal, account, files, ai, actions };
}

test("natural-language Work -> model suggestion -> visible consent -> grant -> Native mutation -> receipt", async () => {
  const { personal, files, ai, actions } = await harness();
  try {
    const work = personal.create("Crie a pasta /Documentos/Relatorios para os relatórios.");
    const proposal = await personal.proposeActionForWork(work.id);

    assert.equal(proposal.entryId, ACTION);
    assert.equal(proposal.resourceValue, PATH);
    assert.equal(proposal.authority, "none");
    assert.equal(proposal.approvalRequested, false);
    assert.equal(proposal.executionAuthorized, false);
    assert.equal(ai.requests.length, 1);
    assert.equal(ai.requests[0].intent, "ask");
    assert.match(ai.requests[0].prompt, /allowedActions=/);
    assert.deepEqual(files.mutations, []);
    assert.deepEqual(personal.getSnapshot().approvals, []);
    assert.deepEqual(personal.getSnapshot().attempts, []);

    const pending = personal.requestProposedAction(proposal);
    assert.equal(pending.resourceRef, `file-space:${PATH}`);
    assert.equal(pending.toolArtifactSha256, actions.tool.artifactSha256);
    assert.equal(pending.status, "pending");
    assert.equal(personal.getSnapshot().workItems[0].state, "waiting-approval");
    assert.deepEqual(files.mutations, []);
    assert.equal(personal.canExecuteApprovedAction(work.id, pending.id), false);
    await assert.rejects(
      () => personal.executeApprovedAction(work.id, pending.id),
      /approved approval/,
    );

    assert.equal(personal.approvalConsent.canApprove(work.id, pending.id), true);
    const decision = personal.approvalConsent.approve(work.id, pending.id);
    assert.equal(decision.decision, "allow");
    assert.equal(decision.authoritySource, "intelligence-tool-grant");
    assert.ok(decision.grantRef);
    assert.deepEqual(files.mutations, []);

    const receipt = await personal.executeApprovedAction(work.id, pending.id);
    const current = personal.getSnapshot();
    assert.equal(receipt.status, "succeeded");
    assert.equal(receipt.resourceRef, `file-space:${PATH}`);
    assert.equal(receipt.toolArtifactSha256, actions.tool.artifactSha256);
    assert.equal(receipt.grantRef, decision.grantRef);
    assert.deepEqual(receipt.artifactRefs, [`file-space:${PATH}`]);
    assert.deepEqual(files.mutations, [{ path: "/Documentos", name: "Relatorios" }]);
    assert.equal(current.approvals[0].status, "executed");
    assert.ok(current.activities.some((event) => event.type === "action-started"));
    assert.equal(current.activities.at(-1).type, "action-finished");
    assert.equal(personal.canExecuteApprovedAction(work.id, pending.id), false);
    await assert.rejects(
      () => personal.executeApprovedAction(work.id, pending.id),
      /unconsumed approved approval/,
    );
    assert.equal(files.mutations.length, 1);
  } finally {
    personal.dispose();
  }
});

test("model suggestion followed by explicit human refusal never reaches file-space", async () => {
  const { personal, files } = await harness();
  try {
    const work = personal.create("Crie uma pasta para os meus relatórios.");
    const proposed = await personal.proposeActionForWork(work.id);
    const pending = personal.requestProposedAction(proposed);
    const decision = personal.approvalConsent.deny(work.id, pending.id);
    assert.equal(decision.decision, "deny");
    assert.equal(personal.getSnapshot().approvals[0].status, "denied");
    assert.deepEqual(files.mutations, []);
    assert.equal(personal.canExecuteApprovedAction(work.id, pending.id), false);
    await assert.rejects(
      () => personal.executeApprovedAction(work.id, pending.id),
      /approved approval/,
    );
    assert.deepEqual(files.mutations, []);
  } finally {
    personal.dispose();
  }
});

test("an invented app/tool proposal cannot create approvals, grants or effects", async () => {
  const { personal, files } = await harness(candidate("shell.execute", PATH));
  try {
    const work = personal.create("Faça a operação que você achar melhor.");
    await assert.rejects(
      () => personal.proposeActionForWork(work.id),
      /unavailable/,
    );
    const snapshot = personal.getSnapshot();
    assert.deepEqual(snapshot.approvals, []);
    assert.deepEqual(snapshot.decisions, []);
    assert.deepEqual(snapshot.attempts, []);
    assert.deepEqual(files.mutations, []);
  } finally {
    personal.dispose();
  }
});

test("changing account invalidates a previously issued model proposal before consent", async () => {
  const { personal, account, files } = await harness();
  try {
    const work = personal.create("Crie a pasta /Documentos/Relatorios.");
    const proposed = await personal.proposeActionForWork(work.id);
    account.switchTo({ state: "signed-in", subjectId: "user-b", displayName: "Conta B" });
    assert.throws(
      () => personal.requestProposedAction(proposed),
      /owner|current|unavailable/i,
    );
    assert.deepEqual(files.mutations, []);
    assert.deepEqual(personal.getSnapshot().approvals, []);
  } finally {
    personal.dispose();
  }
});
