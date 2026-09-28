import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import { createIntelligenceAgentRegistry } from "../system/services/intelligence/agent-registry.mjs";
import { createIntelligenceAuditJournal } from "../system/services/intelligence/audit-journal.mjs";
import { createIntelligenceCapabilityBridge } from "../system/services/intelligence/capability-bridge.mjs";
import {
  createIntelligenceReadOnlyToolExecutor,
  createSystemMetricsIntelligenceToolHandler,
} from "../system/services/intelligence/readonly-tool-executor.mjs";
import { createIntelligenceToolAuthorizationBroker } from "../system/services/intelligence/tool-authorization.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function harness({ journalLimit = 256, read = null } = {}) {
  let now = 1_000_000;
  let grantOrdinal = 0;
  let auditOrdinal = 0;
  let authorizationReceiptOrdinal = 0;
  let executionReceiptOrdinal = 0;
  const journal = createIntelligenceAuditJournal({ limit: journalLimit });
  const agents = createIntelligenceAgentRegistry();
  const tools = createIntelligenceToolRegistry();
  const bridge = createIntelligenceCapabilityBridge({ registry: tools });
  const authorization = createIntelligenceToolAuthorizationBroker({
    agentRegistry: agents,
    toolRegistry: tools,
    capabilityBridge: bridge,
    auditJournal: journal,
    bindings: [{ agentId: "system", toolIds: ["observe-system-metrics"] }],
    getCapabilityIds: () => ["system.metrics"],
    now: () => now,
    createGrantId: () => `tool-grant-${String(++grantOrdinal).padStart(16, "0")}`,
    createAuditRef: () => `tool-audit-${String(++auditOrdinal).padStart(16, "0")}`,
    createReceiptId: () => `tool-receipt-${String(++authorizationReceiptOrdinal).padStart(16, "0")}`,
  });
  const metrics = Object.freeze({
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      if (read) return read();
      return {
        uptimeSeconds: 3600,
        memoryTotalBytes: 8_000_000_000,
        memoryAvailableBytes: 4_000_000_000,
        userStorageTotalBytes: 64_000_000_000,
        userStorageFreeBytes: 24_000_000_000,
      };
    },
  });
  const executor = createIntelligenceReadOnlyToolExecutor({
    authorizationBroker: authorization,
    toolRegistry: tools,
    auditJournal: journal,
    handlers: [createSystemMetricsIntelligenceToolHandler(metrics)],
    now: () => now,
    createReceiptId: () => `tool-exec-receipt-${String(++executionReceiptOrdinal).padStart(16, "0")}`,
  });
  return {
    journal,
    authorization,
    executor,
    setNow(value) {
      now = value;
    },
  };
}

function request(targetId = "device-local") {
  return {
    agentId: "system",
    toolId: "observe-system-metrics",
    targetScope: "system",
    targetId,
    ttlMs: 60_000,
  };
}

function claim(grant, targetId = "device-local") {
  return {
    grantId: grant.id,
    agentId: "system",
    toolId: "observe-system-metrics",
    targetScope: "system",
    targetId,
  };
}

test("audit journal correlates authorization and execution without bearer or target data", async () => {
  const runtime = harness();
  const grant = runtime.authorization.issue(request());
  const outcome = await runtime.executor.execute(claim(grant));

  assert.equal(outcome.receipt.auditRef, grant.auditRef);
  const entries = runtime.journal.listByAuditRef(grant.auditRef);
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.event, entry.executionOccurred]),
    [
      ["authorization", "issued", false],
      ["authorization", "claimed", false],
      ["execution", "succeeded", true],
    ],
  );
  assert.deepEqual(entries.map((entry) => entry.sequence), [1, 2, 3]);

  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes(grant.id), false);
  assert.equal(serialized.includes("device-local"), false);
  assert.equal(serialized.includes("grantId"), false);
  assert.equal(serialized.includes("targetId"), false);
  assert.ok(entries.every((entry) => entry.readOnly === true));
  assert.ok(entries.every((entry) => entry.networkEgress === false));
  assert.ok(entries.every((entry) => entry.mutatedState === false));
  assert.ok(entries.every((entry) => entry.authority === "none"));
});

test("failed read-only execution records a sanitized correlated failure", async () => {
  const runtime = harness({
    read: async () => {
      throw new Error("private adapter detail: /home/user/secret");
    },
  });
  const grant = runtime.authorization.issue(request("private-target"));

  await assert.rejects(
    runtime.executor.execute(claim(grant, "private-target")),
    /read-only tool execution failed/,
  );

  const entries = runtime.journal.listByAuditRef(grant.auditRef);
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.event]),
    [
      ["authorization", "issued"],
      ["authorization", "claimed"],
      ["execution", "failed"],
    ],
  );
  const serialized = JSON.stringify(entries);
  assert.equal(serialized.includes("private-target"), false);
  assert.equal(serialized.includes("private adapter detail"), false);
  assert.equal(serialized.includes("/home/user/secret"), false);
});

test("audit journal rotates within its bound while preserving monotonic sequence", () => {
  const runtime = harness({ journalLimit: 2 });
  const first = runtime.authorization.issue(request("device-1"));
  runtime.authorization.revoke(first.id);
  const second = runtime.authorization.issue(request("device-2"));

  const entries = runtime.journal.list();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.sequence), [2, 3]);
  assert.deepEqual(entries.map((entry) => entry.event), ["revoked", "issued"]);
  assert.equal(Object.isFrozen(entries), true);
  assert.equal(Object.isFrozen(entries[0]), true);
  assert.deepEqual(runtime.journal.listByAuditRef(first.auditRef).map((entry) => entry.event), ["revoked"]);
  assert.deepEqual(runtime.journal.listByAuditRef(second.auditRef).map((entry) => entry.event), ["issued"]);
});

test("audit journal exposes no raw append or deletion authority", () => {
  const { journal } = harness();
  assert.equal(typeof journal.append, "undefined");
  assert.equal(typeof journal.appendRaw, "undefined");
  assert.equal(typeof journal.clear, "undefined");
  assert.equal(typeof journal.remove, "undefined");
  assert.equal(typeof journal.register, "undefined");
});

test("mismatched grant claims never create execution audit entries", async () => {
  const runtime = harness();
  const grant = runtime.authorization.issue(request("device-local"));

  await assert.rejects(
    runtime.executor.execute(claim(grant, "another-device")),
    /does not match/,
  );

  assert.deepEqual(
    runtime.journal.listByAuditRef(grant.auditRef).map((entry) => [entry.kind, entry.event]),
    [["authorization", "issued"]],
  );
  assert.equal(runtime.authorization.describe(grant.id).id, grant.id);
});
