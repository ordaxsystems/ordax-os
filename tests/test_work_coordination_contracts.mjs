import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  WORK_COORDINATION_MAX_CLAIM_LEASE_MS,
  validateWorkClaim,
  validateWorkCheckpoint,
  validateWorkCoordinationPolicy,
  validateWorkEvidence,
  validateWorkPlan,
  validateWorkTask,
} from "../system/contracts/work-coordination.mjs";

const NOW = "2026-10-06T05:00:00Z";

function notifications(overrides = {}) {
  return {
    approvalRequired: true,
    taskBlocked: true,
    workCompleted: true,
    staleClaim: true,
    conflictAvoided: true,
    routineProgress: false,
    ...overrides,
  };
}

test("coordination policy requires explicit user configuration and never grants authority", () => {
  const policy = validateWorkCoordinationPolicy({
    scope: "global",
    mode: "assisted",
    userConfigured: true,
    notifications: notifications(),
    authority: "none",
    configuredAt: NOW,
  });

  assert.equal(policy.schema, "ordax.work-coordination-policy/1");
  assert.equal(policy.mode, "assisted");
  assert.equal(policy.backgroundExecution, false);
  assert.equal(policy.authority, "none");
  assert.equal(policy.notifications.routineProgress, false);

  assert.throws(() => validateWorkCoordinationPolicy({
    ...policy,
    userConfigured: false,
  }), /explicitly user configured/);

  assert.throws(() => validateWorkCoordinationPolicy({
    ...policy,
    backgroundExecution: true,
  }), /cannot enable background execution/);

  assert.throws(() => validateWorkCoordinationPolicy({
    ...policy,
    grantRef: "grant-1",
  }), /cannot carry authority field/);

  assert.throws(() => validateWorkCoordinationPolicy({
    ...policy,
    mode: "automatic",
  }), /requires explicit confirmation timestamp/);

  const automatic = validateWorkCoordinationPolicy({
    ...policy,
    mode: "automatic",
    automaticConfirmedAt: "2026-10-06T05:03:00Z",
  });
  assert.equal(automatic.mode, "automatic");
  assert.equal(automatic.automaticConfirmedAt, "2026-10-06T05:03:00.000Z");
});

test("project policy requires a concrete project and global policy cannot smuggle one", () => {
  assert.throws(() => validateWorkCoordinationPolicy({
    scope: "project",
    mode: "manual",
    userConfigured: true,
    notifications: notifications(),
    authority: "none",
    configuredAt: NOW,
  }), /requires project id/);

  assert.throws(() => validateWorkCoordinationPolicy({
    scope: "global",
    projectId: "project-1",
    mode: "manual",
    userConfigured: true,
    notifications: notifications(),
    authority: "none",
    configuredAt: NOW,
  }), /cannot target a project/);
});

test("work plan is owner-bound, revisioned and does not duplicate task ids", () => {
  const plan = validateWorkPlan({
    revision: 3,
    id: "plan-finance",
    ownerKind: "account",
    ownerId: "user-1",
    projectId: "project-finance",
    workItemId: "personal-work-1",
    title: "Finance app MVP",
    objective: "Ship a finance app without duplicated work.",
    state: "active",
    taskIds: ["task-model", "task-ui"],
    authority: "none",
    createdAt: NOW,
    updatedAt: NOW,
  });

  assert.equal(plan.schema, "ordax.work-plan/1");
  assert.equal(plan.revision, 3);
  assert.deepEqual(plan.taskIds, ["task-model", "task-ui"]);
  assert.equal(plan.authority, "none");

  assert.throws(() => validateWorkPlan({
    ...plan,
    taskIds: ["task-model", "task-model"],
  }), /unique values/);
});

test("work task validates dependencies, completion evidence requirements and blocked state", () => {
  const task = validateWorkTask({
    revision: 2,
    id: "task-ofx",
    planId: "plan-finance",
    title: "Import OFX",
    objective: "Parse valid OFX and reject malformed input.",
    state: "ready",
    dependsOnTaskIds: ["task-model"],
    evidenceRequirements: ["commit", "ci-run"],
    authority: "none",
    createdAt: NOW,
    updatedAt: NOW,
  });

  assert.equal(task.schema, "ordax.work-task/1");
  assert.deepEqual(task.evidenceRequirements, ["commit", "ci-run"]);

  assert.throws(() => validateWorkTask({
    ...task,
    dependsOnTaskIds: ["task-ofx"],
  }), /cannot depend on itself/);

  assert.throws(() => validateWorkTask({
    ...task,
    evidenceRequirements: ["commit", "commit"],
  }), /unique values/);

  assert.throws(() => validateWorkTask({
    ...task,
    evidenceRequirements: ["chat-said-done"],
  }), /requirement is invalid/);

  assert.throws(() => validateWorkTask({
    ...task,
    state: "blocked",
  }), /requires a reason/);

  assert.throws(() => validateWorkTask({
    ...task,
    state: "completed",
  }), /requires completedAt/);
});

