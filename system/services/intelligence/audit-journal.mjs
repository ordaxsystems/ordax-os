import {
  DEFAULT_INTELLIGENCE_AUDIT_LIMIT,
  INTELLIGENCE_AUDIT_ENTRY_SCHEMA,
  INTELLIGENCE_AUDIT_JOURNAL_SCHEMA,
  validateIntelligenceAuditEntry,
  validateIntelligenceAuditLimit,
} from "../../contracts/intelligence-audit-journal.mjs";
import {
  validateIntelligenceToolAuditRef,
  validateIntelligenceToolAuthorizationReceipt,
} from "../../contracts/intelligence-tool-authorization.mjs";
import {
  validateIntelligenceToolExecutionReceipt,
} from "../../contracts/intelligence-tool-execution.mjs";

function authorizationEntry(receipt, sequence) {
  const value = validateIntelligenceToolAuthorizationReceipt(receipt);
  return validateIntelligenceAuditEntry({
    schema: INTELLIGENCE_AUDIT_ENTRY_SCHEMA,
    sequence,
    kind: "authorization",
    receiptId: value.id,
    auditRef: value.auditRef,
    event: value.event,
    agentId: value.agentId,
    toolId: value.toolId,
    capabilityId: value.capabilityId,
    targetScope: value.targetScope,
    occurredAt: value.timestamp,
    executionOccurred: false,
    readOnly: true,
    networkEgress: false,
    mutatedState: false,
    authority: "none",
  });
}

function executionEntry(receipt, sequence) {
  const value = validateIntelligenceToolExecutionReceipt(receipt);
  return validateIntelligenceAuditEntry({
    schema: INTELLIGENCE_AUDIT_ENTRY_SCHEMA,
    sequence,
    kind: "execution",
    receiptId: value.id,
    auditRef: value.auditRef,
    event: value.event,
    agentId: value.agentId,
    toolId: value.toolId,
    capabilityId: value.capabilityId,
    targetScope: value.targetScope,
    occurredAt: value.completedAt,
    executionOccurred: true,
    readOnly: value.readOnly,
    networkEgress: value.networkEgress,
    mutatedState: value.mutatedState,
    authority: value.authority,
  });
}

export function createIntelligenceAuditJournal({
  limit = DEFAULT_INTELLIGENCE_AUDIT_LIMIT,
} = {}) {
  const boundedLimit = validateIntelligenceAuditLimit(limit);
  const entries = [];
  let sequence = 0;

  const append = (entry) => {
    entries.push(entry);
    if (entries.length > boundedLimit) entries.shift();
    return entry;
  };

  return Object.freeze({
    schema: INTELLIGENCE_AUDIT_JOURNAL_SCHEMA,
    recordAuthorizationReceipt(receipt) {
      sequence += 1;
      return append(authorizationEntry(receipt, sequence));
    },
    recordExecutionReceipt(receipt) {
      sequence += 1;
      return append(executionEntry(receipt, sequence));
    },
    list() {
      return Object.freeze([...entries]);
    },
    listByAuditRef(auditRefValue) {
      const auditRef = validateIntelligenceToolAuditRef(auditRefValue);
      return Object.freeze(entries.filter((entry) => entry.auditRef === auditRef));
    },
  });
}
