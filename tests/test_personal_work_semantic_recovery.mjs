import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  IDENTITY_SESSION_SCHEMA,
} from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import {
  PERSONAL_WORK_RECOVERY_SUGGESTION_SCHEMA,
} from "../system/contracts/personal-work-recovery-suggestion.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { createPersonalWorkRecoveryPlanner } from "../system/services/personal-ordax/work-recovery.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function work(id, goal, state = "paused") {
  return {
    schema: "ordax.personal-work-item/1",
    id,
    ownerKind: "account",
    ownerId: "user-secret-id",
    goal,
    state,
    spaceId: "space-secret-id",
    projectId: "project-secret-id",
    pendingApprovalId: null,
    backgroundExecution: false,
    contextRefs: ["space:space-secret-id", "project:project-secret-id"],
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };
}

function intelligence(responseFactory) {
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
          modelId: "qwen-test",
          authority: "none",
          toolExecution: false,
        };
      },
      subscribe() { return () => {}; },
      async respond(request) {
        requests.push(request);
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: responseFactory(request),
          engineId: "llama.cpp",
          modelId: "qwen-test",
          authority: "none",
        };
      },
    },
  };
}

function signedOutIdentity() {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-out", subjectId: null, displayName: null };
    },
    subscribe() { return () => {}; },
  };
}

test("semantic recovery exposes only bounded current-owner Work descriptors", async () => {
  const ai = intelligence(() => JSON.stringify({
    kind: "match",
    workItemId: "personal-work-7",
    rationale: "O objetivo menciona a pizzaria.",
  }));
  const planner = createPersonalWorkRecoveryPlanner({ intelligencePort: ai.port });
  const suggestion = await planner.suggest(
    "continue o projeto da pizzaria",
    [work("personal-work-7", "Finalizar catálogo da pizzaria")],
  );

  assert.equal(suggestion.schema, PERSONAL_WORK_RECOVERY_SUGGESTION_SCHEMA);
  assert.equal(suggestion.authority, "none");
  assert.equal(suggestion.automaticResumeAuthorized, false);
  assert.equal(suggestion.contextSwitchAuthorized, false);
  assert.equal(ai.requests.length, 1);
  const prompt = ai.requests[0].prompt;
  assert.match(prompt, /personal-work-7/);
  assert.match(prompt, /Finalizar catálogo da pizzaria/);
  assert.match(prompt, /"spaceBound":true/);
  assert.match(prompt, /"projectBound":true/);
  assert.doesNotMatch(prompt, /user-secret-id|space-secret-id|project-secret-id/);
});

test("semantic recovery rejects unknown candidates and smuggled authority", async () => {
  for (const payload of [
    { kind: "match", workItemId: "missing", rationale: "x" },
    { kind: "match", workItemId: "personal-work-7", rationale: "x", contextSwitchAuthorized: true },
  ]) {
    const ai = intelligence(() => JSON.stringify(payload));
    const planner = createPersonalWorkRecoveryPlanner({ intelligencePort: ai.port });
    await assert.rejects(
      () => planner.suggest("continue a pizzaria", [work("personal-work-7", "Pizzaria")]),
      /unknown candidate|undeclared/,
    );
  }
});

test("issued Work recovery suggestion is runtime-local and clone cannot be accepted", async () => {
  const ai = intelligence(() => JSON.stringify({
    kind: "match",
    workItemId: "personal-work-1",
    rationale: "Este Work corresponde ao pedido.",
  }));
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: signedOutIdentity(),
    intelligence: ai.port,
  });
  const created = runtime.create("Continuar catálogo da pizzaria");
  const suggestion = await runtime.recoverWorkForRequest("continue o projeto da pizzaria");

  assert.equal(suggestion.workItemId, created.id);
  assert.equal(runtime.getSnapshot().workItems[0].state, "queued");
  assert.throws(
    () => runtime.acceptRecoveredWork({ ...suggestion }),
    /binding is unavailable/,
  );
  const accepted = runtime.acceptRecoveredWork(suggestion);
  assert.equal(accepted.id, created.id);
  assert.equal(runtime.getSnapshot().workItems[0].state, "queued");
  runtime.dispose();
});

