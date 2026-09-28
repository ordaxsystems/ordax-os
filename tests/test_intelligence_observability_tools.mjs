import assert from "node:assert/strict";
import test from "node:test";

import { NETWORK_STATUS_SCHEMA } from "../system/contracts/network-status.mjs";
import { POWER_STATUS_SCHEMA } from "../system/contracts/power-status.mjs";
import { createIntelligenceAgentRegistry } from "../system/services/intelligence/agent-registry.mjs";
import { createIntelligenceAuditJournal } from "../system/services/intelligence/audit-journal.mjs";
import { createIntelligenceCapabilityBridge } from "../system/services/intelligence/capability-bridge.mjs";
import {
  createIntelligenceReadOnlyToolExecutor,
  createNetworkStatusIntelligenceToolHandler,
  createPowerStatusIntelligenceToolHandler,
} from "../system/services/intelligence/readonly-tool-executor.mjs";
import { createIntelligenceToolAuthorizationBroker } from "../system/services/intelligence/tool-authorization.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function runtime() {
  let grantOrdinal = 0;
  let auditOrdinal = 0;
  let authorizationReceiptOrdinal = 0;
  let executionReceiptOrdinal = 0;
  const now = () => 3_000_000;
  const tools = createIntelligenceToolRegistry();
  const journal = createIntelligenceAuditJournal();
  const authorization = createIntelligenceToolAuthorizationBroker({
    agentRegistry: createIntelligenceAgentRegistry(),
    toolRegistry: tools,
    capabilityBridge: createIntelligenceCapabilityBridge({ registry: tools }),
    auditJournal: journal,
    bindings: [{
      agentId: "system",
      toolIds: ["observe-network-status", "observe-power-status"],
    }],
    getCapabilityIds: () => ["network.status", "power.status"],
    now,
    createGrantId: () => `tool-grant-${String(++grantOrdinal).padStart(16, "0")}`,
    createAuditRef: () => `tool-audit-${String(++auditOrdinal).padStart(16, "0")}`,
    createReceiptId: () => `tool-receipt-${String(++authorizationReceiptOrdinal).padStart(16, "0")}`,
  });

  const networkStatus = Object.freeze({
    schema: NETWORK_STATUS_SCHEMA,
    async read() {
      return {
        interfaces: [
          { name: "wlan-private-device", kind: "wifi", state: "connected", signalDbm: -52 },
          { name: "eth-secret-dock", kind: "ethernet", state: "disconnected", signalDbm: null },
        ],
      };
    },
  });
  const powerStatus = Object.freeze({
    schema: POWER_STATUS_SCHEMA,
    async read() {
      return {
        battery: { percent: 73, state: "discharging" },
        externalPower: false,
      };
    },
  });
  const executor = createIntelligenceReadOnlyToolExecutor({
    authorizationBroker: authorization,
    toolRegistry: tools,
    auditJournal: journal,
    handlers: [
      createNetworkStatusIntelligenceToolHandler(networkStatus),
      createPowerStatusIntelligenceToolHandler(powerStatus),
    ],
    now,
    createReceiptId: () => `tool-exec-receipt-${String(++executionReceiptOrdinal).padStart(16, "0")}`,
  });

  return { authorization, executor, journal };
}

function issueAndClaim(authorization, toolId, targetScope) {
  const targetId = "device-local";
  const grant = authorization.issue({
    agentId: "system",
    toolId,
    targetScope,
    targetId,
    ttlMs: 60_000,
  });
  return {
    grant,
    claim: {
      grantId: grant.id,
      agentId: "system",
      toolId,
      targetScope,
      targetId,
    },
  };
}

test("network observation is governed and strips interface identifiers from model context", async () => {
  const value = runtime();
  const { grant, claim } = issueAndClaim(
    value.authorization,
    "observe-network-status",
    "network",
  );
  const { result, receipt } = await value.executor.execute(claim);

  assert.equal(result.toolId, "observe-network-status");
  assert.equal(result.capabilityId, "network.status");
  assert.equal(result.context[0].provenance, "ordax:tool:observe-network-status:local-read-only");
  const payload = JSON.parse(result.context[0].text);
  assert.deepEqual(payload, {
    interfaces: [
      { ordinal: 1, kind: "wifi", state: "connected", signalDbm: -52 },
      { ordinal: 2, kind: "ethernet", state: "disconnected", signalDbm: null },
    ],
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("wlan-private-device"), false);
  assert.equal(serialized.includes("eth-secret-dock"), false);
  assert.equal(receipt.auditRef, grant.auditRef);
  assert.deepEqual(
    value.journal.listByAuditRef(grant.auditRef).map((entry) => [entry.kind, entry.event]),
    [
      ["authorization", "issued"],
      ["authorization", "claimed"],
      ["execution", "succeeded"],
    ],
  );
});

test("power observation returns only validated battery and external-power state", async () => {
  const value = runtime();
  const { grant, claim } = issueAndClaim(
    value.authorization,
    "observe-power-status",
    "power",
  );
  const { result } = await value.executor.execute(claim);

  assert.equal(result.toolId, "observe-power-status");
  assert.equal(result.capabilityId, "power.status");
  assert.equal(result.context[0].provenance, "ordax:tool:observe-power-status:local-read-only");
  assert.deepEqual(JSON.parse(result.context[0].text), {
    battery: { percent: 73, state: "discharging" },
    externalPower: false,
  });
  assert.deepEqual(
    value.journal.listByAuditRef(grant.auditRef).map((entry) => entry.event),
    ["issued", "claimed", "succeeded"],
  );
});

test("observability tools still require explicit agent bindings and matching capability inventory", () => {
  const tools = createIntelligenceToolRegistry();
  const authorization = createIntelligenceToolAuthorizationBroker({
    agentRegistry: createIntelligenceAgentRegistry(),
    toolRegistry: tools,
    capabilityBridge: createIntelligenceCapabilityBridge({ registry: tools }),
    bindings: [{ agentId: "system", toolIds: ["observe-network-status"] }],
    getCapabilityIds: () => ["power.status"],
  });

  assert.throws(
    () => authorization.issue({
      agentId: "system",
      toolId: "observe-network-status",
      targetScope: "network",
      targetId: "device-local",
      ttlMs: 60_000,
    }),
    /capability network.status is unavailable/,
  );
  assert.throws(
    () => authorization.issue({
      agentId: "system",
      toolId: "observe-power-status",
      targetScope: "power",
      targetId: "device-local",
      ttlMs: 60_000,
    }),
    /no explicit binding/,
  );
});
