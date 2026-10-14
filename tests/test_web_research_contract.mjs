import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_EXTRACT_REQUEST_SCHEMA,
  WEB_MAX_QUERY_CHARS,
  WEB_PROVIDER_SCHEMA,
  WEB_PROVENANCE_SCHEMA,
  WEB_SEARCH_REQUEST_SCHEMA,
  WEB_SOURCE_SCHEMA,
  WEB_SOURCE_TRUST,
  WEB_USAGE_SCHEMA,
  assertWebProvider,
  validateWebExtractRequest,
  validateWebProvenance,
  validateWebSearchRequest,
  validateWebSource,
  validateWebUsage,
} from "../system/contracts/web-research.mjs";

const search = Object.freeze({
  schema: WEB_SEARCH_REQUEST_SCHEMA,
  query: "latest stable release of framework X",
  locale: "pt-BR",
  freshness: "current",
  domains: { include: ["example.org"], exclude: ["spam.example"] },
  limits: {
    maxResults: 8,
    maxRequests: 3,
    maxExternalBytes: 1_000_000,
    maxCostUsd: 0.05,
    deadlineMs: 10_000,
  },
  cache: { mode: "provider-policy" },
});

const provenance = Object.freeze({
  schema: WEB_PROVENANCE_SCHEMA,
  providerId: "provider-a",
  providerResultId: "result-1",
  extractorId: "local-http",
  extractorVersion: "1",
  retrievedAt: "2026-10-14T08:00:00Z",
  cacheStatus: "miss",
});

const source = Object.freeze({
  schema: WEB_SOURCE_SCHEMA,
  trust: WEB_SOURCE_TRUST,
  sourceUrl: "https://example.org/article",
  canonicalUrl: "https://example.org/article",
  title: "Example",
  publishedAt: "2026-10-14T07:00:00Z",
  retrievedAt: "2026-10-14T08:00:00Z",
  mimeType: "text/html",
  language: "en",
  contentHash: "a".repeat(64),
  provenance,
});

const usage = Object.freeze({
  schema: WEB_USAGE_SCHEMA,
  providerId: "provider-a",
  operation: "search",
  requestCount: 1,
  externalBytes: 12_345,
  providerUnits: 1,
  estimatedCostUsd: 0.001,
  actualCostUsd: 0.001,
  latencyMs: 320,
  cacheStatus: "miss",
  fallbackReason: null,
});

test("search contract is bounded, normalized and authority-free", () => {
  const result = validateWebSearchRequest(search);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.domains));
  assert.ok(Object.isFrozen(result.limits));
  assert.equal(result.schema, WEB_SEARCH_REQUEST_SCHEMA);
  assert.equal(result.query, search.query);
  assert.deepEqual(result.domains.include, ["example.org"]);

  for (const field of ["grantRef", "authority", "approvalId", "toolExecution", "actionId"]) {
    assert.throws(() => validateWebSearchRequest({ ...search, [field]: "forged" }), /authority field/);
  }
});

test("search contract rejects malformed and unbounded input", () => {
  for (const changed of [
    { schema: "ordax.web.search/0" },
    { query: "" },
    { query: "x".repeat(WEB_MAX_QUERY_CHARS + 1) },
    { locale: "not a locale !" },
    { freshness: "forever" },
    { domains: { include: ["https://example.org"], exclude: [] } },
    { domains: { include: ["example.org"], exclude: ["example.org"] } },
    { limits: { ...search.limits, maxResults: 1000 } },
    { limits: { ...search.limits, maxCostUsd: -1 } },
    { cache: { mode: "persist-everything" } },
  ]) {
    assert.throws(() => validateWebSearchRequest({ ...search, ...changed }), TypeError);
  }
});

test("extract contract accepts only bounded public web URL syntax and carries no grant", () => {
  const result = validateWebExtractRequest({
    schema: WEB_EXTRACT_REQUEST_SCHEMA,
    urls: ["https://EXAMPLE.ORG/docs", "http://example.net/guide"],
  });
  assert.deepEqual(result.urls, ["https://example.org/docs", "http://example.net/guide"]);
  assert.equal(result.limits.maxResults, 2);

  for (const urls of [
    [],
    ["file:///etc/hosts"],
    ["https://user:pass@example.org/"],
    ["not-a-url"],
  ]) {
    assert.throws(() => validateWebExtractRequest({ urls }), TypeError);
  }
  assert.throws(() => validateWebExtractRequest({ urls: ["https://example.org"], grantRef: "forged" }), /authority field/);
});

test("source and provenance stay untrusted and auditable without becoming authority", () => {
  const result = validateWebSource(source);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.trust, WEB_SOURCE_TRUST);
  assert.equal(result.provenance.providerId, "provider-a");
  assert.equal(result.retrievedAt, "2026-10-14T08:00:00.000Z");
  assert.equal(validateWebProvenance(provenance).cacheStatus, "miss");

  assert.throws(() => validateWebSource({ ...source, trust: "system" }), TypeError);
  assert.throws(() => validateWebSource({ ...source, authority: "allow" }), /authority field/);
  assert.throws(() => validateWebSource({ ...source, contentHash: "not-a-hash" }), TypeError);
  assert.throws(() => validateWebProvenance({ ...provenance, grantRef: "forged" }), /authority field/);
});

test("provider usage is bounded accounting and never an authority receipt", () => {
  const result = validateWebUsage(usage);
  assert.ok(Object.isFrozen(result));
  assert.equal(result.schema, WEB_USAGE_SCHEMA);
  assert.equal(result.providerId, "provider-a");
  assert.equal(result.requestCount, 1);
  assert.equal(result.actualCostUsd, 0.001);

  for (const changed of [
    { schema: "ordax.web.usage/0" },
    { operation: "execute-shell" },
    { requestCount: 0 },
    { externalBytes: -1 },
    { providerUnits: -1 },
    { estimatedCostUsd: -1 },
    { actualCostUsd: 101 },
    { latencyMs: 999_999 },
    { cacheStatus: "trusted" },
  ]) {
    assert.throws(() => validateWebUsage({ ...usage, ...changed }), TypeError);
  }
  assert.throws(
    () => validateWebUsage({ ...usage, grantRef: "forged" }),
    /cannot carry authority field grantRef/,
  );
  assert.throws(
    () => validateWebUsage({ ...usage, decision: "allow" }),
    /cannot carry authority field decision/,
  );
});

test("provider interface is capability-based and provider-neutral", () => {
  const provider = {
    schema: WEB_PROVIDER_SCHEMA,
    providerId: "provider-a",
    capabilities: ["search", "extract"],
    async search() {},
    async extract() {},
  };
  assert.equal(assertWebProvider(provider), provider);
  assert.throws(() => assertWebProvider({ ...provider, providerId: "Provider A" }), TypeError);
  assert.throws(() => assertWebProvider({ ...provider, search: undefined }), /implement search/);
  assert.throws(() => assertWebProvider({ ...provider, capabilities: ["magic"] }), TypeError);
});
