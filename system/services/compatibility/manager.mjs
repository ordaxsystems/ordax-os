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

  const runtimeList = Object.freeze(runtimes.map((runtime) => defineApplicationCompatibilityRuntime(runtime)));
  const runtimeIds = runtimeList.map((runtime) => runtime.id);
  if (new Set(runtimeIds).size !== runtimeIds.length) {
    throw new TypeError("Application compatibility runtime ids must be unique");
  }

  function inspect(request = {}) {
    return inspectWindowsPayload(request);
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
    ) {
      throw new TypeError("A validated application compatibility inspection is required");
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
    listRuntimes,
    planLaunch,
  });
}
