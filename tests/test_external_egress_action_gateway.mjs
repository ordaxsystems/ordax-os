import assert from "node:assert/strict";
import test from "node:test";

import { canExecutePersonalAction } from "../system/contracts/personal-ordax.mjs";
import { createExternalEgressGrantAuthority } from "../system/services/personal-ordax/external-egress-grants.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";

const START = Date.parse("2026-10-14T15:00:00.000Z");
const ARTIFACT = "a".repeat(64);
const RESOURCE = `ordax-web:search:sha256:${"b".repeat(64)}`;

function request(overrides = {}) {
  return {
    workItemId: "work-web-1",
    approvalId: "approval-web-1",
    actionId: "web.search",
    toolId: "ordax.web-research",
    toolArtifactSha256: ARTIFACT,
    effect: "external-egress",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: RESOURCE,
    reason: "Acquire current external evidence.",
    requestedAt: new Date(START).toISOString(),
    ...overrides,
  };
}

function grantIssue(now, overrides = {}) {
  return {
    workItemId: "work-web-1",
    approvalId: "approval-web-1",
    toolId: "ordax.web-research",
    toolArtifactSha256: ARTIFACT,
    actionId: "web.search",
    effect: "external-egress",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: RESOURCE,
    destinations: ["https://api.example.com"],
    maxRequests: 3,
    maxExternalBytes: 1_000_000,
    maxCostUsd: 0.05,
    deadlineMs: 10_000,
    approvedBy: "user",
    requestedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    ...overrides,
  };
}

function setup({ withEgressResolver = true } = {}) {
  let now = START;
  const regularResolverCalls = { count: 0 };
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver() {
      regularResolverCalls.count += 1;
      throw new Error("Intelligence tool resolver must not authorize external egress");
    },
    grantResolver() {
      regularResolverCalls.count += 1;
      throw new Error("Intelligence tool grant resolver must not authorize external egress");
    },
    externalEgressGrantResolver: withEgressResolver
      ? (grantId) => authority.registry.resolve(grantId)
      : null,
    now: () => now,
  });
  return {
    authority,
    gateway,
    regularResolverCalls,
    setNow(value) {
      now = value;
    },
  };
}

test("Action Gateway remains fail-closed when external egress authority is not wired", () => {
  const { gateway, regularResolverCalls } = setup({ withEgressResolver: false });
  const denied = gateway.decide(request(), { grantRef: "egress-grant-1" });
  assert.equal(denied.decision, "deny");
  assert.equal(denied.authoritySource, "user-grant");
  assert.equal(denied.grantRef, null);
  assert.match(denied.reason, /authority is unavailable/i);
  assert.equal(regularResolverCalls.count, 0);
});

test("Action Gateway requests explicit approval when egress authority exists but no grant is supplied", () => {
  const { gateway, regularResolverCalls } = setup();
  const value = gateway.decide(request());
  assert.equal(value.decision, "approval-required");
  assert.equal(value.authoritySource, "user-grant");
  assert.equal(value.grantRef, null);
  assert.equal(canExecutePersonalAction(value), false);
  assert.equal(regularResolverCalls.count, 0);
});

test("Action Gateway allows only the exact live external egress grant", () => {
  const { authority, gateway, regularResolverCalls } = setup();
  const grant = authority.issuer.issue(grantIssue(START));
  const value = gateway.decide(request(), { grantRef: grant.grantId });
  assert.equal(value.decision, "allow");
  assert.equal(value.authoritySource, "user-grant");
  assert.equal(value.grantRef, grant.grantId);
  assert.equal(canExecutePersonalAction(value), true);
  assert.equal(regularResolverCalls.count, 0);
});

test("Action Gateway denies every egress scope mismatch", () => {
  const { authority, gateway } = setup();
  const grant = authority.issuer.issue(grantIssue(START));
  const mismatches = [
    { workItemId: "work-web-2" },
    { approvalId: "approval-web-2" },
    { approvalId: null },
    { toolId: "ordax.other-tool" },
    { toolArtifactSha256: "c".repeat(64) },
    { actionId: "web.extract" },
    { ownerId: "user-2" },
    { spaceId: "space-2" },
    { projectId: "project-2" },
    { resourceRef: `ordax-web:search:sha256:${"d".repeat(64)}` },
  ];
  for (const changed of mismatches) {
    const value = gateway.decide(request(changed), { grantRef: grant.grantId });
    assert.equal(value.decision, "deny", JSON.stringify(changed));
    assert.equal(canExecutePersonalAction(value), false);
  }
});

test("revoked and expired external egress grants fail closed", () => {
  const first = setup();
  const revoked = first.authority.issuer.issue(grantIssue(START));
  assert.equal(first.authority.issuer.revoke(revoked.grantId), true);
  assert.equal(
    first.gateway.decide(request(), { grantRef: revoked.grantId }).decision,
    "deny",
  );

  const second = setup();
  const expiring = second.authority.issuer.issue(grantIssue(START, {
    expiresAt: new Date(START + 1_000).toISOString(),
  }));
  second.setNow(START + 1_001);
  assert.equal(
    second.gateway.decide(request(), { grantRef: expiring.grantId }).decision,
    "deny",
  );
});

test("external egress grant never authorizes device-control", () => {
  const { authority, gateway } = setup();
  const grant = authority.issuer.issue(grantIssue(START));
  const value = gateway.decide(
    request({ effect: "device-control" }),
    { grantRef: grant.grantId },
  );
  assert.equal(value.decision, "deny");
  assert.equal(value.grantRef, null);
  assert.equal(canExecutePersonalAction(value), false);
});
