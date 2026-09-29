import { assertMemoryPort, validateMemoryItem } from "../../contracts/memory.mjs";
import {
  MEMORY_CAPTURE_RESULT_SCHEMA,
  validateMemoryCaptureAuthorization,
  validateMemoryCaptureDraft,
} from "../../contracts/memory-capture.mjs";

export const MEMORY_CAPTURE_RUNTIME_SCHEMA = "ordax.memory-capture-runtime/1";

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Memory capture requires a cryptographically strong id source");
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
  captureEnabled = true,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  if (typeof now !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Memory capture runtime requires clock and id factory functions");
  }
  if (typeof captureEnabled !== "boolean") {
    throw new TypeError("Memory capture enabled state must be boolean");
  }

  return Object.freeze({
    schema: MEMORY_CAPTURE_RUNTIME_SCHEMA,

    async capture(draftValue, authorizationValue) {
      if (!captureEnabled) return null;
      const draft = validateMemoryCaptureDraft(draftValue);
      const authorization = validateMemoryCaptureAuthorization(authorizationValue);
      const id = String(idFactory()).trim();
      if (!id || id.length > 160 || id.includes("\0")) {
        throw new TypeError("Memory capture id is invalid");
      }

      const item = validateMemoryItem({
        id,
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
      const remembered = memory.remember(item);
      await memory.flush();
      return Object.freeze({
        schema: MEMORY_CAPTURE_RESULT_SCHEMA,
        item: remembered,
        durable: true,
      });
    },
  });
}
