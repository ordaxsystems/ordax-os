import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  projectAssistantWorkStrip,
  ASSISTANT_WORK_STRIP_SCHEMA,
} from "../system/apps/assistant/ui/work-strip.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

const identity = (state = "signed-out", subjectId = null) => ({
  state, subjectId, displayName: state === "signed-in" ? "Conta" : null,
});
const unavailableSpace = () => ({
  schema: "ordax.space-selection/1", state: "unavailable",
  subjectId: null, selectedSpace: null,
});
const selectedSpace = (id = "space-a", subjectId = "owner-a") => ({
  schema: "ordax.space-selection/1", state: "selected", subjectId,
  selectedSpace: {
    id, name: "Empresa", kind: "professional", ownerId: subjectId,
    profilePack: "pizzaria-br", state: "active",
  },
});

function port(schema, initial, extra = {}) {
  let value = initial;
  const listeners = new Set();
  return {
    schema, getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    ...extra,
  };
}

function model() {
  return {
    schema: "ordax.intelligence/1",
    getSnapshot() {
      return {
        schema: "ordax.intelligence/1", state: "ready",
        inferenceAvailable: true, engineId: "llama.cpp", modelId: "verified",
        authority: "none", toolExecution: false,
      };
    },
    subscribe() { return () => {}; },
    async respond() {
      return {
        schema: "ordax.intelligence-response/1", text: "Plano registrado",
        engineId: "llama.cpp", modelId: "verified", authority: "none",
      };
    },
  };
}

test("Personal OrdaX device Work appears only from verified runtime Activity and Result", async () => {
  const id = port("ordax.identity-session/1", identity());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: model(),
    now: (() => { let t = 10000; return () => t++; })(),
  });
  try {
    const initial = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(initial.schema, ASSISTANT_WORK_STRIP_SCHEMA);
    assert.deepEqual(initial.cards, []);
    const work = runtime.create("Organizar arquivo autorizado");
    const queued = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(queued.cards.length, 1);
    assert.equal(queued.cards[0].state, "working");
    assert.deepEqual(queued.cards[0].steps.map(step => step.type), ["queued"]);
    assert.equal(queued.cards[0].completionPercent, null);
    assert.equal(queued.cards[0].result, null);
    await runtime.run(work.id);
    const completed = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(completed.cards[0].state, "result");
    assert.equal(completed.cards[0].result.text, "Plano registrado");
    assert.deepEqual(completed.cards[0].steps.map(step => step.type), ["queued", "started", "completed"]);
    assert.equal(completed.cards[0].authority, "none");
    assert.equal(Object.isFrozen(completed.cards), true);
  } finally {
    runtime.dispose();
  }
});

test("account and Space fences hide foreign and stale work without retaining a cached result", () => {
  const idPort = port("ordax.identity-session/1", identity("signed-in", "owner-a"));
  const selection = port("ordax.space-selection/1", selectedSpace(),
    { select() {}, clear() {} });
  let tick = 10000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: idPort, spaceSelectionPort: selection, now: () => tick++,
  });
  try {
    runtime.create("Trabalho da empresa", { spaceId: "space-a" });
    const same = projectAssistantWorkStrip(runtime.getSnapshot(),
      idPort.getSnapshot(), selection.getSnapshot());
    assert.equal(same.cards.length, 1);
    assert.equal(same.cards[0].spaceId, "space-a");
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      identity("signed-in", "owner-b"), selection.getSnapshot()).cards, []);
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      idPort.getSnapshot(), selectedSpace("space-b")).cards, []);
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      idPort.getSnapshot(), unavailableSpace()).cards, []);
  } finally {
    runtime.dispose();
  }
});

test("unavailable identity, missing runtime, mixed scope and unsupported schema fail closed", () => {
  assert.deepEqual(projectAssistantWorkStrip(null, identity(), unavailableSpace()).cards, []);
  assert.deepEqual(projectAssistantWorkStrip(null, null, null).cards, []);
  assert.throws(() => projectAssistantWorkStrip({
    schema: "unknown/2",
  }, identity(), unavailableSpace()), /schema/);
  const id = port("ordax.identity-session/1", identity());
  const runtime = createPersonalOrdaxRuntime({ identitySessionPort: id });
  try {
    runtime.create("Dispositivo");
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      identity("signed-in", "owner-a"), selectedSpace()).cards, []);
  } finally {
    runtime.dispose();
  }
});

