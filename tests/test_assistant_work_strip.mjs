import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  projectAssistantWorkStrip,
  ASSISTANT_WORK_STRIP_SCHEMA,
} from "../system/apps/assistant/ui/work-strip.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";
import { PERSONAL_ORDAX_MAX_GOAL_CHARS } from "../system/contracts/personal-ordax.mjs";
import {
  canRecordAssistantWork,
  beginAssistantRecordedWork,
  openAssistantWorkInActivity,
} from "../system/apps/assistant/ui/conversation-controls.mjs";
import { createAppActivationChannel } from "../system/services/apps/activation.mjs";
import { activityApp } from "../system/apps/activity/app.mjs";

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


test("explicit Native Assistant analysis creates one real foreground Work with durable Activity/Result", async () => {
  const id = port("ordax.identity-session/1", identity());
  const space = port("ordax.space-selection/1", unavailableSpace());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: model(),
    now: (() => { let t = 80000; return () => t++; })(),
  });
  try {
    const conversation = { state: "ready" };
    assert.equal(canRecordAssistantWork(runtime, id, space, conversation, "  Planejar o dia  "), true);
    const action = beginAssistantRecordedWork(runtime, id, space, conversation, "  Planejar o dia  ");
    assert.equal(action.accepted, true);
    assert.equal(runtime.getSnapshot().workItems.length, 1);
    const queued = runtime.getSnapshot().workItems[0];
    assert.equal(queued.goal, "Planejar o dia");
    assert.equal(queued.ownerKind, "device");
    assert.equal(queued.spaceId, null);
    assert.equal(queued.projectId, null);
    assert.equal(queued.backgroundExecution, false);
    const response = await action.pending;
    assert.equal(response.text, "Plano registrado");
    const snapshot = runtime.getSnapshot();
    const work = snapshot.workItems[0];
    assert.equal(work.id, action.workItemId);
    assert.equal(work.state, "completed");
    assert.equal(snapshot.results[0].workItemId, work.id);
    assert.deepEqual(snapshot.activities.map(item => item.type), ["queued", "started", "completed"]);
    const canvas = projectAssistantWorkStrip(snapshot, id.getSnapshot(), space.getSnapshot());
    assert.equal(canvas.cards[0].result.text, "Plano registrado");
    assert.equal(canvas.cards[0].provenance.engineId, "llama.cpp");
    assert.equal(canvas.cards[0].completionPercent, null);
    assert.equal(canvas.cards[0].authority, "none");
  } finally {
    runtime.dispose();
  }
});

test("recorded Work follows active authenticated Space and never invents a project", async () => {
  const id = port("ordax.identity-session/1", identity("signed-in", "owner-a"));
  const space = port("ordax.space-selection/1", selectedSpace(), {
    select() {}, clear() {},
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, spaceSelectionPort: space, intelligencePort: model(),
    now: (() => { let t = 90000; return () => t++; })(),
  });
  try {
    const response = beginAssistantRecordedWork(runtime, id, space, { state: "ready" }, "Analisar dados do Space");
    assert.equal(response.accepted, true);
    const item = runtime.getSnapshot().workItems[0];
    assert.equal(item.ownerKind, "account");
    assert.equal(item.ownerId, "owner-a");
    assert.equal(item.spaceId, "space-a");
    assert.equal(item.projectId, null);
    await response.pending;
    assert.equal(projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(),
      selectedSpace("space-b")).cards.length, 0);
    space.setSnapshot(selectedSpace("space-b"));
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "ready" }, "Novo Space"), true);
    const next = beginAssistantRecordedWork(runtime, id, space, { state: "ready" }, "Novo Space");
    assert.equal(next.accepted, true);
    assert.equal(runtime.getSnapshot().workItems.at(-1).spaceId, "space-b");
    await next.pending;
  } finally {
    runtime.dispose();
  }
});

