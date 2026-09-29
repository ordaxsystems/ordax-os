import {
  ENTITLEMENTS_PORT_SCHEMA,
  validateEntitlementDecision,
} from "../../contracts/entitlements.mjs";

const ACCOUNT_ENTITLEMENT_SCHEMA = "prototype-ordax.account-entitlement/1";
const MEMORY_CLOUD_ENTITLEMENT = "memory.cloud.enabled";
const SUBJECT_ID_MAX = 160;

function requestIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Entitlement request must be an object");
  }
  if (
    value.subjectType !== "account"
    || value.key !== MEMORY_CLOUD_ENTITLEMENT
    || typeof value.subjectId !== "string"
    || value.subjectId.includes("\0")
  ) {
    throw new TypeError("Unsupported account entitlement request");
  }
  const subjectId = value.subjectId.trim();
  if (!subjectId || subjectId.length > SUBJECT_ID_MAX) {
    throw new TypeError("Entitlement subject id is outside bounds");
  }
  return Object.freeze({
    subjectType: "account",
    subjectId,
    key: MEMORY_CLOUD_ENTITLEMENT,
  });
}

function normalize(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Account entitlement response must be an object");
  }
  if (value.$schema !== ACCOUNT_ENTITLEMENT_SCHEMA) {
    throw new TypeError("Account entitlement response schema is incompatible");
  }
  const decision = validateEntitlementDecision(value);
  if (
    decision.authority !== "server"
    || decision.subjectType !== expected.subjectType
    || decision.subjectId !== expected.subjectId
    || decision.key !== expected.key
  ) {
    throw new Error("Account entitlement response escaped its subject authority");
  }
  return decision;
}

export function createWebAccountEntitlements(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Account entitlements adapter requires window.fetch");
  }

  return Object.freeze({
    schema: ENTITLEMENTS_PORT_SCHEMA,
    async resolve(value) {
      const request = requestIdentity(value);
      const response = await windowRef.fetch(
        "/account/entitlement?key=" + encodeURIComponent(request.key),
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error("Account entitlement gateway unavailable");
      }
      return normalize(await response.json(), request);
    },
  });
}
