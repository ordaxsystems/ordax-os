import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import { createIntelligenceAgentRegistry } from "../system/services/intelligence/agent-registry.mjs";
import { createIntelligenceCapabilityBridge } from "../system/services/intelligence/capability-bridge.mjs";
import {
  createIntelligenceReadOnlyToolExecutor,
  createSystemMetricsIntelligenceToolHandler,
} from "../system/services/intelligence/readonly-tool-executor.mjs";
import { createIntelligenceToolAuthorizationBroker } from "../system/services/intelligence/tool-authorization.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function fixture({ failingHandler = false } = {}) {
  let clock = 2_000_000;
  let grantOrdinal = 0;
  let auditOrdinal = 0;
  let authorizationReceiptOrdinal = 0;
  let executionReceiptOrdinal = 0;
  let reads = 0;

  const agents = createIntelligenceAgentRegistry();
  const tools = createIntelligenceToolRegistry();
  const bridge = createIntelligenceCapabilityBridge({ registry: tools });
  const authorization = createIntelligenceToolAuthorizationBroker({
    agentRegistry: agents,
    toolRegistry: tools,
    capabilityBridge: bridge,
    bindings: [{ agentId: "system", toolIds: ["observe-system-metrics"] }],
    getCapabilityIds: () => ["system.metrics"],
    now: () => clock,
    createGrantId: () => `tool-grant-${String(++grantOrdinal).padStart(16, "0")}`,
    createAuditRef: () => `tool-audit-${String(++auditOrdinal).padStart(16, "0")}`,
    createReceiptId: () => `tool-receipt-${String(++authorizationReceiptOrdinal).padStart(16, "0")}`,
  });
  const systemMetrics = Object.freeze({
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      reads += 1;
      if (failingHandler) throw new Error("private adapter detail must not escape");
      return {
        uptimeSeconds: 123,
        memoryTotalBytes: 16_000,
        memoryAvailableBytes: 6_000,
        userStorageTotalBytes: 100_000,
        userStorageFreeBytes: 40_000,
      };
    },
  });
  const executor = createIntelligenceReadOnlyToolExecutor({
    authorizationBroker: authorization,
    toolRegistry: tools,
    handlers: [createSystemMetricsIntelligenceToolHandler(systemMetrics)],
    now: () => clock,
    createReceiptId: () => `tool-exec-receipt-${String(++executionReceiptOrdinal).padStart(16, "0")}`,
  });

  return {
    authorization,
    executor,
    tools,
    getReads: () => reads,
    tick(ms = 1) {
      clock += ms;
    },
  };
}

function issue(authorization) {
  return authorization.issue({
    agentId: "system",
    toolId: "observe-system-metrics",
    targetScope: "system",
    targetId: "device-local",
    ttlMs: 60_000,
  });
}

function claim(grant, overrides = {}) {
  return {
    grantId: grant.id,
    agentId: "system",
    toolId: "observe-system-metrics",
    targetScope: "system",
    targetId: "device-local",
    ...overrides,
  };
}

test("system metrics executes only after a matching one-shot grant is claimed", async () => {
  const runtime = fixture();
  const grant = issue(runtime.authorization);
  assert.equal(runtime.getReads(), 0);

  const { result, receipt } = await runtime.executor.execute(claim(grant));
  assert.equal(runtime.getReads(), 1);
  assert.equal(result.toolId, "observe-system-metrics");
  assert.equal(result.capabilityId, "system.metrics");
  assert.equal(result.executionOccurred, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.networkEgress, false);
  assert.equal(result.mutatedState, false);
  assert.equal(result.authority, "none");
  assert.equal(result.context.length, 1);
  assert.equal(result.context[0].scope, "system");
  assert.equal(result.context[0].provenance, "ordax:tool:observe-system-metrics:local-read-only");
  assert.deepEqual(JSON.parse(result.context[0].text), {
    uptimeSeconds: 123,
    memoryTotalBytes: 16_000,
    memoryAvailableBytes: 6_000,
    userStorageTotalBytes: 100_000,
    userStorageFreeBytes: 40_000,
  });
  assert.equal(receipt.event, "succeeded");
  assert.equal(receipt.auditRef, grant.auditRef);
  assert.equal(JSON.stringify(receipt).includes(grant.id), false);
  assert.equal(JSON.stringify(receipt).includes("device-local"), false);
  assert.deepEqual(
    runtime.authorization.listReceipts().map((entry) => entry.event),
    ["issued", "claimed"],
  );

  await assert.rejects(() => runtime.executor.execute(claim(grant)), /unavailable or already claimed/);
  assert.equal(runtime.getReads(), 1);
  runtime.executor.dispose();
  runtime.authorization.dispose();
});

test("mismatched claims fail before any read and preserve the grant", async () => {
  const runtime = fixture();
  const grant = issue(runtime.authorization);

  await assert.rejects(
    () => runtime.executor.execute(claim(grant, { targetId: "different-device" })),
    /does not match/,
  );
  assert.equal(runtime.getReads(), 0);
  assert.equal(runtime.authorization.describe(grant.id).id, grant.id);

  await runtime.executor.execute(claim(grant));
  assert.equal(runtime.getReads(), 1);
  runtime.executor.dispose();
  runtime.authorization.dispose();
});

test("adapter failure consumes the one-shot grant and emits a sanitized failed execution receipt", async () => {
  const runtime = fixture({ failingHandler: true });
  const grant = issue(runtime.authorization);

  await assert.rejects(
    () => runtime.executor.execute(claim(grant)),
    (error) => {
      assert.equal(error.message, "Intelligence read-only tool execution failed");
      assert.equal(error.message.includes("private adapter detail"), false);
      return true;
    },
  );
  assert.equal(runtime.getReads(), 1);
  assert.throws(() => runtime.authorization.describe(grant.id), /unavailable or already claimed/);
  const receipts = runtime.executor.listReceipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].event, "failed");
  assert.equal(receipts[0].executionOccurred, true);
  assert.equal(receipts[0].readOnly, true);
  assert.equal(receipts[0].networkEgress, false);
  assert.equal(receipts[0].mutatedState, false);
  assert.equal(JSON.stringify(receipts).includes("private adapter detail"), false);
  runtime.executor.dispose();
  runtime.authorization.dispose();
});

test("executor rejects handlers for tools that remain non-invocable", () => {
  const runtime = fixture();
  assert.throws(
    () => createIntelligenceReadOnlyToolExecutor({
      authorizationBroker: runtime.authorization,
      toolRegistry: runtime.tools,
      handlers: [{
        toolId: "observe-network-status",
        capabilityId: "network.status",
        targetScope: "network",
        async execute() {
          return [];
        },
      }],
    }),
    /not enabled for governed invocation/,
  );
  runtime.executor.dispose();
  runtime.authorization.dispose();
});
