import {
  INTELLIGENCE_AGENT_REGISTRY_SCHEMA,
  validateIntelligenceAgentId,
} from "../../contracts/intelligence-agent.mjs";
import {
  INTELLIGENCE_TOOL_GRANT_BROKER_SCHEMA,
  INTELLIGENCE_TOOL_GRANT_SCHEMA,
  validateIntelligenceToolGrantDescriptor,
  validateIntelligenceToolGrantId,
} from "../../contracts/intelligence-tool-grant.mjs";
import {
  INTELLIGENCE_TOOL_RECEIPT_SCHEMA,
  validateIntelligenceToolReceipt,
  validateIntelligenceToolReceiptId,
} from "../../contracts/intelligence-tool-receipt.mjs";
import {
  INTELLIGENCE_TOOL_REGISTRY_SCHEMA,
  validateIntelligenceToolId,
} from "../../contracts/intelligence-tool.mjs";
import { validateIntelligenceTaskTarget } from "../../contracts/intelligence-task.mjs";

export const DEFAULT_INTELLIGENCE_TOOL_GRANT_TTL_MS = 60_000;
export const MAX_INTELLIGENCE_TOOL_GRANT_TTL_MS = 120_000;
const MAX_ACTIVE_GRANTS = 32;
const MAX_RECEIPTS = 256;

function secureId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure randomUUID is required for Intelligence tool authorization");
  return `${prefix}-${uuid.replaceAll("-", "")}`;
}

function validateRegistry(value, schema, label) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== schema
    || typeof value.get !== "function"
  ) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function validatedTtl(value) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > MAX_INTELLIGENCE_TOOL_GRANT_TTL_MS) {
    throw new TypeError("Intelligence tool grant TTL is outside its allowed bounds");
  }
  return value;
}

function sameTarget(leftValue, rightValue) {
  const left = validateIntelligenceTaskTarget(leftValue);
  const right = validateIntelligenceTaskTarget(rightValue);
  return left.kind === right.kind && left.id === right.id;
}

