import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_USAGE_SCHEMA,
  validateWebUsage,
} from "../system/contracts/web-research.mjs";
import {
  WEB_OPERATION_RECEIPT_SCHEMA,
  validateWebOperationReceipt,
  validateWebResourceRef,
} from "../system/contracts/web-research-execution.mjs";

const SEARCH_REF = `ordax-web:search:sha256:${"a".repeat(64)}`;
const EXTRACT_REF = `ordax-web:extract:sha256:${"b".repeat(64)}`;

function usage(overrides = {}) {
  return {
    schema: WEB_USAGE_SCHEMA,
    providerId: "provider.test",
    operation: "search",
    requestCount: 2,
    externalBytes: 4096,
    providerUnits: 2,
    estimatedCostUsd: 0.0012,
    actualCostUsd: 0.0011,
    latencyMs: 240,
    cacheStatus: "miss",
    fallbackReason: null,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    schema: WEB_OPERATION_RECEIPT_SCHEMA,
    operationId: "web-op-1",
    operation: "search",
    resourceRef: SEARCH_REF,
    status: "succeeded",
    usage: usage(),
    sourceContentHashes: ["c".repeat(64), "d".repeat(64)],
    startedAt: "2026-10-14T15:00:00.000Z",
    completedAt: "2026-10-14T15:00:00.240Z",
    errorCode: null,
    ...overrides,
  };
}

test("Web operation receipt reuses canonical provider usage instead of defining another quota/accounting model", () => {
  const canonicalUsage = validateWebUsage(usage());
  const value = validateWebOperationReceipt(receipt());
  assert.deepEqual(value.usage, canonicalUsage);
  assert.equal(value.usage.schema, WEB_USAGE_SCHEMA);
  assert.equal(value.usage.actualCostUsd, 0.0011);
  assert.equal("grantRef" in value.usage, false);
  assert.equal("authority" in value.usage, false);
});

test("Web operation receipt binds operation, deterministic resource and normalized sources", () => {
  const value = validateWebOperationReceipt(receipt());
  assert.equal(value.schema, WEB_OPERATION_RECEIPT_SCHEMA);
  assert.equal(value.resourceRef, SEARCH_REF);
  assert.equal(value.usage.operation, "search");
  assert.deepEqual(value.sourceContentHashes, ["c".repeat(64), "d".repeat(64)]);
  assert.equal("grantRef" in value, false);
  assert.equal("approvalId" in value, false);
});

test("Web resource refs are operation-bound and reject cross-operation reuse", () => {
  assert.equal(validateWebResourceRef(SEARCH_REF, "search"), SEARCH_REF);
  assert.equal(validateWebResourceRef(EXTRACT_REF, "extract"), EXTRACT_REF);
  assert.throws(() => validateWebResourceRef(SEARCH_REF, "extract"), /does not match/i);
  assert.throws(() => validateWebResourceRef("https://example.com", "search"), /invalid/i);
});

test("Web operation receipt rejects usage/resource mismatches and authority or credential injection", () => {
  assert.throws(
    () => validateWebOperationReceipt(receipt({ resourceRef: EXTRACT_REF })),
    /does not match/i,
  );
  assert.throws(
    () => validateWebOperationReceipt(receipt({ usage: usage({ operation: "extract" }) })),
    /usage operation does not match/i,
  );
  assert.throws(
    () => validateWebOperationReceipt({ ...receipt(), grantRef: "egress-1" }),
    /authority or credential/i,
  );
  assert.throws(
    () => validateWebOperationReceipt(receipt({ usage: { ...usage(), apiKey: "secret" } })),
    /authority or credential/i,
  );
});

test("Web receipt status cannot overclaim success or normalized evidence", () => {
  assert.throws(
    () => validateWebOperationReceipt(receipt({ status: "failed", errorCode: "provider-timeout" })),
    /cannot claim normalized sources/i,
  );
  assert.throws(
    () => validateWebOperationReceipt(receipt({ status: "partial", errorCode: null })),
    /requires an error code/i,
  );
  assert.throws(
    () => validateWebOperationReceipt(receipt({ errorCode: "unexpected" })),
    /cannot carry an error code/i,
  );
  assert.throws(
    () => validateWebOperationReceipt(receipt({
      startedAt: "2026-10-14T15:00:01.000Z",
      completedAt: "2026-10-14T15:00:00.000Z",
    })),
    /cannot precede start/i,
  );
});
