export const ACTION_POLICY_PORT_SCHEMA = "ordax.action-policy/1";
export const ACTION_POLICY_RULE_SCHEMA = "ordax.action-policy-rule/1";
export const ACTION_POLICY_VERDICT_SCHEMA = "ordax.action-policy-verdict/1";

const LAYERS = new Set(["core-security", "device", "user", "work"]);
const OUTCOMES = new Set(["allow-if-authorized", "approval-required", "handoff-to-user", "deny"]);
const EFFECTS = new Set(["read", "write", "external-egress", "device-control"]);
const OWNER_KINDS = new Set(["device", "account"]);

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

function optionalText(value, label, max = 256) {
  if (value == null || value === "") return null;
  return boundedText(value, label, max);
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  return new Date(parsed).toISOString();
}

export function validateActionPolicyRule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action policy rule must be an object");
  }
  if (value.schema !== undefined && value.schema !== ACTION_POLICY_RULE_SCHEMA) {
    throw new TypeError("Action policy rule schema is incompatible");
  }
  if (!LAYERS.has(value.layer)) {
    throw new TypeError("Action policy layer is invalid");
  }
  if (!OUTCOMES.has(value.outcome)) {
    throw new TypeError("Action policy outcome is invalid");
  }

  const effect = value.effect == null ? null : value.effect;
  if (effect !== null && !EFFECTS.has(effect)) {
    throw new TypeError("Action policy effect is invalid");
  }
  const ownerKind = value.ownerKind == null ? null : value.ownerKind;
  if (ownerKind !== null && !OWNER_KINDS.has(ownerKind)) {
    throw new TypeError("Action policy owner kind is invalid");
  }
  const ownerId = optionalText(value.ownerId, "Action policy owner id", 160);
  if (ownerKind === "account" && ownerId === null) {
    throw new TypeError("Account-scoped action policy requires owner id");
  }
  if ((ownerKind === null || ownerKind === "device") && ownerId !== null) {
    throw new TypeError("Action policy owner id requires account owner kind");
  }

  return Object.freeze({
    schema: ACTION_POLICY_RULE_SCHEMA,
    id: boundedText(value.id, "Action policy rule id", 160),
    layer: value.layer,
    outcome: value.outcome,
    toolId: optionalText(value.toolId, "Action policy tool id", 96),
    actionId: optionalText(value.actionId, "Action policy action id", 128),
    effect,
    ownerKind,
    ownerId,
    spaceId: optionalText(value.spaceId, "Action policy Space id", 160),
    projectId: optionalText(value.projectId, "Action policy project id", 160),
    resourceScheme: optionalText(value.resourceScheme, "Action policy resource scheme", 64),
    reason: boundedText(value.reason, "Action policy reason", 512),
  });
}

export function validateActionPolicyVerdict(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action policy verdict must be an object");
  }
  if (value.schema !== undefined && value.schema !== ACTION_POLICY_VERDICT_SCHEMA) {
    throw new TypeError("Action policy verdict schema is incompatible");
  }
  if (!OUTCOMES.has(value.outcome)) {
    throw new TypeError("Action policy verdict outcome is invalid");
  }
  if (value.authority !== "none") {
    throw new TypeError("Action policy verdict cannot create authority");
  }
  if (!Array.isArray(value.matchedRuleIds) || value.matchedRuleIds.length > 32) {
    throw new TypeError("Action policy matched rules must be bounded");
  }
  const matchedRuleIds = value.matchedRuleIds.map((entry) =>
    boundedText(entry, "Action policy matched rule id", 160));
  if (new Set(matchedRuleIds).size !== matchedRuleIds.length) {
    throw new TypeError("Action policy matched rules must be unique");
  }

  return Object.freeze({
    schema: ACTION_POLICY_VERDICT_SCHEMA,
    workItemId: boundedText(value.workItemId, "Action policy work item id", 160),
    actionId: boundedText(value.actionId, "Action policy action id", 128),
    outcome: value.outcome,
    authority: "none",
    matchedRuleIds: Object.freeze(matchedRuleIds),
    reason: boundedText(value.reason, "Action policy verdict reason", 512),
    evaluatedAt: timestamp(value.evaluatedAt, "Action policy evaluatedAt"),
  });
}

export function assertActionPolicyPort(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ACTION_POLICY_PORT_SCHEMA
    || typeof value.evaluate !== "function"
  ) {
    throw new TypeError("A compatible Action Policy port is required");
  }
  return value;
}
