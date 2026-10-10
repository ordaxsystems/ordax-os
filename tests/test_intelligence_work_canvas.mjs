import assert from "node:assert/strict";
import test from "node:test";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { INTELLIGENCE_PORT_SCHEMA, INTELLIGENCE_RESPONSE_SCHEMA } from "../system/contracts/intelligence.mjs";
import { projectPersonalActivitySnapshot } from "../system/apps/activity/view-model.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";
import {
  INTELLIGENCE_WORK_CANVAS_SCHEMA,
  projectPersonalWorkCanvas,
} from "../system/services/intelligence/work-canvas.mjs";

const at = (minute) => new Date(Date.UTC(2026, 9, 10, 0, minute)).toISOString();
const scope = Object.freeze({
  ownerKind: "account",
  ownerId: "owner-a",
  spaceId: "space-a",
  projectId: "project-a",
  workItemId: "work-a",
});

function fixture({
  state = "completed",
  withResult = true,
  withEvents = true,
  attemptStatus = null,
  workId = "work-a",
  text = "Resposta real do modelo",
} = {}) {
  const work = {
    id: workId, ownerKind: "account", ownerId: "owner-a",
    goal: "Criar plano", state, spaceId: "space-a", projectId: "project-a",
    pendingApprovalId: state === "waiting-approval" ? "approval-a" : null,
    backgroundExecution: false, contextRefs: [],
    createdAt: at(0), updatedAt: at(6),
  };
  const activities = [
    { workItemId: workId, sequence: 1, type: "queued", summary: "Recebida",
      occurredAt: at(0), artifactRefs: [] },
    { workItemId: workId, sequence: 2, type: "started", summary: "Iniciada",
      occurredAt: at(1), artifactRefs: [] },
  ];
  const event = (type, summary, minute, metadata = {}) => activities.push({
    workItemId: workId, sequence: activities.length + 1, type, summary,
    occurredAt: at(minute), artifactRefs: [], ...metadata,
  });
  if (state === "waiting-approval" || attemptStatus !== null) {
    event("approval-requested", "Aprovação solicitada", 2, { approvalId: "approval-a" });
  } else {
    event(state === "completed" ? "completed" : state === "failed" ? "failed" : "progress",
      "Estado confirmado", 3);
  }
  if (attemptStatus !== null) {
    event("approval-resolved", "Aprovação concedida", 3, { approvalId: "approval-a" });
    event("action-started", "Execução iniciada", 4,
      { approvalId: "approval-a", actionId: "action-a" });
    event("action-finished", "Resultado não confirmado", 5,
      { approvalId: "approval-a", actionId: "action-a" });
  }
  const results = withResult && state === "completed" ? [{
    id: "result-a", workItemId: workId, kind: "intelligence-response",
    text, engineId: "llama.cpp", modelId: "model-a", authority: "none",
    artifactRefs: ["file:private-ref"], createdAt: at(4),
  }] : [];
  const approvals = state === "waiting-approval" || attemptStatus !== null ? [{
    id: "approval-a", workItemId: workId, actionId: "action-a",
    toolId: "tool-a", toolArtifactSha256: "a".repeat(64),
    effect: attemptStatus === null ? "write" : "read",
    resourceRef: attemptStatus === null ? "file:authorized" : null,
    status: attemptStatus === null ? "pending" : "approved",
    reason: "Precisa de aprovação", grantRef: null,
    requestedAt: at(2), resolvedAt: attemptStatus === null ? null : at(3),
    executedAt: null,
  }] : [];
  const decisions = attemptStatus === null ? [] : [{
    workItemId: workId, approvalId: "approval-a", actionId: "action-a",
    effect: "read", decision: "allow", authoritySource: "system-policy",
    grantRef: null, reason: "Leitura permitida", decidedAt: at(3),
  }];
  const attempts = attemptStatus === null ? [] : [{
    id: "attempt-a", workItemId: workId, approvalId: "approval-a",
    actionId: "action-a", toolId: "tool-a",
    toolArtifactSha256: "a".repeat(64), effect: "read",
    resourceRef: null, grantRef: null, status: attemptStatus,
    summary: "Execução não confirmada", artifactRefs: [],
    startedAt: at(4), finishedAt: at(5),
  }];
  if (!withEvents) activities.length = 0;
  return {
    schema: "ordax.personal-runtime/1", persistence: "session",
    ownerKind: "account", ownerId: "owner-a", nextOrdinal: 1,
    workItems: [work], activities, results, approvals, decisions, attempts,
  };
}

test("canonical Work → Activity/Result becomes bounded plain-text canvas with exact provenance", () => {
  const projected = projectPersonalWorkCanvas(fixture(), scope);
  assert.equal(projected.schema, INTELLIGENCE_WORK_CANVAS_SCHEMA);
  assert.equal(projected.state, "result");
  assert.equal(projected.workState, "completed");
  assert.equal(projected.resultId, "result-a");
  assert.equal(projected.requestId, null);
  assert.equal(projected.blocks.length, 1);
  assert.deepEqual(projected.blocks[0], {
    kind: "text", text: "Resposta real do modelo",
    sourceSchema: "ordax.personal-work-result/1", resultId: "result-a",
  });
  assert.deepEqual(projected.steps.map((entry) => entry.type), ["queued", "started", "completed"]);
  assert.equal(projected.provenance.modelId, "model-a");
  assert.equal(projected.completionPercent, null);
  assert.equal(projected.authority, "none");
  assert.equal(projected.toolExecution, false);
  const activity = projectPersonalActivitySnapshot(fixture());
  assert.equal(activity.work[0].canvas.resultId, "result-a");
  assert.equal(activity.work[0].canvas.blocks[0].text, "Resposta real do modelo");
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.blocks[0]), true);
  assert.equal("artifactRefs" in projected.blocks[0], false);
});

