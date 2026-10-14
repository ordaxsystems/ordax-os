import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_ADAPTER_EXECUTION_CONTEXT_SCHEMA,
  ACTION_ADAPTER_SCHEMA,
  ACTION_RECEIPT_SCHEMA,
} from "../system/contracts/action-executor.mjs";
import { createExternalEgressGrantAuthority } from "../system/services/personal-ordax/external-egress-grants.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";
import {
  createPersonalOrdaxActionExecutor,
  PersonalActionExecutionError,
} from "../system/services/personal-ordax/action-executor.mjs";

const START = Date.parse("2026-10-14T15:00:00.000Z");
const ARTIFACT = "d".repeat(64);
const RESOURCE = `ordax-web:search:sha256:${"e".repeat(64)}`;

function request(overrides = {}) {
  return {
    workItemId: "work-1",
    approvalId: "approval-1",
    toolId: "ordax.web-research",
    toolArtifactSha256: ARTIFACT,
    actionId: "web.search",
    effect: "external-egress",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    resourceRef: RESOURCE,
    reason: "Acquire explicitly approved external Web evidence.",
    requestedAt: new Date(START).toISOString(),
    ...overrides,
  };
}

function grantInput(now, overrides = {}) {
  return {
    workItemId: "work-1",
    approvalId: "approval-1",
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

function setup({ expiresInMs = 60_000 } = {}) {
  let now = START;
  const authority = createExternalEgressGrantAuthority({ now: () => now });
  const grant = authority.issuer.issue(grantInput(now, {
    expiresAt: new Date(now + expiresInMs).toISOString(),
  }));
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver: () => null,
    grantResolver: () => null,
    externalEgressGrantResolver: (grantRef) => authority.registry.resolve(grantRef),
    now: () => now,
  });
  return {
    authority,
    grant,
    gateway,
    now: () => now,
    advance(ms) {
      now += ms;
    },
  };
}

function executor({ gateway, adapterResolver, now }) {
  return createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver,
    now,
  });
}

test("revoked external-egress grant fails closed before adapter resolution", async () => {
  const state = setup();
  const actionRequest = request();
  const decision = state.gateway.decide(actionRequest, { grantRef: state.grant.grantId });
  assert.equal(decision.decision, "allow");

  assert.equal(state.authority.issuer.revoke(state.grant.grantId), true);
  let resolverCalls = 0;
  let adapterCalls = 0;
  const runtime = executor({
    gateway: state.gateway,
    now: state.now,
    adapterResolver() {
      resolverCalls += 1;
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: actionRequest.toolId,
        artifactSha256: ARTIFACT,
        actionId: actionRequest.actionId,
        effect: actionRequest.effect,
        async execute() {
          adapterCalls += 1;
          return { summary: "must not execute" };
        },
      };
    },
  });

  await assert.rejects(
    () => runtime.execute({ request: actionRequest, decision }),
    (error) => {
      assert.ok(error instanceof PersonalActionExecutionError);
      assert.equal(error.phase, "pre-side-effect");
      assert.match(error.message, /no longer valid/i);
      return true;
    },
  );
  assert.equal(resolverCalls, 0);
  assert.equal(adapterCalls, 0);
});

test("expired external-egress grant fails closed before adapter resolution", async () => {
  const state = setup({ expiresInMs: 1_000 });
  const actionRequest = request();
  const decision = state.gateway.decide(actionRequest, { grantRef: state.grant.grantId });
  assert.equal(decision.decision, "allow");

  state.advance(1_001);
  let resolverCalls = 0;
  const runtime = executor({
    gateway: state.gateway,
    now: state.now,
    adapterResolver() {
      resolverCalls += 1;
      throw new Error("expired authority must fail before adapter resolution");
    },
  });

  await assert.rejects(
    () => runtime.execute({ request: actionRequest, decision }),
    (error) => {
      assert.ok(error instanceof PersonalActionExecutionError);
      assert.equal(error.phase, "pre-side-effect");
      assert.match(error.message, /no longer valid/i);
      return true;
    },
  );
  assert.equal(resolverCalls, 0);
});

