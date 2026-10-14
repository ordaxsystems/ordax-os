import {
  WEB_MAX_EXTERNAL_BYTES,
  WEB_MAX_REQUESTS,
  WEB_MAX_RESULTS,
} from "./web-research.mjs";

export const WEB_USAGE_SCHEMA = "ordax.web.usage/1";
export const WEB_OPERATION_RECEIPT_SCHEMA = "ordax.web-operation-receipt/1";

export const WEB_MAX_LATENCY_MS = 5 * 60 * 1000;
export const WEB_MAX_PROVIDER_UNITS = 1_000_000_000;
export const WEB_MAX_COST_MICROUSD = 100 * 1_000_000;

const OPERATIONS = new Set(["search", "extract"]);
const STATUSES = new Set(["succeeded", "partial", "failed"]);
const CACHE_STATUSES = new Set(["miss", "hit", "revalidated", "bypass", "mixed"]);
const PROVIDER_ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const RESOURCE_REF_RE = /^ordax-web:(search|extract):sha256:([0-9a-f]{64})$/;

const USAGE_FIELDS = new Set([
  "schema",
  "providerId",
  "operation",
  "requestCount",
  "externalBytes",
  "providerUnits",
  "providerUnit",
  "estimatedCostMicrousd",
  "actualCostMicrousd",
  "latencyMs",
  "cacheStatus",
  "fallbackCount",
  "degradedReason",
]);
const RECEIPT_FIELDS = new Set([
  "schema",
  "operationId",
  "operation",
  "resourceRef",
  "status",
  "usage",
  "sourceContentHashes",
  "startedAt",
  "completedAt",
  "errorCode",
]);
const AUTHORITY_OR_CREDENTIAL_FIELDS = new Set([
  "grantref",
  "approvalid",
  "decision",
  "authority",
  "actionauthority",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "credential",
  "credentials",
  "password",
  "cookie",
  "cookies",
  "headers",
  "authorization",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function rejectUnexpectedFields(value, label, allowed) {
  for (const key of Object.keys(value)) {
    if (AUTHORITY_OR_CREDENTIAL_FIELDS.has(key.toLowerCase())) {
      throw new TypeError(`${label} cannot carry authority or credential field ${key}`);
    }
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${key}`);
    }
  }
}

function boundedText(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function optionalText(value, label, max) {
  return value == null || value === "" ? null : boundedText(value, label, max);
}

function nonNegativeInteger(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function nonNegativeNumber(value, label, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return value;
}

function timestamp(value, label) {
  const text = boundedText(value, label, 64);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  return new Date(parsed).toISOString();
}

function providerId(value) {
  const normalized = boundedText(value, "Web usage provider id", 96).toLowerCase();
  if (!PROVIDER_ID_RE.test(normalized)) throw new TypeError("Web usage provider id is invalid");
  return normalized;
}

function operation(value, label = "Web operation") {
  if (!OPERATIONS.has(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function optionalCost(value, label) {
  if (value == null) return null;
  return nonNegativeInteger(value, label, WEB_MAX_COST_MICROUSD);
}

export function validateWebResourceRef(value, expectedOperation = null) {
  const normalized = boundedText(value, "Web resource ref", 128);
  const match = RESOURCE_REF_RE.exec(normalized);
  if (!match) throw new TypeError("Web resource ref is invalid");
  if (expectedOperation !== null && operation(expectedOperation) !== match[1]) {
    throw new TypeError("Web resource ref operation does not match the receipt operation");
  }
  return normalized;
}

export function validateWebUsage(value) {
  const usage = object(value, "Web usage");
  rejectUnexpectedFields(usage, "Web usage", USAGE_FIELDS);
  if (usage.schema !== undefined && usage.schema !== WEB_USAGE_SCHEMA) {
    throw new TypeError("Web usage schema is incompatible");
  }
  const normalizedOperation = operation(usage.operation, "Web usage operation");
  const cacheStatus = usage.cacheStatus ?? "miss";
  if (!CACHE_STATUSES.has(cacheStatus)) throw new TypeError("Web usage cache status is invalid");
  const degradedReason = optionalText(usage.degradedReason, "Web usage degraded reason", 512);
  const fallbackCount = nonNegativeInteger(
    usage.fallbackCount ?? 0,
    "Web usage fallback count",
    WEB_MAX_REQUESTS,
  );
  const requestCount = nonNegativeInteger(
    usage.requestCount,
    "Web usage request count",
    WEB_MAX_REQUESTS,
  );
  if (fallbackCount > requestCount) {
    throw new TypeError("Web usage fallback count cannot exceed request count");
  }
  return Object.freeze({
    schema: WEB_USAGE_SCHEMA,
    providerId: providerId(usage.providerId),
    operation: normalizedOperation,
    requestCount,
    externalBytes: nonNegativeInteger(
      usage.externalBytes,
      "Web usage external bytes",
      WEB_MAX_EXTERNAL_BYTES,
    ),
    providerUnits: nonNegativeNumber(
      usage.providerUnits ?? 0,
      "Web usage provider units",
      WEB_MAX_PROVIDER_UNITS,
    ),
    providerUnit: optionalText(usage.providerUnit, "Web usage provider unit", 64),
    estimatedCostMicrousd: optionalCost(
      usage.estimatedCostMicrousd,
      "Web usage estimated cost",
    ),
    actualCostMicrousd: optionalCost(
      usage.actualCostMicrousd,
      "Web usage actual cost",
    ),
    latencyMs: nonNegativeInteger(usage.latencyMs, "Web usage latency", WEB_MAX_LATENCY_MS),
    cacheStatus,
    fallbackCount,
    degradedReason,
  });
}

export function validateWebOperationReceipt(value) {
  const receipt = object(value, "Web operation receipt");
  rejectUnexpectedFields(receipt, "Web operation receipt", RECEIPT_FIELDS);
  if (receipt.schema !== undefined && receipt.schema !== WEB_OPERATION_RECEIPT_SCHEMA) {
    throw new TypeError("Web operation receipt schema is incompatible");
  }
  const normalizedOperation = operation(receipt.operation);
  if (!STATUSES.has(receipt.status)) throw new TypeError("Web operation receipt status is invalid");
  const usage = validateWebUsage(receipt.usage);
  if (usage.operation !== normalizedOperation) {
    throw new TypeError("Web operation receipt usage operation does not match");
  }

  const hashes = receipt.sourceContentHashes ?? [];
  if (!Array.isArray(hashes) || hashes.length > WEB_MAX_RESULTS) {
    throw new TypeError("Web operation receipt source hashes are outside bounds");
  }
  const normalizedHashes = hashes.map((entry, index) => {
    const hash = boundedText(entry, `Web source hash[${index}]`, 64);
    if (!SHA256_RE.test(hash)) throw new TypeError(`Web source hash[${index}] is invalid`);
    return hash;
  });
  if (new Set(normalizedHashes).size !== normalizedHashes.length) {
    throw new TypeError("Web operation receipt source hashes must be unique");
  }
  if (receipt.status === "failed" && normalizedHashes.length !== 0) {
    throw new TypeError("Failed Web operation receipt cannot claim normalized sources");
  }
  if (receipt.status === "succeeded" && receipt.errorCode != null) {
    throw new TypeError("Succeeded Web operation receipt cannot carry an error code");
  }
  const errorCode = optionalText(receipt.errorCode, "Web operation receipt error code", 128);
  if (receipt.status !== "succeeded" && errorCode === null) {
    throw new TypeError("Non-success Web operation receipt requires an error code");
  }

  const startedAt = timestamp(receipt.startedAt, "Web operation startedAt");
  const completedAt = timestamp(receipt.completedAt, "Web operation completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new TypeError("Web operation completion cannot precede start");
  }

  return Object.freeze({
    schema: WEB_OPERATION_RECEIPT_SCHEMA,
    operationId: boundedText(receipt.operationId, "Web operation id", 160),
    operation: normalizedOperation,
    resourceRef: validateWebResourceRef(receipt.resourceRef, normalizedOperation),
    status: receipt.status,
    usage,
    sourceContentHashes: Object.freeze(normalizedHashes),
    startedAt,
    completedAt,
    errorCode,
  });
}
