import { validateComponentId } from "../../contracts/component-manifest.mjs";
import {
  NATIVE_COMPONENT_PROBATION_IDS,
  NATIVE_COMPONENT_PROBE_MODE_BY_ID,
} from "./probation-policy.generated.mjs";
import {
  COMPONENT_PROBATION_RESULT_SCHEMA,
  runPendingComponentProbation,
} from "./probation-loader.mjs";
import {
  COMPONENT_MOUNT_HEALTH_PROBE_MODE,
  createRuntimeMountHealthCheck,
} from "./runtime-mount-health-probe.mjs";

export const COMPONENT_PROBATION_ORCHESTRATOR_SCHEMA =
  "ordax.component-probation-orchestrator/1";

const PROBE_MODES = NATIVE_COMPONENT_PROBE_MODE_BY_ID;
if (
  Object.keys(PROBE_MODES).length !== NATIVE_COMPONENT_PROBATION_IDS.length
  || NATIVE_COMPONENT_PROBATION_IDS.some((id) => !(id in PROBE_MODES))
) {
  throw new TypeError("Generated component probation policy is inconsistent");
}

function probeFor(componentId, { mountContext = null, timeoutMs = 5_000 } = {}) {
  const mode = PROBE_MODES[componentId];
  if (!mode) {
    throw new TypeError("Unsupported system component probation probe");
  }
  // A configured mode is not an implementation grant. mount-contract is
  // executable only when its caller supplies an explicit host-owned mount
  // context. Missing/invalid context fails here, before slot fetch or import.
  if (mode !== "import-contract") {
    if (mode === COMPONENT_MOUNT_HEALTH_PROBE_MODE) {
      return createRuntimeMountHealthCheck({
        componentId,
        context: mountContext,
        timeoutMs,
      });
    }
    throw new TypeError("Unsupported system component probation probe mode");
  }
  return async ({ runtime, resolution, runtimeUrl }) => {
    if (
      runtime.componentId !== componentId
      || runtime.version !== resolution.version
      || resolution.componentId !== componentId
      || resolution.state !== "pending"
      || resolution.pendingHealth !== "unknown"
      || typeof runtimeUrl !== "string"
      || !runtimeUrl.includes(
        `/__ordax/native/component-module/${componentId}/pending/`
      )
    ) {
      return "failed";
    }
    return "healthy";
  };
}

export function systemComponentProbationProbeMode(componentIdValue) {
  const componentId = validateComponentId(componentIdValue);
  const mode = PROBE_MODES[componentId];
  if (!mode) {
    throw new TypeError("Unsupported system component probation probe");
  }
  return mode;
}

export async function runSystemPendingComponentProbation({
  componentId,
  source,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  importModule = (url) => import(url),
  mountContext = null,
  timeoutMs = 5_000,
} = {}) {
  const id = validateComponentId(componentId);
  const probeMode = systemComponentProbationProbeMode(id);
  const result = await runPendingComponentProbation({
    componentId: id,
    source,
    fetchImpl,
    importModule,
    healthCheck: probeFor(id, { mountContext, timeoutMs }),
    timeoutMs,
  });
  if (result.schema !== COMPONENT_PROBATION_RESULT_SCHEMA) {
    throw new TypeError("System component probation returned an invalid receipt");
  }
  return Object.freeze({
    ...result,
    probeMode,
  });
}
