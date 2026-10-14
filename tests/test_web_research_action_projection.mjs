import assert from "node:assert/strict";
import test from "node:test";

import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";
import {
  WEB_ACTION_PROJECTION_SCHEMA,
  WEB_EGRESS_PROJECTION_SCHEMA,
  createWebResearchActionProjection,
} from "../system/services/web-research/action-projection.mjs";

const NOW = Date.parse("2026-10-14T12:00:00-03:00");
const TOOL_SHA = "a".repeat(64);

function gateway({ resolverCalls } = {}) {
  return createPersonalOrdaxActionGateway({
    toolResolver() {
      if (resolverCalls) resolverCalls.count += 1;
      throw new Error("external egress must be denied before tool resolution");
    },
    grantResolver() {
      if (resolverCalls) resolverCalls.count += 1;
      throw new Error("external egress must be denied before grant resolution");
    },
    now: () => NOW,
  });
}

function context(overrides = {}) {
  return {
    workItemId: "work-web-1",
    approvalId: "approval-web-1",
    toolId: "ordax.web-research",
    toolArtifactSha256: TOOL_SHA,
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    ...overrides,
  };
}

function search(overrides = {}) {
  return {
    query: "latest OrdaX evidence",
    locale: "pt-BR",
    freshness: "current",
    limits: { maxResults: 5 },
    ...overrides,
  };
}

test("Web Research projects search through canonical external-egress authority and remains denied", () => {
  const resolverCalls = { count: 0 };
  const projection = createWebResearchActionProjection({
    actionGateway: gateway({ resolverCalls }),
    now: () => NOW,
  });
  assert.equal(projection.schema, WEB_ACTION_PROJECTION_SCHEMA);

  const value = projection.search(search(), context());
  assert.equal(value.schema, WEB_EGRESS_PROJECTION_SCHEMA);
  assert.equal(value.operation, "search");
  assert.equal(value.actionRequest.actionId, "web.search");
  assert.equal(value.actionRequest.effect, "external-egress");
  assert.match(value.actionRequest.resourceRef, /^ordax-web:search:sha256:[0-9a-f]{64}$/);
  assert.equal(value.actionRequest.ownerId, "user-1");
  assert.equal(value.decision.decision, "deny");
  assert.equal(value.decision.grantRef, null);
  assert.match(value.decision.reason, /cannot authorize egress/i);
  assert.equal(resolverCalls.count, 0);
  assert.equal(Object.hasOwn(value.webRequest, "grantRef"), false);
  assert.equal(Object.hasOwn(value.webRequest, "approvalId"), false);
});

test("grant references stay in the authority envelope and cannot leak into Web request", () => {
  const projection = createWebResearchActionProjection({
    actionGateway: gateway(),
    now: () => NOW,
  });

  const value = projection.search(search(), context(), { grantRef: "grant-web-1" });
  assert.equal(value.decision.decision, "deny");
  assert.equal(value.decision.grantRef, null);
  assert.equal(Object.hasOwn(value.webRequest, "grantRef"), false);

  assert.throws(
    () => projection.search({ ...search(), grantRef: "grant-web-1" }, context()),
    /cannot carry authority field grantRef/,
  );
});

test("resource binding is deterministic for normalized Web intent and changes with intent", () => {
  const projection = createWebResearchActionProjection({
    actionGateway: gateway(),
    now: () => NOW,
  });

  const first = projection.search(search(), context());
  const same = projection.search({ ...search(), query: "  latest OrdaX evidence  " }, context());
  const other = projection.search({ ...search(), query: "different evidence" }, context());

  assert.equal(first.actionRequest.resourceRef, same.actionRequest.resourceRef);
  assert.notEqual(first.actionRequest.resourceRef, other.actionRequest.resourceRef);
});

test("extract uses a distinct action/resource domain and remains fail closed", () => {
  const projection = createWebResearchActionProjection({
    actionGateway: gateway(),
    now: () => NOW,
  });
  const value = projection.extract(
    { urls: ["https://example.com/report"] },
    context(),
  );
  assert.equal(value.actionRequest.actionId, "web.extract");
  assert.equal(value.actionRequest.effect, "external-egress");
  assert.match(value.actionRequest.resourceRef, /^ordax-web:extract:sha256:[0-9a-f]{64}$/);
  assert.equal(value.decision.decision, "deny");
});

test("projection validates owner/tool context before consulting authority", () => {
  let decisions = 0;
  const actionGateway = {
    schema: "ordax.action-gateway/1",
    decide() {
      decisions += 1;
      throw new Error("must not be reached");
    },
  };
  const projection = createWebResearchActionProjection({ actionGateway, now: () => NOW });

  assert.throws(
    () => projection.search(search(), context({ toolArtifactSha256: "bad" })),
    /tool artifact sha256 is invalid/,
  );
  assert.equal(decisions, 0);
});