test("Work cannot be created from invalid owner, unavailable Space, busy model or oversized goal", () => {
  const id = port("ordax.identity-session/1", identity());
  const space = port("ordax.space-selection/1", unavailableSpace());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id,
    now: (() => { let t = 100000; return () => t++; })(),
  });
  try {
    assert.equal(canRecordAssistantWork(null, id, space, { state: "ready" }, "A"), false);
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "busy" }, "A"), false);
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "ready" }, "  "), false);
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "ready" },
      "a".repeat(PERSONAL_ORDAX_MAX_GOAL_CHARS + 1)), false);
    assert.deepEqual(beginAssistantRecordedWork(runtime, id, space, { state: "busy" }, "A"), {
      accepted: false, workItemId: null, pending: null,
    });
    id.setSnapshot(identity("signed-in", "owner-a"));
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "ready" }, "A"), false);
    space.setSnapshot({ schema: "ordax.space-selection/1", state: "unselected",
      subjectId: "owner-a", selectedSpace: null });
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "ready" }, "A"), true);
    const foreign = { ...runtime, getSnapshot: () => ({
      ...runtime.getSnapshot(), ownerKind: "device", ownerId: null,
    }) };
    assert.equal(canRecordAssistantWork(foreign, id, space, { state: "ready" }, "A"), false);
    assert.deepEqual(runtime.getSnapshot().workItems, []);
  } finally {
    runtime.dispose();
  }
});

test("recorded Work with unavailable inference remains a queued canonical item, never a fake result", async () => {
  const id = port("ordax.identity-session/1", identity());
  const space = port("ordax.space-selection/1", unavailableSpace());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id,
    now: (() => { let t = 110000; return () => t++; })(),
  });
  try {
    const action = beginAssistantRecordedWork(runtime, id, space, { state: "ready" }, "Analisar sem motor");
    assert.equal(action.accepted, true);
    await assert.rejects(action.pending, /Intelligence is unavailable/);
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.workItems[0].state, "queued");
    assert.deepEqual(snapshot.results, []);
    assert.deepEqual(snapshot.activities.map(x => x.type), ["queued"]);
  } finally {
    runtime.dispose();
  }
});

test("Native Assistant UI requires explicit Work CTA, retains chat Enter behavior and avoids tool invocation", async () => {
  const source = await readFile(
    new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /dataset\.assistantRecordWork = ""/);
  assert.match(source, /if \(target\.dataset\.assistantRecordWork !== undefined\)/);
  assert.match(source, /beginAssistantRecordedWork\(/);
  assert.match(source, /personal\.create\(draft\.trim\(\), \{ spaceId: scope\.spaceId, projectId: null \}\)/);
  assert.match(source, /personal\.run\(item\.id\)/);
  assert.match(source, /if \(event\.key === "Enter" && !event\.shiftKey\)/);
  assert.doesNotMatch(source, /executeApprovedAction\(|requestApproval\(|grantRef|resourceRef/);
});


test("owner switch during recorded reasoning cannot commit an old owner result into new Space", async () => {
  const id = port("ordax.identity-session/1", identity());
  const space = port("ordax.space-selection/1", unavailableSpace());
  let resolveResponse;
  const delayed = {
    ...model(),
    respond() {
      return new Promise((resolve) => { resolveResponse = resolve; });
    },
  };
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: delayed,
    now: (() => { let t = 120000; return () => t++; })(),
  });
  try {
    const action = beginAssistantRecordedWork(runtime, id, space, { state: "ready" }, "Análise interrompida");
    assert.equal(action.accepted, true);
    await Promise.resolve();
    assert.equal(runtime.getSnapshot().workItems[0].state, "running");
    id.setSnapshot(identity("signed-in", "owner-a"));
    assert.deepEqual(runtime.getSnapshot().workItems, []);
    assert.equal(canRecordAssistantWork(runtime, id, space, { state: "ready" }, "Outra tarefa"), false);
    resolveResponse({
      schema: "ordax.intelligence-response/1", text: "Resultado do owner anterior",
      engineId: "llama.cpp", modelId: "verified", authority: "none",
    });
    await assert.rejects(action.pending, /context changed/);
    assert.deepEqual(runtime.getSnapshot().results, []);
    assert.deepEqual(projectAssistantWorkStrip(
      runtime.getSnapshot(), id.getSnapshot(), space.getSnapshot()).cards, []);
  } finally {
    runtime.dispose();
  }
});


test("adaptive overview counts every scoped canonical Work, including items hidden by three-card limit", async () => {
  const id = port("ordax.identity-session/1", identity());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: model(),
    now: (() => { let n = 210000; return () => n++; })(),
  });
  try {
    const urgent = runtime.create("Esperando autorização");
    runtime.requestApproval(urgent.id, {
      actionId: "files.read", toolId: "file-reader",
      toolArtifactSha256: "c".repeat(64), effect: "read",
      reason: "Confirmação específica necessária",
    });
    const paused = runtime.create("Missão pausada");
    runtime.pause(paused.id);
    const cancelled = runtime.create("Missão cancelada");
    runtime.cancel(cancelled.id);
    for (let n = 0; n < 4; n++) {
      const work = runtime.create(`Resultado ${n}`);
      await runtime.run(work.id);
    }
    const pending = runtime.create("Ainda na fila");
    const view = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(view.cards.length, 3);
    assert.equal(view.remainingCount, 5);
    assert.deepEqual(view.overview, {
      sourceSchema: "ordax.personal-runtime/1",
      total: 8,
      groups: [
        { kind: "requires-action", count: 1 },
        { kind: "working", count: 2 },
        { kind: "result", count: 4 },
        { kind: "failed", count: 1 },
        { kind: "unavailable", count: 0 },
      ],
      completionPercent: null,
      authority: "none",
    });
    assert.equal(view.overview.groups.reduce((sum, group) => sum + group.count, 0), 8);
    assert.equal(view.cards[0].workItemId, urgent.id);
    assert.equal(view.cards[0].state, "requires-action");
    assert.ok(view.overview.groups.every(g => Number.isInteger(g.count) && g.count >= 0));
    assert.equal(Object.isFrozen(view.overview), true);
    assert.equal(Object.isFrozen(view.overview.groups), true);
    assert.ok(Object.isFrozen(view.overview.groups[0]));
    assert.equal(pending.projectId, null);
  } finally {
    runtime.dispose();
  }
});