export function createIntelligenceToolGrantBroker({
  agentRegistry,
  toolRegistry,
  now = () => Date.now(),
  createGrantId = () => secureId("tool-grant"),
  createReceiptId = () => secureId("tool-receipt"),
} = {}) {
  const agents = validateRegistry(
    agentRegistry,
    INTELLIGENCE_AGENT_REGISTRY_SCHEMA,
    "Intelligence agent registry",
  );
  const tools = validateRegistry(
    toolRegistry,
    INTELLIGENCE_TOOL_REGISTRY_SCHEMA,
    "Intelligence tool registry",
  );
  if (
    typeof now !== "function"
    || typeof createGrantId !== "function"
    || typeof createReceiptId !== "function"
  ) {
    throw new TypeError("Intelligence tool grant broker requires clock and id factories");
  }

  const grants = new Map();
  const receipts = [];
  let disposed = false;

  const assertAlive = () => {
    if (disposed) throw new Error("Intelligence tool grant broker is disposed");
  };

  const currentTime = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Intelligence tool grant broker clock is invalid");
    }
    return value;
  };

  const appendReceipt = (event, descriptor, timestamp = currentTime()) => {
    let receiptId = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = validateIntelligenceToolReceiptId(createReceiptId());
      if (!receipts.some((receipt) => receipt.id === candidate)) {
        receiptId = candidate;
        break;
      }
    }
    if (receiptId === null) {
      throw new Error("Intelligence tool receipt id collision limit reached");
    }
    const receipt = validateIntelligenceToolReceipt({
      schema: INTELLIGENCE_TOOL_RECEIPT_SCHEMA,
      id: receiptId,
      event,
      agentId: descriptor.agentId,
      toolId: descriptor.toolId,
      capabilityId: descriptor.capabilityId,
      target: descriptor.target,
      timestamp,
      authority: "none",
      executionOccurred: false,
      mutatedState: false,
      networkEgress: false,
    });
    receipts.push(receipt);
    if (receipts.length > MAX_RECEIPTS) receipts.splice(0, receipts.length - MAX_RECEIPTS);
    return receipt;
  };

  const expireIfNeeded = (grantId, record) => {
    const timestamp = currentTime();
    if (record.descriptor.expiresAt > timestamp) return false;
    grants.delete(grantId);
    appendReceipt("expired", record.descriptor, timestamp);
    return true;
  };

  const liveRecord = (grantIdValue) => {
    assertAlive();
    const grantId = validateIntelligenceToolGrantId(grantIdValue);
    const record = grants.get(grantId);
    if (!record) throw new Error("Intelligence tool grant is unavailable or already consumed");
    if (expireIfNeeded(grantId, record)) throw new Error("Intelligence tool grant has expired");
    return record;
  };

  return Object.freeze({
    schema: INTELLIGENCE_TOOL_GRANT_BROKER_SCHEMA,
    issue({ agentId, toolId, target, ttlMs = DEFAULT_INTELLIGENCE_TOOL_GRANT_TTL_MS } = {}) {
      assertAlive();
      const normalizedAgentId = validateIntelligenceAgentId(agentId);
      const normalizedToolId = validateIntelligenceToolId(toolId);
      const agent = agents.get(normalizedAgentId);
      const tool = tools.get(normalizedToolId);
      if (!agent) throw new Error("Intelligence tool grant agent is not registered");
      if (!tool) throw new Error("Intelligence tool grant tool is not registered");
      if (
        agent.readOnly !== true
        || agent.authority !== "none"
        || agent.executable !== false
        || agent.toolExecution !== false
      ) {
        throw new TypeError("Intelligence tool grant agent is outside the read-only foundation");
      }
      if (
        tool.readOnly !== true
        || tool.networkEgress !== false
        || tool.mutatesState !== false
        || tool.invocationEnabled !== false
        || tool.authority !== "none"
      ) {
        throw new TypeError("Intelligence tool grant tool is outside the read-only foundation");
      }
      const concreteTarget = validateIntelligenceTaskTarget(target);
      if (concreteTarget.kind === "unspecified") {
        throw new TypeError("Intelligence tool grant requires a concrete target");
      }
      const ttl = validatedTtl(ttlMs);
      if (grants.size >= MAX_ACTIVE_GRANTS) {
        throw new Error("Intelligence tool grant broker reached its active grant limit");
      }

      let grantId = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const candidate = validateIntelligenceToolGrantId(createGrantId());
        if (!grants.has(candidate)) {
          grantId = candidate;
          break;
        }
      }
      if (grantId === null) throw new Error("Intelligence tool grant id collision limit reached");

      const issuedAt = currentTime();
      const expiresAt = issuedAt + ttl;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError("Intelligence tool grant expiry overflowed its bounds");
      }
      const descriptor = validateIntelligenceToolGrantDescriptor({
        schema: INTELLIGENCE_TOOL_GRANT_SCHEMA,
        id: grantId,
        agentId: agent.id,
        toolId: tool.id,
        capabilityId: tool.capabilityId,
        target: concreteTarget,
        inputScopes: tool.inputScopes,
        issuedAt,
        expiresAt,
        oneShot: true,
        readOnly: true,
        networkEgress: false,
        mutatesState: false,
        authority: "none",
        executable: false,
        toolExecution: false,
      });
      grants.set(grantId, Object.freeze({ descriptor }));
      appendReceipt("issued", descriptor, issuedAt);
      return descriptor;
    },
    describe(grantId) {
      return liveRecord(grantId).descriptor;
    },
    consume(grantId, { agentId, toolId, target } = {}) {
      const record = liveRecord(grantId);
      if (validateIntelligenceAgentId(agentId) !== record.descriptor.agentId) {
        throw new Error("Intelligence tool grant agent does not match");
      }
      if (validateIntelligenceToolId(toolId) !== record.descriptor.toolId) {
        throw new Error("Intelligence tool grant tool does not match");
      }
      if (!sameTarget(target, record.descriptor.target)) {
        throw new Error("Intelligence tool grant target does not match");
      }
      grants.delete(record.descriptor.id);
      appendReceipt("consumed", record.descriptor);
      return record.descriptor;
    },
    revoke(grantIdValue) {
      assertAlive();
      const grantId = validateIntelligenceToolGrantId(grantIdValue);
      const record = grants.get(grantId);
      if (!record) return false;
      grants.delete(grantId);
      appendReceipt("revoked", record.descriptor);
      return true;
    },
    listReceipts({ limit = 64 } = {}) {
      assertAlive();
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECEIPTS) {
        throw new TypeError("Intelligence tool receipt limit is invalid");
      }
      return Object.freeze(receipts.slice(-limit));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      grants.clear();
    },
  });
}
