import assert from "node:assert/strict";
import test from "node:test";

import { createActionReviewEngine } from "../system/services/action-review/review-engine.mjs";

function request(overrides = {}) {
  return {
    workItemId: "work-1",
    approvalId: "approval-1",
    actionId: "files.write",
    toolId: "files",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: null,
    resourceRef: "file-space:/Docs/a.md",
    reason: "Update the project document.",
    requestedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

const now = () => Date.parse("2026-10-03T12:01:00.000Z");

test("empty review remains authority-free", () => {
  const verdict = createActionReviewEngine({ now }).review(request());
  assert.equal(verdict.outcome, "pass");
  assert.equal(verdict.authority, "none");
  assert.deepEqual(verdict.reviewerIds, []);
});

test("most restrictive reviewer result wins", () => {
  const engine = createActionReviewEngine({
    now,
    reviewers: [{
      id: "scope-review",
      review(value) {
        return {
          reviewerId: "scope-review",
          workItemId: value.workItemId,
          actionId: value.actionId,
          outcome: "pass",
          authority: "none",
          reason: "Scope looks consistent.",
          riskTags: [],
        };
      },
    }, {
      id: "target-review",
      review(value) {
        return {
          reviewerId: "target-review",
          workItemId: value.workItemId,
          actionId: value.actionId,
          outcome: "block",
          authority: "none",
          reason: "Target is not safe for this operation.",
          riskTags: ["target-risk"],
        };
      },
    }],
  });

  const verdict = engine.review(request());
  assert.equal(verdict.outcome, "block");
  assert.equal(verdict.authority, "none");
  assert.deepEqual(verdict.riskTags, ["target-risk"]);
});

test("reviewer failures require human attention instead of silently passing", () => {
  const engine = createActionReviewEngine({
    now,
    reviewers: [{
      id: "failing-reviewer",
      review() {
        throw new Error("review failed");
      },
    }],
  });

  const verdict = engine.review(request());
  assert.equal(verdict.outcome, "needs-human");
  assert.equal(verdict.authority, "none");
  assert.deepEqual(verdict.riskTags, ["reviewer-failure"]);
});
