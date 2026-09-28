import {
  INTELLIGENCE_TOOL_AUTHORIZATION_BROKER_SCHEMA,
  INTELLIGENCE_TOOL_AUTHORIZATION_RECEIPT_SCHEMA,
  INTELLIGENCE_TOOL_GRANT_SCHEMA,
  validateIntelligenceToolAuthorizationReceipt,
  validateIntelligenceToolAuthorizationRequest,
  validateIntelligenceToolGrant,
  validateIntelligenceToolGrantClaim,
  validateIntelligenceToolGrantId,
} from "../../contracts/intelligence-tool-authorization.mjs";
import { createIntelligenceAgentRegistry } from "./agent-registry.mjs";
import { createIntelligenceCapabilityBridge } from "./capability-bridge.mjs";
import { createIntelligenceToolRegistry } from "./tool-registry.mjs";

const MAX_BINDINGS = 64;
const MAX_TOOLS_PER_BINDING = 16;
const MAX_RECEIPTS = 256;
const BINDING_KEYS = new Set(["agentId", "toolIds"]);

function secureId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure randomUUID is required for Intelligence tool authorization ids");
  return `${prefix}-${uuid.replaceAll("-", "")}`;
}

function nowValue(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Intelligence tool authorization clock must return a non-negative safe integer");
  }
  return value;
}

function compatibleRegistry(value, label) {
  if (!value || typeof value !== "object" || typeof value.get !== "function") {
    throw new TypeError(`${label} must provide get()`);
  }
  return value;
}

function normalizeBindings(value, agents, tools) {
  if (!Array.isArray(value) || value.length > MAX_BINDINGS) {
    throw new TypeError("Intelligence tool bindings must be a bounded array");
  }
  const byAgent = new Map();
  for (const binding of value) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
      throw new TypeError("Intelligence tool binding must be an object");
    }
    for (const key of Object.keys(binding)) {
      if (!BINDING_KEYS.has(key)) {
        throw new TypeError(`Intelligence tool binding field ${key} is not allowed`);
      }
    }
    const agent = agents.get(binding.agentId);
    if (agent === null) throw new TypeError(`Unknown Intelligence agent ${binding.agentId}`);
    if (!Array.isArray(binding.toolIds) || binding.toolIds.length === 0 || binding.toolIds.length > MAX_TOOLS_PER_BINDING) {
      throw new TypeError("Intelligence tool binding toolIds must be a bounded non-empty array");
    }
    if (byAgent.has(agent.id)) {
      throw new TypeError(`Duplicate Intelligence tool binding for agent ${agent.id}`);
    }
    const toolIds = binding.toolIds.map((toolId) => {
      const tool = tools.get(toolId);
      if (tool === null) throw new TypeError(`Unknown Intelligence tool ${toolId}`);
      return tool.id;
    });
    if (new Set(toolIds).size !== toolIds.length) {
      throw new TypeError("Intelligence tool binding toolIds must be unique");
    }
    byAgent.set(agent.id, new Set(toolIds));
  }
  return byAgent;
}

function sameClaim(grant, claim) {
  return grant.agentId === claim.agentId
    && grant.toolId === claim.toolId
    && grant.targetScope === claim.targetScope
    && grant.targetId === claim.targetId;
}

