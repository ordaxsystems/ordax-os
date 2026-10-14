import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_EGRESS_GRANT_ISSUER_SCHEMA,
  EXTERNAL_EGRESS_GRANT_REGISTRY_SCHEMA,
} from "../system/contracts/external-egress-grant.mjs";
import { createExternalEgressGrantAuthority } from "../system/services/personal-ordax/external-egress-grants.mjs";

const START = Date.parse("2026-10-14T15:00:00.000Z");
const SHA = "d".repeat(64);

function issue(now, overrides = {}) {
  return {
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
    resourceRef: `ordax-web:search:sha256:${"e".repeat(64)}`,
    destinations: ["https://api.example.com"],
    maxRequests: 2,
    maxExternalBytes: 500_000,
    maxCostUsd: 0.02,
    deadlineMs: 8_000,
    approvedBy: "user",
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

test("egress authority issues, resolves and revokes exact grants", () => {
  let now = START;
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  assert.equal(authority.registry.schema, EXTERNAL_EGRESS_GRANT_REGISTRY_SCHEMA);
  assert.equal(authority.issuer.schema, EXTERNAL_EGRESS_GRANT_ISSUER_SCHEMA);

  const grant = authority.issuer.issue(issue(now, {
    requestedAt: new Date(now - 10_000).toISOString(),
  }));
  assert.equal(grant.grantId, "egress-grant-1");
  assert.equal(grant.effect, "external-egress");
  assert.equal(grant.issuedAt, new Date(now).toISOString());
  assert.equal(authority.registry.resolve(grant.grantId), grant);
  assert.equal(authority.issuer.revoke(grant.grantId), true);
  assert.equal(authority.registry.resolve(grant.grantId), null);
  assert.equal(authority.issuer.revoke(grant.grantId), false);
});

test("expired egress grants disappear from the registry", () => {
  let now = START;
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  const grant = authority.issuer.issue(issue(now, { expiresAt: new Date(now + 1_000).toISOString() }));
  assert.equal(authority.registry.resolve(grant.grantId), grant);
  now += 1_001;
  assert.equal(authority.registry.resolve(grant.grantId), null);
});

test("one explicit approval cannot be replayed to mint another egress grant", () => {
  let now = START;
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  authority.issuer.issue(issue(now));
  assert.throws(() => authority.issuer.issue(issue(now)), /already issued a grant/);

  const second = authority.issuer.issue(issue(now, {
    approvalId: "approval-2",
    resourceRef: `ordax-web:search:sha256:${"f".repeat(64)}`,
  }));
  assert.equal(second.grantId, "egress-grant-2");
});

test("authority rejects future or already expired approval windows", () => {
  let now = START;
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  assert.throws(
    () => authority.issuer.issue(issue(now + 31_000)),
    /approval time is in the future/,
  );
  assert.throws(
    () => authority.issuer.issue(issue(now - 120_000, {
      approvalId: "approval-old",
      expiresAt: new Date(now - 1).toISOString(),
    })),
    /already expired/,
  );
});

test("dispose clears authority and makes registry/issuer fail closed", () => {
  let now = START;
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  const grant = authority.issuer.issue(issue(now));
  authority.dispose();
  assert.throws(() => authority.registry.resolve(grant.grantId), /disposed/);
  assert.throws(() => authority.issuer.issue(issue(now, { approvalId: "approval-2" })), /disposed/);
});