test("absence of backend, missing result or future schema never invent success", () => {
  assert.equal(projectPersonalWorkCanvas(null, scope).state, "unavailable");
  assert.equal(projectPersonalWorkCanvas(fixture({ withResult: false }), scope).state, "unavailable");
  assert.equal(projectPersonalWorkCanvas(null, { ...scope, workItemId: null }).state, "idle");
  assert.throws(() => projectPersonalWorkCanvas({ ...fixture(), schema: "unknown/2" }, scope), /schema/);
  assert.throws(() => projectPersonalWorkCanvas(fixture({ text: "x".repeat(65537) }), scope), /bounds/);
  assert.throws(() => projectPersonalWorkCanvas({
    ...fixture(), results: [{ ...fixture().results[0], workItemId: "other" }],
  }, scope), /missing work/);
});

test("owner, Space, project and work item must all match; stale snapshots never cross context", () => {
  for (const altered of [
    { ...scope, ownerId: "owner-b" }, { ...scope, spaceId: "space-b" },
    { ...scope, projectId: "project-b" }, { ...scope, workItemId: "work-b" },
  ]) {
    const view = projectPersonalWorkCanvas(fixture(), altered);
    assert.equal(view.state, "unavailable");
    assert.deepEqual(view.steps, []);
    assert.deepEqual(view.blocks, []);
  }
  const previous = fixture();
  assert.equal(projectPersonalWorkCanvas(previous, scope).state, "result");
  assert.equal(projectPersonalWorkCanvas(previous, { ...scope, ownerId: "owner-b" }).state, "unavailable");
  assert.equal(projectPersonalWorkCanvas(previous, { ...scope, ownerId: "owner-a" }).state, "result");
  assert.throws(() => projectPersonalWorkCanvas(previous, { ...scope, spaceId: undefined }), /bounds/);
  assert.throws(() => projectPersonalWorkCanvas(previous, { ownerKind: "account" }), /missing/);
});

test("only existing receipt-backed lifecycle events are shown: paused, failed, approval and uncertain", () => {
  const approval = projectPersonalWorkCanvas(fixture({ state: "waiting-approval" }), scope);
  assert.equal(approval.state, "requires-action");
  assert.equal(approval.blocks.length, 0);
  const paused = projectPersonalWorkCanvas(fixture({ state: "paused" }), scope);
  assert.equal(paused.state, "working");
  assert.equal(paused.workState, "paused");
  const failed = projectPersonalWorkCanvas(fixture({ state: "failed" }), scope);
  assert.equal(failed.state, "failed");
  const uncertain = projectPersonalWorkCanvas(fixture({ state: "paused", attemptStatus: "uncertain" }), scope);
  assert.equal(uncertain.state, "requires-action");
  assert.equal(uncertain.blocks.length, 0);
  assert.equal(uncertain.resultId, null);
});

test("duplicates and out-of-order events fail closed using Personal OrdaX store invariants", () => {
  const base = fixture();
  const repeated = { ...base, activities: [...base.activities, base.activities[0]] };
  assert.throws(() => projectPersonalWorkCanvas(repeated, scope), /sequence/);
  const rogue = { ...base, activities: [{ ...base.activities[0], workItemId: "work-b" }] };
  assert.throws(() => projectPersonalWorkCanvas(rogue, scope), /missing work/);
});

test("untrusted model-markup is only plain text; no HTML, URL or chart source is promoted", () => {
  const sourceText = "<script>alert('x')</script> https://forbidden.invalid";
  const projected = projectPersonalWorkCanvas(fixture({ text: sourceText }), scope);
  assert.equal(projected.blocks[0].kind, "text");
  assert.equal(projected.blocks[0].text, sourceText);
  assert.equal("html" in projected.blocks[0], false);
  assert.equal("url" in projected.blocks[0], false);
});

test("real Personal OrdaX runtime lifecycle feeds canvas without a second work store", async () => {
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => ({ state: "signed-out", subjectId: null, displayName: null }),
    subscribe: () => () => {},
  };
  const intelligence = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA, state: "ready", inferenceAvailable: true,
      engineId: "llama.cpp", modelId: "verified", authority: "none", toolExecution: false,
    }),
    subscribe: () => () => {},
    async respond() {
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA, text: "Plano validado",
        engineId: "llama.cpp", modelId: "verified", authority: "none",
      };
    },
  };
  let tick = 10_000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identity, intelligencePort: intelligence, now: () => tick++,
  });
  try {
    const work = runtime.create("Planejar");
    const deviceScope = {
      ownerKind: "device", ownerId: null, spaceId: null, projectId: null, workItemId: work.id,
    };
    assert.equal(projectPersonalWorkCanvas(runtime.getSnapshot(), deviceScope).state, "working");
    await runtime.run(work.id);
    const completed = projectPersonalWorkCanvas(runtime.getSnapshot(), deviceScope);
    assert.equal(completed.state, "result");
    assert.equal(completed.blocks[0].text, "Plano validado");
    assert.deepEqual(completed.steps.map((step) => step.type), ["queued", "started", "completed"]);
  } finally {
    runtime.dispose();
  }
});
