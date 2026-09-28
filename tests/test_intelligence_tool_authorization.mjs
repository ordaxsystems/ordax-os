import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_TOOL_AUTHORIZATION_BROKER_SCHEMA,
  validateIntelligenceToolAuthorizationRequest,
} from "../system/contracts/intelligence-tool-authorization.mjs";
import { createIntelligenceAgentRegistry } from "../system/services/intelligence/agent-registry.mjs";
import { createIntelligenceCapabilityBridge } from "../system/services/intelligence/capability-bridge.mjs";
import { createIntelligenceToolAuthorizationBroker } from "../system/services/intelligence/tool-authorization.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function runtime({ capabilityIds = ["system.metrics"], bindings = [{ agentId: "system", toolIds: ["observe-system-metrics"] }] } = {}) {
  let clock = 1_000_000;
  let grantOrdinal = 0;
  let auditOrdinal = 0;
  let receiptOrdinal = 0;
  const agents = createIntelligenceAgentRegistry();
  const tools = createIntelligenceToolRegistry();
  const bridge = createIntelligenceCapabilityBridge({ registry: tools });
  const broker = createIntelligenceToolAuthorizationBroker({
    agentRegistry: agents,
    toolRegistry: tools,
    capabilityBridge: bridge,
    bindings,
    getCapabilityIds: () => capabilityIds,
    now: () => clock,
    createGrantId: () => `tool-grant-${String(++grantOrdinal).padStart(16, "0")}`,
    createAuditRef: () => `tool-audit-${String(++auditOrdinal).padStart(16, "0")}`,
    createReceiptId: () => `tool-receipt-${String(++receiptOrdinal).padStart(16, "0")}`,
  });
  return {
    broker,
    setClock(value) {
      clock = value;
    },
  };
}

function request(overrides = {}) {
  return {
    agentId: "system",
    toolId: "observe-system-metrics",
    targetScope: "system",
    targetId: "device-local",
    ttlMs: 60_000,
    ...overrides,
  };
}

test("tool authorization is explicit, one-shot and does not execute a tool", () => {
  const { broker } = runtime();
  assert.equal(broker.schema, INTELLIGENCE_TOOL_AUTHORIZATION_BROKER_SCHEMA);
  assert.equal(typeof broker.execute, "undefined");
  assert.equal(typeof broker.invoke, "undefined");

  const grant = broker.issue(request());
  assert.equal(grant.agentId, "system");
  assert.equal(grant.toolId, "observe-system-metrics");
  assert.equal(grant.capabilityId, "system.metrics");
  assert.equal(grant.oneShot, true);
  assert.equal(grant.readOnly, true);
  assert.equal(grant.networkEgress, false);
  assert.equal(grant.mutatesState, false);
  assert.equal(grant.executionEnabled, false);
  assert.equal(grant.authority, "none");

  const claimed = broker.claim({
    grantId: grant.id,
    agentId: "system",
    toolId: "observe-system-metrics",
    targetScope: "system",
    targetId: "device-local",
  });
  assert.equal(claimed.id, grant.id);
  assert.throws(
    () => broker.claim({
      grantId: grant.id,
      agentId: "system",
      toolId: "observe-system-metrics",
      targetScope: "system",
      targetId: "device-local",
    }),
    /unavailable or already claimed/,
  );

  const receipts = broker.listReceipts();
  assert.deepEqual(receipts.map((entry) => entry.event), ["issued", "claimed"]);
  assert.ok(receipts.every((entry) => entry.executionOccurred === false));
  assert.ok(receipts.every((entry) => entry.auditRef === grant.auditRef));
  assert.equal(JSON.stringify(receipts).includes(grant.id), false);
  assert.equal(JSON.stringify(receipts).includes("device-local"), false);
  broker.dispose();
});

test("agent identity alone never grants access to a tool", () => {
  const { broker } = runtime({ bindings: [] });
  assert.throws(
    () => broker.issue(request()),
    /no explicit binding/,
  );
  assert.deepEqual(broker.listReceipts(), []);
  broker.dispose();
});

test("tool authorization requires the real capability inventory and approved scope", () => {
  const unavailable = runtime({ capabilityIds: [] });
  assert.throws(
    () => unavailable.broker.issue(request()),
    /capability system.metrics is unavailable/,
  );
  unavailable.broker.dispose();

  const wrongScope = runtime();
  assert.throws(
    () => wrongScope.broker.issue(request({ targetScope: "network" })),
    /does not accept scope network/,
  );
  wrongScope.broker.dispose();
});

test("grant claim is bound to agent, tool, scope and target", () => {
  const { broker } = runtime();
  const grant = broker.issue(request());
  assert.throws(
    () => broker.claim({
      grantId: grant.id,
      agentId: "system",
      toolId: "observe-system-metrics",
      targetScope: "system",
      targetId: "another-device",
    }),
    /does not match/,
  );
  assert.equal(broker.describe(grant.id).id, grant.id);
  assert.equal(broker.revoke(grant.id), true);
  assert.deepEqual(broker.listReceipts().map((entry) => entry.event), ["issued", "revoked"]);
  broker.dispose();
});

test("expired grants fail closed and create only an authorization receipt", () => {
  const runtimeValue = runtime();
  const grant = runtimeValue.broker.issue(request({ ttlMs: 1000 }));
  runtimeValue.setClock(1_001_000);
  assert.throws(() => runtimeValue.broker.describe(grant.id), /expired/);
  const receipts = runtimeValue.broker.listReceipts();
  assert.deepEqual(receipts.map((entry) => entry.event), ["issued", "expired"]);
  assert.ok(receipts.every((entry) => entry.executionOccurred === false));
  runtimeValue.broker.dispose();
});

test("authorization request rejects hidden authority or execution fields", () => {
  for (const extra of [
    { authority: "system" },
    { command: "uname -a" },
    { url: "https://example.org" },
    { executionEnabled: true },
    { capabilityId: "system.metrics" },
  ]) {
    assert.throws(
      () => validateIntelligenceToolAuthorizationRequest({ ...request(), ...extra }),
      /field .* is not allowed/,
    );
  }
});

test("binding policy rejects unknown tools and duplicate agent policies", () => {
  assert.throws(
    () => runtime({ bindings: [{ agentId: "system", toolIds: ["unknown-tool"] }] }),
    /Unknown Intelligence tool/,
  );
  assert.throws(
    () => runtime({
      bindings: [
        { agentId: "system", toolIds: ["observe-system-metrics"] },
        { agentId: "system", toolIds: ["observe-network-status"] },
      ],
    }),
    /Duplicate Intelligence tool binding/,
  );
});