export function createIntelligenceToolAuthorizationBroker({
  agentRegistry = null,
  toolRegistry = null,
  capabilityBridge = null,
  bindings = [],
  getCapabilityIds = () => [],
  now = Date.now,
  createGrantId = () => secureId("tool-grant"),
  createAuditRef = () => secureId("tool-audit"),
  createReceiptId = () => secureId("tool-receipt"),
} = {}) {
  const agents = compatibleRegistry(agentRegistry ?? createIntelligenceAgentRegistry(), "Intelligence agent registry");
  const tools = compatibleRegistry(toolRegistry ?? createIntelligenceToolRegistry(), "Intelligence tool registry");
  const bridge = capabilityBridge ?? createIntelligenceCapabilityBridge({ registry: tools });
  if (!bridge || typeof bridge.inspect !== "function") {
    throw new TypeError("Intelligence tool authorization requires a capability bridge with inspect()");
  }
  if (typeof getCapabilityIds !== "function") {
    throw new TypeError("Intelligence tool authorization capability inventory must be a function");
  }
  if (typeof now !== "function" || typeof createGrantId !== "function" || typeof createAuditRef !== "function" || typeof createReceiptId !== "function") {
    throw new TypeError("Intelligence tool authorization id and clock providers must be functions");
  }

  const allowed = normalizeBindings(bindings, agents, tools);
  const active = new Map();
  const receipts = [];
  let disposed = false;

  const assertAlive = () => {
    if (disposed) throw new Error("Intelligence tool authorization broker is disposed");
  };

  const appendReceipt = (grant, event, timestamp) => {
    const receipt = validateIntelligenceToolAuthorizationReceipt({
      schema: INTELLIGENCE_TOOL_AUTHORIZATION_RECEIPT_SCHEMA,
      id: createReceiptId(),
      auditRef: grant.auditRef,
      event,
      agentId: grant.agentId,
      toolId: grant.toolId,
      capabilityId: grant.capabilityId,
      targetScope: grant.targetScope,
      timestamp,
      executionOccurred: false,
    });
    receipts.push(receipt);
    if (receipts.length > MAX_RECEIPTS) receipts.shift();
    return receipt;
  };

  const getActiveGrant = (grantId) => {
    const id = validateIntelligenceToolGrantId(grantId);
    const grant = active.get(id) ?? null;
    if (grant === null) throw new Error("Intelligence tool grant is unavailable or already claimed");
    const current = nowValue(now);
    if (current >= grant.expiresAt) {
      active.delete(id);
      appendReceipt(grant, "expired", current);
      throw new Error("Intelligence tool grant is expired");
    }
    return grant;
  };

  return Object.freeze({
    schema: INTELLIGENCE_TOOL_AUTHORIZATION_BROKER_SCHEMA,
    issue(value) {
      assertAlive();
      const request = validateIntelligenceToolAuthorizationRequest(value);
      const agent = agents.get(request.agentId);
      const tool = tools.get(request.toolId);
      if (agent === null) throw new TypeError(`Unknown Intelligence agent ${request.agentId}`);
      if (tool === null) throw new TypeError(`Unknown Intelligence tool ${request.toolId}`);
      if (!allowed.get(agent.id)?.has(tool.id)) {
        throw new Error(`Intelligence agent ${agent.id} has no explicit binding for tool ${tool.id}`);
      }
      if (!tool.inputScopes.includes(request.targetScope)) {
        throw new Error(`Intelligence tool ${tool.id} does not accept scope ${request.targetScope}`);
      }
      const inspection = bridge.inspect(tool.id, getCapabilityIds());
      if (inspection === null || inspection.available !== true) {
        throw new Error(`Required read-only capability ${tool.capabilityId} is unavailable`);
      }
      if (
        inspection.readOnly !== true
        || inspection.invocationEnabled !== true
        || inspection.authority !== "none"
      ) {
        throw new Error("Intelligence capability bridge returned a tool that is not safely invocable");
      }

      const issuedAt = nowValue(now);
      const expiresAt = issuedAt + request.ttlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError("Intelligence tool grant expiry exceeds safe integer range");
      }
      const grant = validateIntelligenceToolGrant({
        schema: INTELLIGENCE_TOOL_GRANT_SCHEMA,
        id: createGrantId(),
        auditRef: createAuditRef(),
        agentId: agent.id,
        toolId: tool.id,
        capabilityId: tool.capabilityId,
        targetScope: request.targetScope,
        targetId: request.targetId,
        issuedAt,
        expiresAt,
        oneShot: true,
        readOnly: true,
        networkEgress: false,
        mutatesState: false,
        executionEnabled: false,
        authority: "none",
      });
      if (active.has(grant.id)) throw new Error("Duplicate Intelligence tool grant id");
      active.set(grant.id, grant);
      appendReceipt(grant, "issued", issuedAt);
      return grant;
    },
    describe(grantId) {
      assertAlive();
      return getActiveGrant(grantId);
    },
    claim(value) {
      assertAlive();
      const claim = validateIntelligenceToolGrantClaim(value);
      const grant = getActiveGrant(claim.grantId);
      if (!sameClaim(grant, claim)) {
        throw new Error("Intelligence tool grant claim does not match the issued authorization");
      }
      active.delete(grant.id);
      appendReceipt(grant, "claimed", nowValue(now));
      return grant;
    },
    revoke(grantId) {
      assertAlive();
      const id = validateIntelligenceToolGrantId(grantId);
      const grant = active.get(id) ?? null;
      if (grant === null) return false;
      const current = nowValue(now);
      active.delete(id);
      appendReceipt(grant, current >= grant.expiresAt ? "expired" : "revoked", current);
      return current < grant.expiresAt;
    },
    listReceipts() {
      assertAlive();
      return Object.freeze([...receipts]);
    },
    dispose() {
      if (disposed) return;
      const current = nowValue(now);
      for (const grant of active.values()) {
        appendReceipt(grant, current >= grant.expiresAt ? "expired" : "revoked", current);
      }
      active.clear();
      disposed = true;
    },
  });
}
