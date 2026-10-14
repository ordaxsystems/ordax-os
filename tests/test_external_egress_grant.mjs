import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_EGRESS_GRANT_ISSUE_SCHEMA,
  EXTERNAL_EGRESS_GRANT_SCHEMA,
  EXTERNAL_EGRESS_MAX_TTL_MS,
  validateExternalEgressGrant,
  validateExternalEgressGrantIssue,
} from "../system/contracts/external-egress-grant.mjs";

const NOW = Date.parse("2026-10-14T15:00:00.000Z");
const SHA = "b".repeat(64);

function issue(overrides = {}) {
  return {
    schema: EXTERNAL_EGRESS_GRANT_ISSUE_SCHEMA,
    workItemId: "work-1",
    approvalId: "approval-1",
    toolId: "ordax.web-research",
    toolArtifactSha256: SHA,
    actionId: "web.search",
    effect: "external-egress",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: `ordax-web:search:sha256:${"c".repeat(64)}`,
    destinations: ["https://api.example.com"],
    maxRequests: 3,
    maxExternalBytes: 1_000_000,
    maxCostUsd: 0.05,
    deadlineMs: 10_000,
    approvedBy: "user",
    requestedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    ...overrides,
  };
}

test("egress issue binds exact action/resource/destination and bounded budgets", () => {
  const value = validateExternalEgressGrantIssue(issue({
    destinations: ["https://API.EXAMPLE.COM/"],
  }));
  assert.ok(Object.isFrozen(value));
  assert.equal(value.effect, "external-egress");
  assert.deepEqual(value.destinations, ["https://api.example.com"]);
  assert.equal(value.approvedBy, "user");
  assert.equal(Object.hasOwn(value, "issuedAt"), false);
});

test("egress grant accepts the issued shape only", () => {
  const request = validateExternalEgressGrantIssue(issue());
  const grant = validateExternalEgressGrant({
    schema: EXTERNAL_EGRESS_GRANT_SCHEMA,
    grantId: "egress-grant-1",
    workItemId: request.workItemId,
    approvalId: request.approvalId,
    toolId: request.toolId,
    toolArtifactSha256: request.toolArtifactSha256,
    actionId: request.actionId,
    effect: request.effect,
    ownerKind: request.ownerKind,
    ownerId: request.ownerId,
    spaceId: request.spaceId,
    projectId: request.projectId,
    resourceRef: request.resourceRef,
    destinations: request.destinations,
    maxRequests: request.maxRequests,
    maxExternalBytes: request.maxExternalBytes,
    maxCostUsd: request.maxCostUsd,
    deadlineMs: request.deadlineMs,
    approvedBy: request.approvedBy,
    issuedAt: request.requestedAt,
    expiresAt: request.expiresAt,
  });
  assert.equal(grant.schema, EXTERNAL_EGRESS_GRANT_SCHEMA);
  assert.equal(grant.grantId, "egress-grant-1");
  assert.equal(grant.resourceRef, request.resourceRef);
});

test("egress contract rejects broad or unsafe network scope", () => {
  for (const destinations of [
    [],
    ["http://api.example.com"],
    ["https://api.example.com/path"],
    ["https://api.example.com:8443"],
    ["https://user:pass@api.example.com"],
    ["https://*.example.com"],
    ["https://localhost"],
    ["https://127.0.0.1"],
    ["https://[::1]"],
    ["https://api.example.com", "https://API.EXAMPLE.COM/"],
  ]) {
    assert.throws(() => validateExternalEgressGrantIssue(issue({ destinations })), TypeError);
  }
});

test("egress contract rejects authority without exact user approval and bounded lifetime", () => {
  assert.throws(() => validateExternalEgressGrantIssue(issue({ approvedBy: "model" })), /explicit user approval/);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ effect: "read" })), /effect is incompatible/);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ resourceRef: "" })), TypeError);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ toolArtifactSha256: "bad" })), TypeError);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ maxRequests: 0 })), TypeError);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ maxExternalBytes: 0 })), TypeError);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ maxCostUsd: -1 })), TypeError);
  assert.throws(() => validateExternalEgressGrantIssue(issue({ deadlineMs: 100 })), TypeError);
  assert.throws(
    () => validateExternalEgressGrantIssue(issue({ expiresAt: new Date(NOW + EXTERNAL_EGRESS_MAX_TTL_MS + 1).toISOString() })),
    /exceeds the bounded TTL/,
  );
});

test("egress grant cannot smuggle credentials or unsupported fields", () => {
  for (const changed of [
    { apiKey: "secret" },
    { Authorization: "Bearer secret" },
    { cookies: "a=b" },
    { modelAuthority: "allow" },
  ]) {
    assert.throws(() => validateExternalEgressGrantIssue(issue(changed)), TypeError);
  }
});

test("device-owned grant cannot invent account identity", () => {
  assert.throws(
    () => validateExternalEgressGrantIssue(issue({ ownerKind: "device", ownerId: "user-1" })),
    /cannot invent an account owner id/,
  );
  const value = validateExternalEgressGrantIssue(issue({ ownerKind: "device", ownerId: null }));
  assert.equal(value.ownerId, null);
});
