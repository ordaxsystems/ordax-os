import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_AUDIT_METADATA_SCHEMA,
  createWebExtractAuditMetadata,
  createWebSearchAuditMetadata,
} from "../system/services/web-research/audit-metadata.mjs";

const SEARCH_REF = `ordax-web:search:sha256:${"a".repeat(64)}`;
const EXTRACT_REF = `ordax-web:extract:sha256:${"b".repeat(64)}`;

test("search audit metadata preserves useful bounds without retaining query or domains", () => {
  const secretQuery = "private-customer-acquisition-question-9472";
  const privateDomain = "sensitive-example.test";
  const value = createWebSearchAuditMetadata({
    query: secretQuery,
    locale: "pt-BR",
    freshness: "recent",
    domains: {
      include: [privateDomain],
      exclude: ["blocked-example.test"],
    },
    limits: {
      maxResults: 5,
      maxRequests: 2,
      maxExternalBytes: 100_000,
      maxCostUsd: 0.02,
      deadlineMs: 4_000,
    },
    cache: { mode: "provider-policy" },
  }, SEARCH_REF);

  assert.equal(value.schema, WEB_AUDIT_METADATA_SCHEMA);
  assert.equal(value.operation, "search");
  assert.equal(value.resourceRef, SEARCH_REF);
  assert.equal(value.queryChars, secretQuery.length);
  assert.equal(value.locale, "pt-BR");
  assert.equal(value.freshness, "recent");
  assert.equal(value.includedDomainCount, 1);
  assert.equal(value.excludedDomainCount, 1);
  assert.equal(value.rawInputRetained, false);

  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(secretQuery), false);
  assert.equal(serialized.includes(privateDomain), false);
  assert.equal(serialized.includes("blocked-example.test"), false);
  assert.equal(serialized.includes("query"), true, "queryChars is metadata, not raw query content");
});

test("extract audit metadata retains only URL/origin counts and opaque resource identity", () => {
  const privatePath = "confidential-project-8831";
  const value = createWebExtractAuditMetadata({
    urls: [
      `https://docs.example.test/${privatePath}?account=private`,
      "https://docs.example.test/second",
      "https://other.example.test/third",
    ],
    limits: {
      maxResults: 3,
      maxRequests: 3,
      maxExternalBytes: 200_000,
      maxCostUsd: 0.03,
      deadlineMs: 5_000,
    },
    cache: { mode: "bypass" },
  }, EXTRACT_REF);

  assert.equal(value.schema, WEB_AUDIT_METADATA_SCHEMA);
  assert.equal(value.operation, "extract");
  assert.equal(value.resourceRef, EXTRACT_REF);
  assert.equal(value.urlCount, 3);
  assert.equal(value.distinctOriginCount, 2);
  assert.equal(value.rawInputRetained, false);

  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(privatePath), false);
  assert.equal(serialized.includes("docs.example.test"), false);
  assert.equal(serialized.includes("other.example.test"), false);
  assert.equal(serialized.includes("account=private"), false);
});

test("audit metadata rejects resource refs from a different Web operation", () => {
  assert.throws(
    () => createWebSearchAuditMetadata({ query: "safe" }, EXTRACT_REF),
    /does not match/i,
  );
  assert.throws(
    () => createWebExtractAuditMetadata({ urls: ["https://example.test/"] }, SEARCH_REF),
    /does not match/i,
  );
});
