import {
  ACTION_REVIEW_PORT_SCHEMA,
  validateActionReviewResult,
  validateActionReviewVerdict,
} from "../../contracts/action-review.mjs";
import { validateActionRequest } from "../../contracts/action-gateway.mjs";

const RESTRICTIVENESS = new Map([
  ["pass", 0],
  ["needs-human", 1],
  ["block", 2],
]);

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Action Review clock must return a non-negative epoch millisecond");
  }
  return value;
}

export function createActionReviewEngine({ reviewers = [], now = Date.now } = {}) {
  if (!Array.isArray(reviewers) || reviewers.length > 32) {
    throw new TypeError("Action Review reviewers must be a bounded array");
  }
  if (typeof now !== "function") {
    throw new TypeError("Action Review requires a clock function");
  }

  const normalized = reviewers.map((reviewer) => {
    if (
      !reviewer
      || typeof reviewer !== "object"
      || typeof reviewer.id !== "string"
      || !reviewer.id.trim()
      || typeof reviewer.review !== "function"
    ) {
      throw new TypeError("Action Review reviewer is invalid");
    }
    return Object.freeze({ id: reviewer.id.trim(), review: reviewer.review });
  });
  if (new Set(normalized.map((reviewer) => reviewer.id)).size !== normalized.length) {
    throw new TypeError("Action Review reviewer ids must be unique");
  }

  return Object.freeze({
    schema: ACTION_REVIEW_PORT_SCHEMA,
    review(requestValue) {
      const request = validateActionRequest(requestValue);
      let outcome = "pass";
      const reviewerIds = [];
      const riskTags = new Set();

      for (const reviewer of normalized) {
        let result;
        try {
          result = validateActionReviewResult(reviewer.review(request));
          if (
            result.reviewerId !== reviewer.id
            || result.workItemId !== request.workItemId
            || result.actionId !== request.actionId
          ) {
            throw new TypeError("Action Review result binding mismatch");
          }
        } catch {
          result = validateActionReviewResult({
            reviewerId: reviewer.id,
            workItemId: request.workItemId,
            actionId: request.actionId,
            outcome: "needs-human",
            authority: "none",
            reason: "Reviewer failed closed and requires human attention.",
            riskTags: ["reviewer-failure"],
          });
        }

        reviewerIds.push(reviewer.id);
        for (const tag of result.riskTags) riskTags.add(tag);
        if (RESTRICTIVENESS.get(result.outcome) > RESTRICTIVENESS.get(outcome)) {
          outcome = result.outcome;
        }
      }

      return validateActionReviewVerdict({
        workItemId: request.workItemId,
        actionId: request.actionId,
        outcome,
        authority: "none",
        reviewerIds,
        reason: normalized.length === 0
          ? "No action reviewers are configured; existing policy and authority requirements remain unchanged."
          : `Most restrictive action review outcome is ${outcome}.`,
        riskTags: [...riskTags],
        reviewedAt: new Date(readClock(now)).toISOString(),
      });
    },
  });
}