test("Native Assistant reads the existing Personal runtime; UI never executes mission or grants", async () => {
  const [native, runtime, ui] = await Promise.all([
    readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/apps/assistant/runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(native, /personalOrdax,\s*identitySessionPort: identitySession/);
  assert.match(runtime, /personalOrdax,\s*identitySessionPort,/);
  assert.match(ui, /projectAssistantWorkStrip\(/);
  assert.match(ui, /personalOrdax\.getSnapshot\(\)/);
  assert.match(ui, /personalOrdax\?\.subscribe\?\.\(\(\) => render\(\)\)/);
  assert.doesNotMatch(ui, /personalOrdax\.run\(|personalOrdax\.create\(|personalOrdax\.approve\(/);
});


test("real pending approval outranks newer completed responses without changing Work authority", async () => {
  const id = port("ordax.identity-session/1", identity());
  let tick = 20000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: model(),
    now: () => tick++,
  });
  try {
    const urgent = runtime.create("Solicitação de autorização");
    const approval = runtime.requestApproval(urgent.id, {
      actionId: "device.file.read", toolId: "native-file-reader",
      toolArtifactSha256: "a".repeat(64), effect: "read",
      reason: "Ação requer aprovação explícita",
    });
    assert.equal(approval.status, "pending");
    for (let i = 0; i < 3; i += 1) {
      const item = runtime.create(`Resultado posterior ${i}`);
      await runtime.run(item.id);
    }
    const view = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(view.cards.length, 3);
    assert.equal(view.cards[0].workItemId, urgent.id);
    assert.equal(view.cards[0].state, "requires-action");
    assert.equal(view.cards[0].result, null);
    assert.equal(view.cards[0].resultId, null);
    assert.deepEqual(view.cards[0].actionEvidence, []);
    assert.equal(view.cards[0].pendingApproval.sourceSchema, "ordax.personal-approval/1");
    assert.equal(view.cards[0].pendingApproval.reason, "Ação requer aprovação explícita");
    assert.equal("grantRef" in view.cards[0].pendingApproval, false);
    assert.equal("resourceRef" in view.cards[0].pendingApproval, false);
    assert.deepEqual(view.cards[0].steps.map(event => event.type),
      ["queued", "approval-requested"]);
    assert.equal(view.remainingCount, 1);
    assert.equal(view.cards[0].completionPercent, null);
    assert.equal(view.cards[0].authority, "none");
    const result = view.cards.find(card => card.state === "result");
    assert.ok(result);
    assert.equal(result.provenance.sourceSchema, "ordax.personal-work-result/1");
    assert.equal(result.provenance.engineId, "llama.cpp");
    assert.equal(result.result.resultId, result.resultId);
  } finally {
    runtime.dispose();
  }
});

test("bounded, read-only mission list reports hidden authenticated items instead of discarding them", () => {
  const id = port("ordax.identity-session/1", identity());
  let tick = 40000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, now: () => tick++,
  });
  try {
    for (let i = 0; i < 10; i += 1) runtime.create(`Missão registrada ${i}`);
    const view = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(view.cards.length, 3);
    assert.equal(view.remainingCount, 7);
    assert.equal(view.cards[0].goal, "Missão registrada 9");
    assert.ok(view.cards.every(card => card.state === "working"));
    assert.equal(Object.isFrozen(view.cards), true);
    assert.equal(Object.isFrozen(view), true);
    assert.deepEqual(projectAssistantWorkStrip(null, id.getSnapshot(), unavailableSpace()), {
      schema: ASSISTANT_WORK_STRIP_SCHEMA, cards: [], remainingCount: 0,
    });
  } finally {
    runtime.dispose();
  }
});

test("Canvas displays event timestamp, scoped provenance and prioritizes real Work without invoking actions", async () => {
  const ui = await readFile(
    new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8",
  );
  assert.match(ui, /const snapshot = conversation.getSnapshot\(\);/);
  assert.match(ui, /dataset\.assistantWorkDetails = work\.workItemId/);
  assert.match(ui, /when\.dateTime = event\.occurredAt/);
  assert.match(ui, /work\.provenance\.engineId/);
  assert.match(ui, /verifiedWork\.remainingCount > 0/);
  assert.match(ui, /textarea\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|personalOrdax\.run\(|personalOrdax\.approve\(/);
});


test("Action evidence table binds only trusted Personal Attempt status and never grants or arbitrary HTML", async () => {
  const source = await readFile(
    new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /work\.actionEvidence\.length > 0/);
  assert.match(source, /dataset\.assistantActionAttempt = entry\.attemptId/);
  assert.match(source, /entry\.finishedAt \?\? entry\.startedAt/);
  assert.match(source, /entry\.summary \?\? t\("assistant\.work\.actions\.noSummary"\)/);
  assert.match(source, /work\.pendingApproval\.reason/);
  assert.match(source, /pending\.dataset\.assistantPendingApproval = work\.pendingApproval\.approvalId/);
  assert.match(source, /th\.scope = "col"/);
  assert.doesNotMatch(source, /grantRef|resourceRef|toolArtifactSha256|innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source, /personalOrdax\.executeApprovedAction\(|personalOrdax\.resolveApproval\(/);
});