test("issued Work recovery suggestion becomes stale when the Work revision changes", async () => {
  const ai = intelligence(() => JSON.stringify({
    kind: "match",
    workItemId: "personal-work-1",
    rationale: "Match before the Work changes.",
  }));
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: signedOutIdentity(),
    intelligence: ai.port,
  });
  const created = runtime.create("Pizzaria revision proof");
  const suggestion = await runtime.recoverWorkForRequest("continue pizzaria");

  runtime.pause(created.id);
  assert.throws(
    () => runtime.acceptRecoveredWork(suggestion),
    /stale/,
  );
  assert.equal(runtime.getSnapshot().workItems[0].state, "paused");
  runtime.dispose();
});


test("issued Work recovery suggestion cannot cross owner partitions", async () => {
  const listeners = new Set();
  let snapshot = { state: "signed-in", subjectId: "user-a", displayName: "A" };
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const switchOwner = (subjectId) => {
    snapshot = { state: "signed-in", subjectId, displayName: subjectId };
    for (const listener of [...listeners]) listener(snapshot);
  };
  const ai = intelligence(() => JSON.stringify({
    kind: "match",
    workItemId: "personal-work-1",
    rationale: "Owner A match.",
  }));
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    intelligence: ai.port,
  });
  runtime.create("Pizzaria owner A");
  const suggestion = await runtime.recoverWorkForRequest("continue pizzaria");
  switchOwner("user-b");
  runtime.create("Pizzaria owner B");

  assert.throws(
    () => runtime.acceptRecoveredWork(suggestion),
    /different owner/,
  );
  assert.equal(runtime.getSnapshot().ownerId, "user-b");
  runtime.dispose();
});

test("recovery acceptance delegates paused resume to canonical runtime instead of switching context", async () => {
  const source = await readFile(
    new URL("../system/composition/native/personal-ordax.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /work\.state === "paused"[\s\S]*?runtime\.resume\(work\.id\)/);
  assert.doesNotMatch(
    source,
    /acceptRecoveredWork[\s\S]{0,1600}(selectSpace|setSelectedSpace|selectProject|setProject|spaceSelection\.)/,
  );
});


test("issued Work recovery cannot be reused after A -> B -> A owner round trip", async () => {
  const listeners = new Set();
  let snapshot = { state: "signed-in", subjectId: "user-a", displayName: "A" };
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const switchTo = (subjectId) => {
    snapshot = { state: "signed-in", subjectId, displayName: subjectId };
    for (const listener of [...listeners]) listener(snapshot);
  };
  const ai = intelligence(() => JSON.stringify({
    kind: "match", workItemId: "personal-work-1", rationale: "Work A",
  }));
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    intelligence: ai.port,
  });
  try {
    const workA = runtime.create("Continue o trabalho da pizzaria");
    const suggestion = await runtime.recoverWorkForRequest("continue pizzaria");
    assert.equal(suggestion.workItemId, workA.id);
    switchTo("user-b");
    switchTo("user-a");
    assert.throws(() => runtime.acceptRecoveredWork(suggestion), /owner or context/);
    assert.equal(runtime.getSnapshot().ownerId, "user-a");
  } finally {
    runtime.dispose();
  }
});

test("pending recovery inference A -> B -> A cannot be accepted on return to A", async () => {
  const listeners = new Set();
  let snapshot = { state: "signed-in", subjectId: "user-a", displayName: "A" };
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const switchTo = (subjectId) => {
    snapshot = { state: "signed-in", subjectId, displayName: subjectId };
    for (const listener of [...listeners]) listener(snapshot);
  };
  let resolveInference;
  const ai = intelligence(() => "{}");
  ai.port.respond = () => new Promise((resolve) => {
    resolveInference = () => resolve({
      schema: INTELLIGENCE_RESPONSE_SCHEMA,
      text: JSON.stringify({
        kind: "match", workItemId: "personal-work-1", rationale: "Late match for A",
      }),
      engineId: "llama.cpp", modelId: "qwen-test", authority: "none",
    });
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identity,
    intelligence: ai.port,
  });
  try {
    runtime.create("Continue trabalho de A");
    const pending = runtime.recoverWorkForRequest("continue trabalho");
    switchTo("user-b");
    switchTo("user-a");
    resolveInference();
    await assert.rejects(pending, /owner or context changed/);
  } finally {
    runtime.dispose();
  }
});
