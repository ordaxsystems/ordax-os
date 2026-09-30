import {
  PERSONAL_ACTION_CATALOG_SCHEMA,
  validatePersonalActionEntry,
} from "../../contracts/personal-action-catalog.mjs";
import { PERSONAL_ORDAX_RUNTIME_SCHEMA } from "../../contracts/personal-ordax-store.mjs";

function registration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal action registration must be an object");
  }
  const entry = validatePersonalActionEntry(value.entry);
  if (typeof value.toResourceRef !== "function") {
    throw new TypeError("Personal action registration requires toResourceRef()");
  }
  if (
    typeof value.reason !== "string"
    || !value.reason.trim()
    || value.reason.includes("\0")
    || value.reason.trim().length > 1000
  ) {
    throw new TypeError("Personal action registration requires a bounded reason");
  }
  return Object.freeze({
    entry,
    toResourceRef: value.toResourceRef,
    reason: value.reason.trim(),
  });
}

function assertRuntime(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== PERSONAL_ORDAX_RUNTIME_SCHEMA
    || typeof value.requestApproval !== "function"
  ) {
    throw new TypeError("Personal action catalog requires the canonical Personal OrdaX runtime");
  }
  return value;
}

export function createPersonalActionCatalog({ registrations = [] } = {}) {
  if (!Array.isArray(registrations)) {
    throw new TypeError("Personal action registrations must be an array");
  }
  const byId = new Map();
  for (const value of registrations) {
    const item = registration(value);
    if (byId.has(item.entry.id)) {
      throw new TypeError(`Duplicate Personal action entry: ${item.entry.id}`);
    }
    byId.set(item.entry.id, item);
  }
  const entries = Object.freeze([...byId.values()].map((item) => item.entry));

  return Object.freeze({
    schema: PERSONAL_ACTION_CATALOG_SCHEMA,
    list() {
      return entries;
    },
    request(runtimeValue, workItemId, entryId, { resourceValue } = {}) {
      const runtime = assertRuntime(runtimeValue);
      const item = byId.get(entryId);
      if (!item) {
        throw new Error("Personal action entry is unavailable");
      }
      const boundedResourceRef = item.toResourceRef(resourceValue);
      return runtime.requestApproval(workItemId, {
        actionId: item.entry.actionId,
        toolId: item.entry.toolId,
        toolArtifactSha256: item.entry.toolArtifactSha256,
        effect: item.entry.effect,
        resourceRef: boundedResourceRef,
        reason: item.reason,
      });
    },
  });
}
