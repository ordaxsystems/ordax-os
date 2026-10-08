import {
  APPLICATION_COMPATIBILITY_INSPECTION_SCHEMA,
  APPLICATION_COMPATIBILITY_SCHEMA,
  defineApplicationCompatibilityRuntime,
  validateApplicationCompatibilityPlan,
} from "../../contracts/application-compatibility.mjs";
import { inspectWindowsPayload } from "./windows.mjs";

export function createApplicationCompatibilityManager({ runtimes = [] } = {}) {
  if (!Array.isArray(runtimes)) {
    throw new TypeError("Application compatibility runtimes must be an array");
  }

  // Inspection provenance is scoped to this manager instance. Shape/schema alone are not evidence.
  const issuedInspections = new WeakSet();
  const verifiedPayloadDigests = new WeakMap();
  const runtimeList = Object.freeze(runtimes.map((runtime) => defineApplicationCompatibilityRuntime(runtime)));
  const runtimeIds = runtimeList.map((runtime) => runtime.id);
  if (new Set(runtimeIds).size !== runtimeIds.length) {
    throw new TypeError("Application compatibility runtime ids must be unique");
  }

  function inspect(request = {}) {
    const inspection = inspectWindowsPayload(request);
    issuedInspections.add(inspection);
    return inspection;
  }

  async function inspectVerified({ name, bytes } = {}) {
    // Hash an isolated byte snapshot: callers cannot mutate bytes after inspection.
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError("Verified compatibility inspection requires Uint8Array bytes");
    }
    if (typeof globalThis.crypto?.subtle?.digest !== "function") {
      throw new TypeError("Verified compatibility inspection requires Web Crypto SHA-256");
    }
    const snapshot = Uint8Array.from(bytes);
    const inspection = inspect({ name, bytes: snapshot });
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", snapshot));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    verifiedPayloadDigests.set(inspection, `sha256:${hex}`);
    return inspection;
  }

  function assertInspectionDigest({ inspection, payloadDigest } = {}) {
    if (!issuedInspections.has(inspection) || verifiedPayloadDigests.get(inspection) !== payloadDigest) {
      throw new TypeError("Compatibility profile payload digest is not verified for this inspection");
    }
    return inspection;
  }

  function listRuntimes({ family = null } = {}) {
    if (family !== null && family !== "windows" && family !== "linux") {
      throw new TypeError("Application compatibility runtime family is unsupported");
    }
    return Object.freeze(
      runtimeList.filter((runtime) => family === null || runtime.family === family),
    );
  }

  function planLaunch({ inspection, runtimeId = null } = {}) {
    if (
      !inspection
      || typeof inspection !== "object"
      || inspection.schema !== APPLICATION_COMPATIBILITY_INSPECTION_SCHEMA
      || !issuedInspections.has(inspection)
    ) {
      throw new TypeError("An inspection issued by this compatibility manager is required");
    }
    if (runtimeId !== null && (typeof runtimeId !== "string" || !runtimeId.trim())) {
      throw new TypeError("Application compatibility runtimeId must be null or a non-empty string");
    }

    if (!inspection.launchable || inspection.family === null) {
      return validateApplicationCompatibilityPlan({
        ready: false,
        runtimeId: null,
        reason: "payload-not-launchable",
      });
    }

    const matching = runtimeList.filter((runtime) => {
      if (runtime.family !== inspection.family) return false;
      if (runtimeId !== null && runtime.id !== runtimeId) return false;
      return runtime.architectures.includes(inspection.architecture);
    });

    if (matching.length === 0) {
      return validateApplicationCompatibilityPlan({
        ready: false,
        runtimeId: null,
        reason: runtimeId === null ? "runtime-unavailable" : "requested-runtime-unavailable",
      });
    }

    return validateApplicationCompatibilityPlan({
      ready: true,
      runtimeId: matching[0].id,
      reason: "runtime-available",
    });
  }

  return Object.freeze({
    schema: APPLICATION_COMPATIBILITY_SCHEMA,
    inspect,
    inspectVerified,
    assertInspectionDigest,
    listRuntimes,
    planLaunch,
  });
}