test("work claim is provider-neutral, revision-bound and uses a finite lease", () => {
  const claim = validateWorkClaim({
    id: "claim-1",
    planId: "plan-finance",
    taskId: "task-ofx",
    planRevision: 3,
    taskRevision: 2,
    workerKind: "ai-client",
    workerRef: "worker:opaque-1",
    clientRef: "client:chatgpt",
    sessionRef: "session:opaque-1",
    leaseId: "lease-1",
    acquiredAt: NOW,
    heartbeatAt: "2026-10-06T05:01:00Z",
    expiresAt: "2026-10-06T05:11:00Z",
    authority: "none",
  });

  assert.equal(claim.schema, "ordax.work-claim/1");
  assert.equal(claim.workerKind, "ai-client");
  assert.equal(claim.taskRevision, 2);

  const tooLong = new Date(
    Date.parse("2026-10-06T05:01:00Z") + WORK_COORDINATION_MAX_CLAIM_LEASE_MS + 1,
  ).toISOString();

  assert.throws(() => validateWorkClaim({
    ...claim,
    expiresAt: tooLong,
  }), /exceeds maximum duration/);

  assert.throws(() => validateWorkClaim({
    ...claim,
    heartbeatAt: "2026-10-06T04:59:59Z",
  }), /timestamps are inconsistent/);
});

test("checkpoint is claim-bound and bounded without becoming a transcript or grant", () => {
  const checkpoint = validateWorkCheckpoint({
    planId: "plan-finance",
    taskId: "task-ofx",
    taskRevision: 2,
    claimId: "claim-1",
    leaseId: "lease-1",
    sequence: 4,
    summary: "Parser complete; malformed-input tests remain.",
    resumeRef: "branch:feat/ofx-import",
    artifactRefs: ["commit:abc123"],
    authority: "none",
    createdAt: NOW,
  });

  assert.equal(checkpoint.schema, "ordax.work-checkpoint/1");
  assert.equal(checkpoint.sequence, 4);
  assert.equal(checkpoint.authority, "none");

  assert.throws(() => validateWorkCheckpoint({
    ...checkpoint,
    approvalId: "approval-1",
  }), /cannot carry authority field/);

  assert.throws(() => validateWorkCheckpoint({
    ...checkpoint,
    artifactRefs: ["commit:abc123", "commit:abc123"],
  }), /unique values/);
});

test("evidence is typed, verifiable and never authority", () => {
  const evidence = validateWorkEvidence({
    id: "evidence-pr-108",
    planId: "plan-finance",
    taskId: "task-ofx",
    taskRevision: 2,
    kind: "pull-request",
    reference: "github:owner/repo#108",
    summary: "OFX import implementation",
    verification: "verified",
    producerRef: "integration:github",
    observedAt: NOW,
    verifiedAt: "2026-10-06T05:02:00Z",
    authority: "none",
  });

  assert.equal(evidence.schema, "ordax.work-evidence/1");
  assert.equal(evidence.verification, "verified");

  assert.throws(() => validateWorkEvidence({
    ...evidence,
    verification: "unverified",
  }), /cannot carry verifiedAt/);

  assert.throws(() => validateWorkEvidence({
    ...evidence,
    verification: "verified",
    verifiedAt: null,
  }), /requires verifiedAt/);

  assert.throws(() => validateWorkEvidence({
    ...evidence,
    toolId: "dangerous-tool",
  }), /cannot carry authority field/);
});

test("machine-readable coordination status stays fail-closed and non-MVP-blocking", async () => {
  const foundation = JSON.parse(await readFile(
    new URL("../docs/contracts/work-coordination.json", import.meta.url),
    "utf8",
  ));

  assert.equal(foundation.status, "foundation-store-runtime-contracts-public-disabled");
  assert.equal(foundation.authority, "none");
  assert.equal(foundation.policy.absence_enables_coordination, false);
  assert.equal(foundation.policy.automatic_requires_explicit_confirmation, true);
  assert.equal(foundation.policy.background_execution_enabled, false);
  assert.equal(foundation.claims.finite_lease_required, true);
  assert.equal(foundation.claims.permanent_lock_allowed, false);
  assert.equal(foundation.runtime.recovery_mutation_requires_policy, true);
  assert.equal(foundation.runtime.system_mutation_requires_confirmed_automatic, true);
  assert.equal(foundation.runtime.provider_self_verification_allowed, false);
  assert.equal(foundation.mvp.new_usb_mvp_blocker, false);
  assert.equal(foundation.mvp.public_enabled, false);
  assert.equal(foundation.mvp.background_autonomy_enabled, false);
  assert.equal(foundation.mvp.provider_connector_mutations_enabled, false);
  assert.equal(foundation.mvp.studio_is_authority_owner, false);
});
