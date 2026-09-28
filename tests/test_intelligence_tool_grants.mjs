import assert from "node:assert/strict";
import test from "node:test";

import { createIntelligenceAgentRegistry } from "../system/services/intelligence/agent-registry.mjs";
import { createIntelligenceToolGrantBroker } from "../system/services/intelligence/tool-grants.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function fixture({ nowValue = 5_000_000 } = {}) {
  let grantOrdinal = 0;
  let receiptOrdinal = 0;
  let clock = nowValue;
  const agents = createIntelligenceAgentRegistry();
  const tools = createIntelligenceToolRegistry();
  const broker = createIntelligenceToolGrantBroker({
    agentRegistry: agents,
    toolRegistry: tools,
    now: () => clock,
    createGrantId: () => `tool-grant-${String(++grantOrdinal).padStart(16, "0")}`,
    createReceiptId: () => `tool-receipt-${String(++receiptOrdinal).padStart(16, "0")}`,
  });
  return {
    agents,
    tools,
    broker,
    advance(ms) {
      clock += ms;
    },
  };
}

test("tool grants bind an explicit registered agent, tool and concrete target", () => {
  const { broker } = fixture();
  const target = Object.freeze({ kind: "device", id: "local-device" });
  const grant = broker.issue({
    agentId: "system",
    toolId: "observe-system-metrics",
    target,
  });

  assert.equal(grant.agentId, "system");
  assert.equal(grant.toolId, "observe-system-metrics");
  assert.equal(grant.capabilityId, "system.metrics");
  assert.deepEqual(grant.target, target);
  assert.deepEqual(grant.inputScopes, ["system"]);
  assert.equal(grant.oneShot, true);
  assert.equal(grant.readOnly, true);
  assert.equal(grant.networkEgress, false);
  assert.equal(grant.mutatesState, false);
  assert.equal(grant.authority, "none");
  assert.equal(grant.executable, false);
  assert.equal(grant.toolExecution, false);

  const consumed = broker.consume(grant.id, {
    agentId: "system",
    toolId: "observe-system-metrics",
    target,
  });
  assert.equal(consumed.id, grant.id);
  assert.throws(() => broker.describe(grant.id), /unavailable or already consumed/);
  assert.throws(
    () => broker.consume(grant.id, {
      agentId: "system",
      toolId: "observe-system-metrics",
      target,
    }),
    /unavailable or already consumed/,
  );

  const receipts = broker.listReceipts();
  assert.deepEqual(receipts.map((receipt) => receipt.event), ["issued", "consumed"]);
  for (const receipt of receipts) {
    assert.equal(receipt.executionOccurred, false);
    assert.equal(receipt.mutatedState, false);
    assert.equal(receipt.networkEgress, false);
    assert.equal(receipt.authority, "none");
    assert.equal(Object.hasOwn(receipt, "grantId"), false);
  }

  broker.dispose();
});

test("mismatched agent, tool or target cannot consume a grant", () => {
  const { broker } = fixture();
  const target = { kind: "device", id: "local-device" };
  const grant = broker.issue({
    agentId: "system",
    toolId: "observe-network-status",
    target,
  });

  assert.throws(
    () => broker.consume(grant.id, {
      agentId: "developer",
      toolId: "observe-network-status",
      target,
    }),
    /agent does not match/,
  );
  assert.throws(
    () => broker.consume(grant.id, {
      agentId: "system",
      toolId: "observe-power-status",
      target,
    }),
    /tool does not match/,
  );
  assert.throws(
    () => broker.consume(grant.id, {
      agentId: "system",
      toolId: "observe-network-status",
      target: { kind: "device", id: "another-device" },
    }),
    /target does not match/,
  );

  assert.equal(broker.describe(grant.id).id, grant.id);
  assert.deepEqual(broker.listReceipts().map((receipt) => receipt.event), ["issued"]);
  broker.dispose();
});

test("expired and revoked grants leave non-execution audit receipts", () => {
  const { broker, advance } = fixture();
  const first = broker.issue({
    agentId: "system",
    toolId: "observe-power-status",
    target: { kind: "device", id: "local-device" },
    ttlMs: 1_000,
  });
  advance(1_000);
  assert.throws(() => broker.describe(first.id), /expired/);

  const second = broker.issue({
    agentId: "workspace",
    toolId: "observe-system-metrics",
    target: { kind: "workspace", id: "workspace:1" },
  });
  assert.equal(broker.revoke(second.id), true);
  assert.equal(broker.revoke(second.id), false);

  assert.deepEqual(
    broker.listReceipts().map((receipt) => receipt.event),
    ["issued", "expired", "issued", "revoked"],
  );
  broker.dispose();
});

test("grant broker fails closed for unknown identities and non-concrete targets", () => {
  const { broker } = fixture();
  assert.throws(
    () => broker.issue({
      agentId: "unknown-agent",
      toolId: "observe-system-metrics",
      target: { kind: "device", id: "local-device" },
    }),
    /agent is not registered/,
  );
  assert.throws(
    () => broker.issue({
      agentId: "system",
      toolId: "unknown-tool",
      target: { kind: "device", id: "local-device" },
    }),
    /tool is not registered/,
  );
  assert.throws(
    () => broker.issue({
      agentId: "system",
      toolId: "observe-system-metrics",
      target: null,
    }),
    /concrete target/,
  );
  assert.deepEqual(broker.listReceipts(), []);
  broker.dispose();
});