test("owner and Space changes remove all overview data instead of retaining previous counts", async () => {
  const id = port("ordax.identity-session/1", identity("signed-in", "owner-a"));
  const selection = port("ordax.space-selection/1", selectedSpace(), {
    select() {}, clear() {},
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, spaceSelectionPort: selection,
    intelligencePort: model(), now: (() => { let n = 220000; return () => n++; })(),
  });
  try {
    runtime.create("Work em Space A", { spaceId: "space-a" });
    const one = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), selection.getSnapshot());
    assert.equal(one.overview.total, 1);
    assert.equal(one.overview.groups[1].count, 1);
    const otherSpace = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(),
      selectedSpace("space-b"));
    assert.equal(otherSpace.overview.total, 0);
    assert.deepEqual(otherSpace.overview.groups.map(g => g.count), [0, 0, 0, 0, 0]);
    const otherOwner = projectAssistantWorkStrip(runtime.getSnapshot(),
      identity("signed-in", "owner-b"), selection.getSnapshot());
    assert.deepEqual(otherOwner.cards, []);
    assert.equal(otherOwner.overview, undefined);
    const wrongContext = projectAssistantWorkStrip(runtime.getSnapshot(),
      id.getSnapshot(), unavailableSpace());
    assert.equal(wrongContext.overview, undefined);
    const malformed = {
      ...runtime.getSnapshot(),
      workItems: runtime.getSnapshot().workItems.map(w => ({ ...w, state: "fabricated" })),
    };
    assert.throws(() => projectAssistantWorkStrip(malformed,
      id.getSnapshot(), selection.getSnapshot()), /state/);
  } finally {
    runtime.dispose();
  }
});

test("missing Work Result cannot count as completed; unknown state fails closed", async () => {
  const id = port("ordax.identity-session/1", identity());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: model(),
    now: (() => { let n = 230000; return () => n++; })(),
  });
  try {
    const completed = runtime.create("Resposta registrada");
    await runtime.run(completed.id);
    const actual = runtime.getSnapshot();
    const withMissingResult = {
      ...actual,
      results: [],
      activities: actual.activities.map(activity =>
        activity.type === "completed" ? { ...activity, artifactRefs: [] } : activity),
    };
    const overview = projectAssistantWorkStrip(withMissingResult,
      id.getSnapshot(), unavailableSpace()).overview;
    assert.equal(overview.total, 1);
    assert.equal(overview.groups.find(g => g.kind === "result").count, 0);
    assert.equal(overview.groups.find(g => g.kind === "unavailable").count, 1);
    assert.equal(overview.completionPercent, null);
  } finally {
    runtime.dispose();
  }
});

