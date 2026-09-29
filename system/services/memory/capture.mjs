import { assertMemoryPort, validateMemoryItem } from "../../contracts/memory.mjs";
import {
  MEMORY_CAPTURE_PROPOSAL_SCHEMA,
  validateMemoryCaptureAuthorization,
  validateMemoryCaptureConfirmation,
  validateMemoryCaptureDraft,
} from "../../contracts/memory-capture.mjs";

export const MEMORY_CAPTURE_RUNTIME_SCHEMA = "ordax.memory-capture-runtime/1";
const MAX_PENDING_PROPOSALS = 32;

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Memory capture requires a cryptographically strong proposal id source");
  }
  return globalThis.crypto.randomUUID();
}

function sourceTimestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Memory capture clock returned an invalid time");
  }
  return date.toISOString();
}

export function createMemoryCaptureRuntime(memoryPort, {
  now = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  if (typeof now !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Memory capture runtime requires clock and id factory functions");
  }
  const pending = new Map();

  return Object.freeze({
    schema: MEMORY_CAPTURE_RUNTIME_SCHEMA,

    propose(draftValue, authorizationValue) {
      if (pending.size >= MAX_PENDING_PROPOSALS) {
        throw new Error("Memory capture pending proposal limit reached");
      }
      const draft = validateMemoryCaptureDraft(draftValue);
      const authorization = validateMemoryCaptureAuthorization(authorizationValue);
      const proposalId = String(idFactory()).trim();
      if (!proposalId || proposalId.length > 160 || proposalId.includes("\0")) {
        throw new TypeError("Memory capture proposal id is invalid");
      }
      if (pending.has(proposalId)) {
        throw new Error("Memory capture proposal id must be unique");
      }

      const item = validateMemoryItem({
        id: proposalId,
        ownerKind: authorization.ownerKind,
        ownerId: authorization.ownerId,
        scope: authorization.scope,
        kind: draft.kind,
        sensitivity: draft.sensitivity,
        content: draft.content,
        provenance: draft.provenance,
        sourceTimestamp: sourceTimestamp(now),
        spaceId: authorization.spaceId,
        projectId: null,
      });
      const proposal = Object.freeze({
        schema: MEMORY_CAPTURE_PROPOSAL_SCHEMA,
        proposalId,
        item,
      });
      pending.set(proposalId, proposal);
      return proposal;
    },

    async confirm(confirmationValue) {
      const confirmation = validateMemoryCaptureConfirmation(confirmationValue);
      const proposal = pending.get(confirmation.proposalId) ?? null;
      if (proposal === null) {
        throw new Error("Memory capture proposal is no longer pending");
      }
      const remembered = memory.remember(proposal.item);
      await memory.flush();
      pending.delete(confirmation.proposalId);
      return remembered;
    },

    discard(proposalIdValue) {
      if (typeof proposalIdValue !== "string" || proposalIdValue.includes("\0")) {
        throw new TypeError("Memory capture proposal id must be text");
      }
      const proposalId = proposalIdValue.trim();
      if (!proposalId || proposalId.length > 160) {
        throw new TypeError("Memory capture proposal id is invalid");
      }
      return pending.delete(proposalId);
    },

    getPending(proposalIdValue) {
      if (typeof proposalIdValue !== "string") return null;
      return pending.get(proposalIdValue.trim()) ?? null;
    },
  });
}