test("live egress authority reaches typed adapter only as minimal fresh execution context", async () => {
  const state = setup();
  const actionRequest = request();
  const staleDecision = state.gateway.decide(actionRequest, { grantRef: state.grant.grantId });
  assert.equal(staleDecision.decision, "allow");
  assert.equal(staleDecision.decidedAt, new Date(START).toISOString());

  state.advance(2_000);
  let adapterCalls = 0;
  const runtime = executor({
    gateway: state.gateway,
    now: state.now,
    adapterResolver(toolId, actionId) {
      assert.equal(toolId, actionRequest.toolId);
      assert.equal(actionId, actionRequest.actionId);
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId,
        artifactSha256: ARTIFACT,
        actionId,
        effect: "external-egress",
        async execute(receivedRequest, context) {
          adapterCalls += 1;
          assert.deepEqual(receivedRequest, actionRequest);
          assert.equal("grantRef" in receivedRequest, false);
          assert.deepEqual(Object.keys(context).sort(), [
            "authoritySource",
            "authorizedAt",
            "grantRef",
            "schema",
          ]);
          assert.equal(context.schema, ACTION_ADAPTER_EXECUTION_CONTEXT_SCHEMA);
          assert.equal(context.authoritySource, "user-grant");
          assert.equal(context.grantRef, state.grant.grantId);
          assert.equal(context.authorizedAt, new Date(START + 2_000).toISOString());
          assert.notEqual(context.authorizedAt, staleDecision.decidedAt);

          const liveGrant = state.authority.registry.resolve(context.grantRef);
          assert.equal(liveGrant, state.grant);
          assert.deepEqual(liveGrant.destinations, ["https://api.example.com"]);
          assert.equal(liveGrant.maxRequests, 2);
          assert.equal(liveGrant.maxExternalBytes, 500_000);
          assert.equal(liveGrant.maxCostUsd, 0.02);
          assert.equal(liveGrant.deadlineMs, 8_000);

          return {
            status: "succeeded",
            summary: "Authorized egress adapter boundary entered and completed.",
            artifactRefs: ["web-result:operation-1"],
          };
        },
      };
    },
  });

  const receipt = await runtime.execute({ request: actionRequest, decision: staleDecision });
  assert.equal(adapterCalls, 1);
  assert.equal(receipt.schema, ACTION_RECEIPT_SCHEMA);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.effect, "external-egress");
  assert.equal(receipt.resourceRef, RESOURCE);
  assert.equal(receipt.grantRef, state.grant.grantId);
  assert.deepEqual(receipt.artifactRefs, ["web-result:operation-1"]);
});

test("request payload cannot override the fresh adapter authorization context", async () => {
  const state = setup();
  const actionRequest = request();
  const decision = state.gateway.decide(actionRequest, { grantRef: state.grant.grantId });
  const injectedRequest = { ...actionRequest, grantRef: "forged-grant" };
  let adapterCalls = 0;

  const runtime = executor({
    gateway: state.gateway,
    now: state.now,
    adapterResolver() {
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: actionRequest.toolId,
        artifactSha256: ARTIFACT,
        actionId: actionRequest.actionId,
        effect: actionRequest.effect,
        async execute(receivedRequest, context) {
          adapterCalls += 1;
          assert.equal("grantRef" in receivedRequest, false);
          assert.equal(context.grantRef, state.grant.grantId);
          assert.notEqual(context.grantRef, injectedRequest.grantRef);
          return {
            status: "succeeded",
            summary: "Payload authority field was not propagated.",
            artifactRefs: [],
          };
        },
      };
    },
  });

  const receipt = await runtime.execute({ request: injectedRequest, decision });
  assert.equal(adapterCalls, 1);
  assert.equal(receipt.grantRef, state.grant.grantId);
});
