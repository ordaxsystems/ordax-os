import { validateIntelligenceContext } from "../../contracts/intelligence.mjs";
import { assertIntelligenceAuditJournal } from "../../contracts/intelligence-audit-journal.mjs";
import { assertIntelligenceToolAuthorizationBroker } from "../../contracts/intelligence-tool-authorization.mjs";
import {
  INTELLIGENCE_READ_ONLY_TOOL_EXECUTOR_SCHEMA,
  INTELLIGENCE_TOOL_EXECUTION_RECEIPT_SCHEMA,
  INTELLIGENCE_TOOL_EXECUTION_RESULT_SCHEMA,
  validateIntelligenceToolExecutionReceipt,
  validateIntelligenceToolExecutionResult,
} from "../../contracts/intelligence-tool-execution.mjs";
import { validateIntelligenceToolGrantClaim } from "../../contracts/intelligence-tool-authorization.mjs";
import { assertSystemMetricsPort, validateSystemMetricsSnapshot } from "../../contracts/system-metrics.mjs";
import { createIntelligenceToolRegistry } from "./tool-registry.mjs";

const MAX_HANDLERS = 16;
const MAX_RECEIPTS = 256;
const HANDLER_KEYS = new Set(["toolId", "capabilityId", "targetScope", "execute"]);

function secureReceiptId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (!uuid) throw new Error("Secure randomUUID is required for Intelligence execution receipts");
  return `tool-exec-receipt-${uuid.replaceAll("-", "")}`;
}

function nowValue(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Intelligence read-only executor clock is invalid");
  }
  return value;
}

function normalizeHandlers(value, registry) {
  if (!Array.isArray(value) || value.length > MAX_HANDLERS) {
    throw new TypeError("Intelligence read-only handlers must be a bounded array");
  }
  const byToolId = new Map();
  for (const handler of value) {
    if (!handler || typeof handler !== "object" || Array.isArray(handler)) {
      throw new TypeError("Intelligence read-only handler must be an object");
    }
    for (const key of Object.keys(handler)) {
      if (!HANDLER_KEYS.has(key)) {
        throw new TypeError(`Intelligence read-only handler field ${key} is not allowed`);
      }
    }
    const tool = registry.get(handler.toolId);
    if (tool === null) throw new TypeError(`Unknown Intelligence read-only tool ${handler.toolId}`);
    if (tool.invocationEnabled !== true) {
      throw new TypeError(`Intelligence tool ${tool.id} is not enabled for governed invocation`);
    }
    if (handler.capabilityId !== tool.capabilityId) {
      throw new TypeError(`Intelligence handler capability does not match tool ${tool.id}`);
    }
    if (!tool.inputScopes.includes(handler.targetScope)) {
      throw new TypeError(`Intelligence handler scope does not match tool ${tool.id}`);
    }
    if (typeof handler.execute !== "function") {
      throw new TypeError("Intelligence read-only handler must implement execute()");
    }
    if (byToolId.has(tool.id)) {
      throw new TypeError(`Duplicate Intelligence read-only handler for ${tool.id}`);
    }
    byToolId.set(tool.id, Object.freeze({
      toolId: tool.id,
      capabilityId: tool.capabilityId,
      targetScope: handler.targetScope,
      execute: handler.execute,
    }));
  }
  return byToolId;
}

function executionContextFromSystemMetrics(snapshot) {
  const metrics = validateSystemMetricsSnapshot(snapshot);
  const text = JSON.stringify({
    uptimeSeconds: metrics.uptimeSeconds,
    memoryTotalBytes: metrics.memoryTotalBytes,
    memoryAvailableBytes: metrics.memoryAvailableBytes,
    userStorageTotalBytes: metrics.userStorageTotalBytes,
    userStorageFreeBytes: metrics.userStorageFreeBytes,
  });
  return validateIntelligenceContext([{
    id: "tool-system-metrics-local",
    scope: "system",
    text,
    provenance: "ordax:tool:observe-system-metrics:local-read-only",
  }]);
}

