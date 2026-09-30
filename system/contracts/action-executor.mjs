import {
  ACTION_REQUEST_SCHEMA,
  validateActionRequest,
} from "./action-gateway.mjs";
import { validatePersonalActionDecision } from "./personal-ordax.mjs";

export const ACTION_EXECUTOR_SCHEMA = "ordax.action-executor/1";
export const AUTHORIZED_ACTION_EXECUTION_SCHEMA = "ordax.authorized-action-execution/1";
export const ACTION_ADAPTER_SCHEMA = "ordax.action-adapter/1";
export const ACTION_RECEIPT_SCHEMA = "ordax.action-receipt/1";

const RECEIPT_STATUSES = new Set(["succeeded", "failed"]);

function boundedText(value, label, max = 512) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max = 512) {
  if (value == null || value === "") return null;
  return boundedText(value, label, max);
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(parsed).toISOString();
}

export function validateAuthorizedActionExecution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Authorized action execution must be an object");
  }
  if (
    value.schema !== undefined
    && value.schema !== AUTHORIZED_ACTION_EXECUTION_SCHEMA
  ) {
    throw new TypeError("Authorized action execution schema is incompatible");
  }

  const request = validateActionRequest({
    ...value.request,
    schema: ACTION_REQUEST_SCHEMA,
  });
  const decision = validatePersonalActionDecision(value.decision);

  if (decision.decision !== "allow") {
    throw new TypeError("Action executor requires an allow decision");
  }
  if (
    decision.workItemId !== request.workItemId
    || decision.approvalId !== request.approvalId
    || decision.actionId !== request.actionId
    || decision.effect !== request.effect
  ) {
    throw new TypeError("Action executor decision does not match the action request");
  }
  if (request.effect !== "read") {
    if (request.approvalId === null) {
      throw new TypeError("Sensitive action execution requires an exact approval reference");
    }
    if (request.resourceRef === null) {
      throw new TypeError("Sensitive action execution requires an exact resource reference");
    }
    if (decision.grantRef === null || decision.grantRef === "") {
      throw new TypeError("Sensitive action execution requires an explicit grant reference");
    }
  }

  return Object.freeze({
    schema: AUTHORIZED_ACTION_EXECUTION_SCHEMA,
    request,
    decision,
  });
}

export function assertActionExecutor(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ACTION_EXECUTOR_SCHEMA
    || typeof value.execute !== "function"
  ) {
    throw new TypeError("A compatible Action Executor is required");
  }
  return value;
}


export function assertActionAdapter(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ACTION_ADAPTER_SCHEMA
    || typeof value.toolId !== "string"
    || typeof value.actionId !== "string"
    || typeof value.artifactSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.artifactSha256)
    || typeof value.effect !== "string"
    || typeof value.execute !== "function"
  ) {
    throw new TypeError("A compatible typed Action Adapter is required");
  }
  return value;
}

export function validateActionReceipt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action receipt must be an object");
  }
  if (value.schema !== undefined && value.schema !== ACTION_RECEIPT_SCHEMA) {
    throw new TypeError("Action receipt schema is incompatible");
  }
  if (!RECEIPT_STATUSES.has(value.status)) {
    throw new TypeError("Action receipt status is invalid");
  }
  const artifactRefs = value.artifactRefs ?? [];
  if (!Array.isArray(artifactRefs) || artifactRefs.length > 16) {
    throw new TypeError("Action receipt artifact refs are outside bounds");
  }
  const uniqueRefs = artifactRefs.map((entry) => boundedText(entry, "Action receipt artifact ref", 240));
  if (new Set(uniqueRefs).size !== uniqueRefs.length) {
    throw new TypeError("Action receipt artifact refs must be unique");
  }
  const effect = boundedText(value.effect, "Action receipt effect", 32);
  const resourceRef = optionalText(value.resourceRef, "Action receipt resource ref", 512);
  const grantRef = optionalText(value.grantRef, "Action receipt grant ref", 240);
  if (effect !== "read" && (resourceRef === null || grantRef === null)) {
    throw new TypeError("Sensitive Action Receipt requires exact resource and grant references");
  }
  return Object.freeze({
    schema: ACTION_RECEIPT_SCHEMA,
    workItemId: boundedText(value.workItemId, "Action receipt work item id", 160),
    approvalId: boundedText(value.approvalId, "Action receipt approval id", 200),
    toolId: boundedText(value.toolId, "Action receipt tool id", 96),
    toolArtifactSha256: (() => {
      const digest = boundedText(value.toolArtifactSha256, "Action receipt tool artifact sha256", 64);
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new TypeError("Action receipt tool artifact sha256 is invalid");
      return digest;
    })(),
    actionId: boundedText(value.actionId, "Action receipt action id", 128),
    effect,
    resourceRef,
    grantRef,
    status: value.status,
    summary: boundedText(value.summary, "Action receipt summary", 1024),
    artifactRefs: Object.freeze(uniqueRefs),
    executedAt: timestamp(value.executedAt, "Action receipt executedAt"),
  });
}