test("adaptive chart uses canonical overview counts, semantic figure and source without interpreting prompt text", async () => {
  const source = await readFile(
    new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /overview\?\.total >= 2/);
  assert.match(source, /documentObject, "figure", "ordax-assistant-work-chart"/);
  assert.match(source, /documentObject, "figcaption"/);
  assert.match(source, /group\.count \/ overview\.total/);
  assert.match(source, /String\(group\.count\)/);
  assert.match(source, /track\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(source, /figure\.dataset\.assistantWorkSource = overview\.sourceSchema/);
  assert.doesNotMatch(source, /dataset\.assistantWorkPercentage/);
});

test("verified pending Work can request Activity navigation only through canonical activation", async () => {
  const id = port("ordax.identity-session/1", identity());
  const space = port("ordax.space-selection/1", unavailableSpace());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id,
    now: (() => { let t = 300000; return () => t++; })(),
  });
  const activation = createAppActivationChannel();
  const calls = [];
  const unsubscribe = activation.subscribe(event => calls.push(event));
  try {
    const waiting = runtime.create("Revisar permissão");
    runtime.requestApproval(waiting.id, {
      actionId: "files.read", toolId: "file-reader",
      toolArtifactSha256: "c".repeat(64), effect: "read",
      reason: "Leitura requer aprovação",
    });
    assert.equal(openAssistantWorkInActivity(runtime, id, space, activation, waiting.id), true);
    assert.deepEqual(calls, [{ appId: activityApp.id, target: null }]);
    assert.equal(runtime.getSnapshot().workItems[0].state, "waiting-approval");
    assert.equal(runtime.getSnapshot().approvals[0].status, "pending");
    assert.equal(runtime.getSnapshot().attempts.length, 0);
    assert.equal(runtime.getSnapshot().decisions.length, 0);
    assert.equal(openAssistantWorkInActivity(runtime, id, space, null, waiting.id), false);
    assert.equal(openAssistantWorkInActivity(runtime, id, space, activation, "missing"), false);
    assert.equal(openAssistantWorkInActivity(runtime, id, space,
      { schema: "ordax.app-activation/1", publish() {} }, waiting.id), false);
    assert.equal(calls.length, 1);
  } finally {
    unsubscribe();
    runtime.dispose();
  }
});

test("completed Work or mismatched Identity/Space cannot emit Activity activation", async () => {
  const id = port("ordax.identity-session/1", identity("signed-in", "owner-a"));
  const space = port("ordax.space-selection/1", selectedSpace(), {
    select() {}, clear() {},
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, spaceSelectionPort: space,
    intelligencePort: model(),
    now: (() => { let t = 310000; return () => t++; })(),
  });
  const activation = createAppActivationChannel();
  const calls = [];
  const unsubscribe = activation.subscribe(event => calls.push(event));
  try {
    const pending = runtime.create("Revisar na empresa", { spaceId: "space-a" });
    runtime.requestApproval(pending.id, {
      actionId: "files.read", toolId: "file-reader",
      toolArtifactSha256: "d".repeat(64), effect: "read",
      reason: "Verificação pendente",
    });
    assert.equal(openAssistantWorkInActivity(runtime, id, space, activation, pending.id), true);
    assert.equal(calls.length, 1);
    space.setSnapshot(selectedSpace("space-b"));
    assert.equal(openAssistantWorkInActivity(runtime, id, space, activation, pending.id), false);
    id.setSnapshot(identity("signed-in", "owner-b"));
    assert.equal(openAssistantWorkInActivity(runtime, id, space, activation, pending.id), false);
    assert.equal(calls.length, 1);
    // Current owner may have an unrelated completed Work; that is not an
    // approval and must never create an Activity action/navigation shortcut.
    space.setSnapshot(selectedSpace("space-b", "owner-b"));
    const finished = runtime.create("Finalizado", { spaceId: "space-b" });
    await runtime.run(finished.id);
    assert.equal(openAssistantWorkInActivity(runtime, id, space, activation, finished.id), false);
    assert.equal(calls.length, 1);
  } finally {
    unsubscribe();
    runtime.dispose();
  }
});

test("Activity review UI uses explicit click and only publishes navigation", async () => {
  const [ui, runtime, native] = await Promise.all([
    readFile(new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/apps/assistant/runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(native, /personalOrdax,\s*identitySessionPort: identitySession,[\s\S]*?appActivation,/);
  assert.match(runtime, /appActivation,\s*\}\)/);
  assert.match(ui, /work\.state === "requires-action"/);
  assert.match(ui, /dataset\.assistantReviewWork = work\.workItemId/);
  assert.match(ui, /target\.dataset\.assistantReviewWork !== undefined/);
  assert.match(ui, /channel\.publish\(\{ appId: activityApp\.id \}\)/);
  assert.doesNotMatch(ui, /approvalConsent\.approve\(|executeApprovedAction\(|resolveApproval\(/);
});
