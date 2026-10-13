import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { NATIVE_COMPONENT_PROBATION_IDS, NATIVE_COMPONENT_PROBE_MODE } from "./probation-policy.generated.mjs";
import {
  COMPONENT_PROBATION_RESULT_SCHEMA,
  runPendingComponentProbation,
} from "./probation-loader.mjs";

export const COMPONENT_PROBATION_ORCHESTRATOR_SCHEMA =
  "ordax.component-probation-orchestrator/1";

const PROBE_MODES = Object.freeze(Object.fromEntries(
  NATIVE_COMPONENT_PROBATION_IDS.map((id) => [id, NATIVE_COMPONENT_PROBE_MODE]),
));

function probeFor(componentId) {
  const mode = PROBE_MODES[componentId];
  if (!mode) {
    throw new TypeError("Unsupported system component probation probe");
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
  timeoutMs = 5_000,
} = {}) {
  const id = validateComponentId(componentId);
  const probeMode = systemComponentProbationProbeMode(id);
  const result = await runPendingComponentProbation({
    componentId: id,
    source,
    fetchImpl,
    importModule,
    healthCheck: probeFor(id),
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