export function createSystemMetricsIntelligenceToolHandler(portValue) {
  const port = assertSystemMetricsPort(portValue);
  return Object.freeze({
    toolId: "observe-system-metrics",
    capabilityId: "system.metrics",
    targetScope: "system",
    async execute() {
      return executionContextFromSystemMetrics(await port.read());
    },
  });
}

export function createIntelligenceReadOnlyToolExecutor({
  authorizationBroker,
  toolRegistry = null,
  auditJournal = null,
  handlers = [],
  now = Date.now,
  createReceiptId = secureReceiptId,
} = {}) {
  const authorization = assertIntelligenceToolAuthorizationBroker(authorizationBroker);
  const registry = toolRegistry ?? createIntelligenceToolRegistry();
  const journal = auditJournal === null ? null : assertIntelligenceAuditJournal(auditJournal);
  if (!registry || typeof registry.get !== "function") {
    throw new TypeError("Intelligence read-only executor requires a compatible tool registry");
  }
  if (typeof now !== "function" || typeof createReceiptId !== "function") {
    throw new TypeError("Intelligence read-only executor requires clock and receipt id providers");
  }
  const byToolId = normalizeHandlers(handlers, registry);
  const receipts = [];
  let disposed = false;

  const assertAlive = () => {
    if (disposed) throw new Error("Intelligence read-only executor is disposed");
  };

  const appendReceipt = (grant, event, startedAt, completedAt) => {
    const receipt = validateIntelligenceToolExecutionReceipt({
      schema: INTELLIGENCE_TOOL_EXECUTION_RECEIPT_SCHEMA,
      id: createReceiptId(),
      auditRef: grant.auditRef,
      event,
      agentId: grant.agentId,
      toolId: grant.toolId,
      capabilityId: grant.capabilityId,
      targetScope: grant.targetScope,
      startedAt,
      completedAt,
      executionOccurred: true,
      readOnly: true,
      networkEgress: false,
      mutatedState: false,
      authority: "none",
    });
    receipts.push(receipt);
    if (receipts.length > MAX_RECEIPTS) receipts.shift();
    journal?.recordExecutionReceipt(receipt);
    return receipt;
  };

  return Object.freeze({
    schema: INTELLIGENCE_READ_ONLY_TOOL_EXECUTOR_SCHEMA,
    async execute(claimValue) {
      assertAlive();
      const claim = validateIntelligenceToolGrantClaim(claimValue);
      const pending = authorization.describe(claim.grantId);
      const tool = registry.get(pending.toolId);
      if (tool === null || tool.invocationEnabled !== true) {
        throw new Error("Intelligence tool is not enabled for governed invocation");
      }
      const handler = byToolId.get(tool.id) ?? null;
      if (handler === null) {
        throw new Error("Intelligence read-only tool handler is unavailable");
      }
      if (
        handler.capabilityId !== pending.capabilityId
        || handler.targetScope !== pending.targetScope
      ) {
        throw new Error("Intelligence read-only tool handler does not match the authorization");
      }

      const startedAt = nowValue(now);
      const grant = authorization.claim(claim);
      try {
        const context = validateIntelligenceContext(await handler.execute({
          targetId: grant.targetId,
          auditRef: grant.auditRef,
        }));
        const completedAt = nowValue(now);
        const result = validateIntelligenceToolExecutionResult({
          schema: INTELLIGENCE_TOOL_EXECUTION_RESULT_SCHEMA,
          auditRef: grant.auditRef,
          agentId: grant.agentId,
          toolId: grant.toolId,
          capabilityId: grant.capabilityId,
          targetScope: grant.targetScope,
          context,
          executionOccurred: true,
          readOnly: true,
          networkEgress: false,
          mutatedState: false,
          authority: "none",
        });
        const receipt = appendReceipt(grant, "succeeded", startedAt, completedAt);
        return Object.freeze({ result, receipt });
      } catch {
        const completedAt = nowValue(now);
        appendReceipt(grant, "failed", startedAt, completedAt);
        throw new Error("Intelligence read-only tool execution failed");
      }
    },
    listReceipts() {
      assertAlive();
      return Object.freeze([...receipts]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      receipts.length = 0;
    },
  });
}
