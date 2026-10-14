export const NATIVE_COMPONENT_PROBATION_SCHEMA =
  "ordax.native-component-probation/1";

async function loadProbationDependencies() {
  const [
    sourceModule,
    orchestratorModule,
    contextModule,
    mountProbeModule,
  ] = await Promise.all([
    import("../../adapters/native/component-slot-source.mjs"),
    import("../../services/components/probation-orchestrator.mjs"),
    import("../../services/components/probation-context.mjs"),
    import("../../services/components/runtime-mount-health-probe.mjs"),
  ]);
  return {
    createNativeComponentSlotSource: sourceModule.createNativeComponentSlotSource,
    runSystemPendingComponentProbation: orchestratorModule.runSystemPendingComponentProbation,
    systemComponentProbationProbeMode: orchestratorModule.systemComponentProbationProbeMode,
    composeComponentProbationContext: contextModule.composeComponentProbationContext,
    mountProbeMode: mountProbeModule.COMPONENT_MOUNT_HEALTH_PROBE_MODE,
  };
}

export async function runNativePendingComponentProbation({
  componentId,
  windowRef = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  importModule = (url) => import(url),
  timeoutMs = 5_000,
} = {}) {
  const {
    createNativeComponentSlotSource,
    runSystemPendingComponentProbation,
    systemComponentProbationProbeMode,
    composeComponentProbationContext,
    mountProbeMode,
  } = await loadProbationDependencies();
  const probeMode = systemComponentProbationProbeMode(componentId);
  const mountContext = probeMode === mountProbeMode
    ? await composeComponentProbationContext(componentId, { timeoutMs })
    : null;
  const source = createNativeComponentSlotSource(windowRef);
  return runSystemPendingComponentProbation({
    componentId,
    source,
    fetchImpl,
    importModule,
    mountContext,
    timeoutMs,
  });
}
