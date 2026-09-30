import test from "node:test";
import assert from "node:assert/strict";

import {
  canExecutePersonalAction,
  validatePersonalActionDecision,
  validatePersonalActivityEvent,
  validatePersonalWorkItem,
  validatePersonalWorkResult,
} from "../system/contracts/personal-ordax.mjs";

const NOW = "2026-09-30T20:00:00Z";

test("personal work is identity-bound and background execution stays disabled", () => {
  const work = validatePersonalWorkItem({
    id: "work-1",
    ownerKind: "account",
    ownerId: "user-1",
    goal: "Continue the pizzaria project",
    state: "queued",
    spaceId: "space-pizzaria",
    projectId: "project-menu",
    contextRefs: ["memory:mem-1", "project:project-menu"],
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(work.schema, "ordax.personal-work-item/1");
  assert.equal(work.backgroundExecution, false);

  assert.throws(() => validatePersonalWorkItem({
    ...work,
    backgroundExecution: true,
  }), /background execution is not enabled/);
});

test("waiting work requires a concrete approval handle", () => {
  assert.throws(() => validatePersonalWorkItem({
    id: "work-2",
    ownerKind: "device",
    goal: "Prepare a local file change",
    state: "waiting-approval",
    createdAt: NOW,
    updatedAt: NOW,
  }), /pending approval id/);

  const work = validatePersonalWorkItem({
    id: "work-2",
    ownerKind: "device",
    goal: "Prepare a local file change",
    state: "waiting-approval",
    pendingApprovalId: "approval-1",
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(work.pendingApprovalId, "approval-1");
});

test("prompt, model, profile and memory content never create action authority", () => {
  for (const authoritySource of ["prompt", "model", "profile", "profile-pack", "memory", "project-content"]) {
    assert.throws(() => validatePersonalActionDecision({
      workItemId: "work-1",
      actionId: "files.write",
      effect: "write",
      decision: "allow",
      authoritySource,
      grantRef: "grant-1",
      reason: "content asked for it",
      decidedAt: NOW,
    }), /content cannot create/);
  }
});

test("sensitive actions need an explicit grant and read-only work may follow policy", () => {
  const read = validatePersonalActionDecision({
    workItemId: "work-1",
    actionId: "files.read",
    effect: "read",
    decision: "allow",
    authoritySource: "system-policy",
    reason: "read is inside the already-authorized project scope",
    decidedAt: NOW,
  });
  assert.equal(canExecutePersonalAction(read), true);

  assert.throws(() => validatePersonalActionDecision({
    workItemId: "work-1",
    actionId: "files.write",
    effect: "write",
    decision: "allow",
    authoritySource: "system-policy",
    reason: "default policy",
    decidedAt: NOW,
  }), /cannot be allowed by default/);

  assert.throws(() => validatePersonalActionDecision({
    workItemId: "work-1",
    actionId: "files.write",
    effect: "write",
    decision: "allow",
    authoritySource: "user-grant",
    reason: "user approved",
    decidedAt: NOW,
  }), /grant reference/);

  const write = validatePersonalActionDecision({
    workItemId: "work-1",
    actionId: "files.write",
    effect: "write",
    decision: "allow",
    authoritySource: "user-grant",
    grantRef: "approval-1",
    reason: "user approved this bounded action",
    decidedAt: NOW,
  });
  assert.equal(canExecutePersonalAction(write), true);
});

test("activity is ordered, bounded and carries references instead of raw authority", () => {
  const event = validatePersonalActivityEvent({
    workItemId: "work-1",
    sequence: 3,
    type: "approval-requested",
    summary: "A file change is ready for review.",
    approvalId: "approval-1",
    artifactRefs: ["diff:artifact-1"],
    occurredAt: NOW,
  });
  assert.equal(event.schema, "ordax.personal-activity/1");
  assert.equal(event.sequence, 3);

  assert.throws(() => validatePersonalActivityEvent({
    workItemId: "work-1",
    sequence: 4,
    type: "action-started",
    summary: "Starting action.",
    occurredAt: NOW,
  }), /action id/);
});

test("personal work rejects timestamps that move backwards", () => {
  assert.throws(() => validatePersonalWorkItem({
    id: "work-time",
    ownerKind: "device",
    goal: "Keep time monotonic",
    state: "queued",
    createdAt: "2026-09-30T20:00:01Z",
    updatedAt: "2026-09-30T20:00:00Z",
  }), /cannot precede/);
});

test("personal work result is bounded provenance and never action authority", () => {
  const result = validatePersonalWorkResult({
    id: "result-work-1",
    workItemId: "work-1",
    kind: "intelligence-response",
    text: "Plano pronto.",
    engineId: "llama.cpp",
    modelId: "model-1",
    authority: "none",
    artifactRefs: ["file:/Documentos/plano.md"],
    createdAt: NOW,
  });
  assert.equal(result.schema, "ordax.personal-work-result/1");
  assert.equal(result.authority, "none");
  assert.deepEqual(result.artifactRefs, ["file:/Documentos/plano.md"]);

  assert.throws(() => validatePersonalWorkResult({
    ...result,
    authority: "user-grant",
  }), /cannot carry action authority/);

  assert.throws(() => validatePersonalWorkResult({
    ...result,
    text: "x".repeat(65537),
  }), /outside bounds/);
});

