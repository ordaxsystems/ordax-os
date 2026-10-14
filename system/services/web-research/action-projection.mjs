import { createHash } from "node:crypto";

import {
  ACTION_REQUEST_SCHEMA,
  assertActionGateway,
  validateActionRequest,
} from "../../contracts/action-gateway.mjs";
import {
  validateWebExtractRequest,
  validateWebSearchRequest,
} from "../../contracts/web-research.mjs";

export const WEB_ACTION_PROJECTION_SCHEMA = "ordax.web-action-projection/1";
export const WEB_EGRESS_PROJECTION_SCHEMA = "ordax.web-egress-projection/1";

const OPERATION_ACTIONS = Object.freeze({
  search: "web.search",
  extract: "web.extract",
});
const SHA256_RE = /^[0-9a-f]{64}$/;

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

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Web Research action projection clock must return epoch milliseconds");
  }
  return value;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function requestResourceRef(operation, request) {
  const digest = createHash("sha256").update(stableJson(request), "utf8").digest("hex");
  return `ordax-web:${operation}:sha256:${digest}`;
}

function normalizeContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Web Research action context must be an object");
  }
  const toolArtifactSha256 = boundedText(
    value.toolArtifactSha256,
    "Web Research tool artifact sha256",
    64,
  );
  if (!SHA256_RE.test(toolArtifactSha256)) {
    throw new TypeError("Web Research tool artifact sha256 is invalid");
  }
  const ownerKind = value.ownerKind;
  if (ownerKind !== "device" && ownerKind !== "account") {
    throw new TypeError("Web Research owner kind is invalid");
  }
  const ownerId = ownerKind === "account"
    ? boundedText(value.ownerId, "Web Research owner id", 160)
    : null;
  if (ownerKind === "device" && value.ownerId != null) {
    throw new TypeError("Device Web Research context cannot invent an account owner id");
  }
  return Object.freeze({
    workItemId: boundedText(value.workItemId, "Web Research work item id", 160),
    approvalId: optionalText(value.approvalId, "Web Research approval id", 200),
    toolId: boundedText(value.toolId, "Web Research tool id", 96),
    toolArtifactSha256,
    ownerKind,
    ownerId,
    spaceId: optionalText(value.spaceId, "Web Research Space id", 160),
    projectId: optionalText(value.projectId, "Web Research project id", 160),
  });
}

function project({ actionGateway, now, operation, webRequest, actionContext, grantRef }) {
  const context = normalizeContext(actionContext);
  const actionRequest = validateActionRequest({
    schema: ACTION_REQUEST_SCHEMA,
    workItemId: context.workItemId,
    approvalId: context.approvalId,
    actionId: OPERATION_ACTIONS[operation],
    toolId: context.toolId,
    toolArtifactSha256: context.toolArtifactSha256,
    effect: "external-egress",
    ownerKind: context.ownerKind,
    ownerId: context.ownerId,
    spaceId: context.spaceId,
    projectId: context.projectId,
    resourceRef: requestResourceRef(operation, webRequest),
    reason: `Acquire external Web Research evidence through ${operation}.`,
    requestedAt: new Date(readClock(now)).toISOString(),
  });
  const decision = actionGateway.decide(actionRequest, { grantRef });
  return Object.freeze({
    schema: WEB_EGRESS_PROJECTION_SCHEMA,
    operation,
    webRequest,
    actionRequest,
    decision,
  });
}

export function createWebResearchActionProjection({ actionGateway: gatewayValue, now = Date.now } = {}) {
  const actionGateway = assertActionGateway(gatewayValue);
  if (typeof now !== "function") {
    throw new TypeError("Web Research action projection requires a clock function");
  }

  return Object.freeze({
    schema: WEB_ACTION_PROJECTION_SCHEMA,

    search(requestValue, actionContext, { grantRef = null } = {}) {
      return project({
        actionGateway,
        now,
        operation: "search",
        webRequest: validateWebSearchRequest(requestValue),
        actionContext,
        grantRef,
      });
    },

    extract(requestValue, actionContext, { grantRef = null } = {}) {
      return project({
        actionGateway,
        now,
        operation: "extract",
        webRequest: validateWebExtractRequest(requestValue),
        actionContext,
        grantRef,
      });
    },
  });
}
