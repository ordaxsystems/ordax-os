import {
  ENTITLEMENTS_PORT_SCHEMA,
  validateEntitlementDecision,
} from "../../contracts/entitlements.mjs";

export const MEMORY_CLOUD_ENTITLEMENT_KEY = "memory.cloud.enabled";
export const MEMORY_ENTITLEMENT_READ_ENDPOINT = "/account/entitlements/memory-cloud";

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Entitlement resolution request must be an object");
  }
  if (value.subjectType !== "account") {
    throw new TypeError("Memory cloud entitlement is account-scoped");
  }
  if (typeof value.subjectId !== "string" || !value.subjectId.trim()) {
    throw new TypeError("Memory cloud entitlement requires an account subject id");
  }
  if (value.key !== MEMORY_CLOUD_ENTITLEMENT_KEY) {
    throw new TypeError("Unsupported Memory entitlement key");
  }
  return Object.freeze({
    subjectType: "account",
    subjectId: value.subjectId.trim(),
    key: MEMORY_CLOUD_ENTITLEMENT_KEY,
  });
}

export function createWebMemoryEntitlements(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web Memory entitlements adapter requires window.fetch");
  }

  return Object.freeze({
    schema: ENTITLEMENTS_PORT_SCHEMA,
    async resolve(value) {
      const request = validateRequest(value);
      const response = await windowRef.fetch(MEMORY_ENTITLEMENT_READ_ENDPOINT, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Memory entitlement read failed: ${response.status}`);
      }
      const decision = validateEntitlementDecision(await response.json());
      if (
        decision.authority !== "server"
        || decision.subjectType !== request.subjectType
        || decision.subjectId !== request.subjectId
        || decision.key !== request.key
      ) {
        throw new Error("Memory entitlement response escaped its server authority boundary");
      }
      return decision;
    },
  });
}
