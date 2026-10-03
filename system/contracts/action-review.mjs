export const ACTION_REVIEW_PORT_SCHEMA = "ordax.action-review/1";
export const ACTION_REVIEW_RESULT_SCHEMA = "ordax.action-review-result/1";
export const ACTION_REVIEW_VERDICT_SCHEMA = "ordax.action-review-verdict/1";

const OUTCOMES = new Set(["pass", "needs-human", "block"]);

function boundedText(value, label, max = 256) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

function boundedTags(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 16) {
    throw new TypeError("Action review tags must be bounded");
  }
  const tags = value.map((entry) => boundedText(entry, "Action review tag", 64));
  if (new Set(tags).size !== tags.length) {
    throw new TypeError("Action review tags must be unique");
  }
  return Object.freeze(tags);
}

export function validateActionReviewResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action review result must be an object");
  }
  if (value.schema !== undefined && value.schema !== ACTION_REVIEW_RESULT_SCHEMA) {
    throw new TypeError("Action review result schema is incompatible");
  }
  if (!OUTCOMES.has(value.outcome)) {
    throw new TypeError("Action review outcome is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("Action review cannot create authority");
  }
  return Object.freeze({
    schema: ACTION_REVIEW_RESULT_SCHEMA,
    reviewerId: boundedText(value.reviewerId, "Action review reviewer id", 160),
    workItemId: boundedText(value.workItemId, "Action review work item id", 160),
    actionId: boundedText(value.actionId, "Action review action id", 128),
    outcome: value.outcome,
    authority: "none",
    reason: boundedText(value.reason, "Action review reason", 512),
    riskTags: boundedTags(value.riskTags),
  });
}

export function validateActionReviewVerdict(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action review verdict must be an object");
  }
  if (value.schema !== undefined && value.schema !== ACTION_REVIEW_VERDICT_SCHEMA) {
    throw new TypeError("Action review verdict schema is incompatible");
  }
  if (!OUTCOMES.has(value.outcome)) {
    throw new TypeError("Action review verdict outcome is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("Action review verdict cannot create authority");
  }
  if (!Array.isArray(value.reviewerIds) || value.reviewerIds.length > 32) {
    throw new TypeError("Action review reviewer ids must be bounded");
  }
  const reviewerIds = value.reviewerIds.map((entry) =>
    boundedText(entry, "Action review reviewer id", 160));
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    throw new TypeError("Action review reviewer ids must be unique");
  }
  return Object.freeze({
    schema: ACTION_REVIEW_VERDICT_SCHEMA,
    workItemId: boundedText(value.workItemId, "Action review work item id", 160),
    actionId: boundedText(value.actionId, "Action review action id", 128),
    outcome: value.outcome,
    authority: "none",
    reviewerIds: Object.freeze(reviewerIds),
    reason: boundedText(value.reason, "Action review verdict reason", 512),
    riskTags: boundedTags(value.riskTags),
    reviewedAt: timestamp(value.reviewedAt, "Action review reviewedAt"),
  });
}

export function assertActionReviewPort(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ACTION_REVIEW_PORT_SCHEMA
    || typeof value.review !== "function"
  ) {
    throw new TypeError("A compatible Action Review port is required");
  }
  return value;
}
