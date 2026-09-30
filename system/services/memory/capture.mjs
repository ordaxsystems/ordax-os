import {
  MAX_MEMORY_SEARCH_OFFSET,
  MAX_MEMORY_SEARCH_RESULTS,
  assertMemoryPort,
  validateMemoryItem,
} from "../../contracts/memory.mjs";
import { assertMemoryMutationPort } from "../../contracts/memory-mutation.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { memoryAutoCaptureEnabled } from "../preferences/memory.mjs";
import { createMemoryMutationPort } from "./mutation-port.mjs";
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

function findExactCapturedMemory(memory, draft, authorization) {
  const query = draft.content.slice(0, 1024);
  for (
    let offset = 0;
    offset <= MAX_MEMORY_SEARCH_OFFSET;
    offset += MAX_MEMORY_SEARCH_RESULTS
  ) {
    const matches = memory.search({
      ownerKind: authorization.ownerKind,
      ownerId: authorization.ownerId,
      scopes: [authorization.scope],
      spaceId: authorization.spaceId,
      projectId: null,
      includeRestricted: false,
      query,
      limit: MAX_MEMORY_SEARCH_RESULTS,
      offset,
    });
    const exact = matches.find((item) => (
      item.ownerKind === authorization.ownerKind
      && item.ownerId === authorization.ownerId
      && item.scope === authorization.scope
      && item.spaceId === authorization.spaceId
      && item.projectId === null
      && item.kind === draft.kind
      && item.sensitivity === draft.sensitivity
      && item.content === draft.content
    ));
    if (exact) return exact;
    if (matches.length < MAX_MEMORY_SEARCH_RESULTS) return null;
  }
  return null;
}

export function createMemoryCaptureRuntime(memoryPort, {
  now = () => new Date(),
  idFactory = defaultIdFactory,
  readCaptureEnabled = () => true,
  mutationPort = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const mutations = mutationPort === null
    ? createMemoryMutationPort({ memoryPort: memory })
    : assertMemoryMutationPort(mutationPort);
  if (typeof now !== "function" || typeof idFactory !== "function") {
    throw new TypeError("Memory capture runtime requires clock and id factory functions");
  }
  if (typeof readCaptureEnabled !== "function") {
    throw new TypeError("Memory capture requires a capture policy reader");
  }

  return Object.freeze({
    schema: MEMORY_CAPTURE_RUNTIME_SCHEMA,

    async capture(draftValue, authorizationValue) {
      if (readCaptureEnabled() !== true) return null;
      const draft = validateMemoryCaptureDraft(draftValue);
      const authorization = validateMemoryCaptureAuthorization(authorizationValue);
      const existing = findExactCapturedMemory(memory, draft, authorization);
      if (existing !== null) {
        await memory.flush();
        return Object.freeze({
          schema: MEMORY_CAPTURE_RESULT_SCHEMA,
          item: existing,
          durable: true,
        });
      }

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
      const remembered = await mutations.remember(item);
      return Object.freeze({
        schema: MEMORY_CAPTURE_RESULT_SCHEMA,
        item: remembered,
        durable: true,
      });
    },
  });
}


export function createPreferenceBoundMemoryCaptureRuntime(
  memoryPort,
  preferenceRuntime,
  options = {},
) {
  const preferences = assertPreferenceRuntimePort(preferenceRuntime);
  return createMemoryCaptureRuntime(memoryPort, {
    ...options,
    readCaptureEnabled: () => memoryAutoCaptureEnabled(preferences.getSnapshot()),
  });
}
