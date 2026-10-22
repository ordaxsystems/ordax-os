export const NATIVE_COMPONENT_PROBATION_SCHEMA =
  "ordax.native-component-probation/1";

async function loadProbationDependencies() {
  const [
    sourceModule,
    orchestratorModule,
    contextModule,
    mountProbeModule,
    isolatedProbeModule,
    probationPolicyModule,
  ] = await Promise.all([
    import("../../adapters/native/component-slot-source.mjs"),
    import("../../services/components/probation-orchestrator.mjs"),
    import("../../services/components/probation-context.mjs"),
    import("../../services/components/runtime-mount-health-probe.mjs"),
    import("../../adapters/native/isolated-component-executor.mjs"),
    import("../../services/components/probation-policy.generated.mjs"),
  ]);
  return {
    createNativeComponentSlotSource: sourceModule.createNativeComponentSlotSource,
    runSystemPendingComponentProbation: orchestratorModule.runSystemPendingComponentProbation,
    systemComponentProbationProbeMode: orchestratorModule.systemComponentProbationProbeMode,
    composeComponentProbationContext: contextModule.composeComponentProbationContext,
    mountProbeMode: mountProbeModule.COMPONENT_MOUNT_HEALTH_PROBE_MODE,
    createNativeIsolatedPendingComponentModuleImporter:
      isolatedProbeModule.createNativeIsolatedPendingComponentModuleImporter,
    probationComponentIds: probationPolicyModule.NATIVE_COMPONENT_PROBATION_IDS,
  };
}

export async function runNativePendingComponentProbation({
  componentId,
  windowRef = globalThis.window,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  importModule = null,
  timeoutMs = 5_000,
} = {}) {
  const {
    createNativeComponentSlotSource,
    runSystemPendingComponentProbation,
    systemComponentProbationProbeMode,
    composeComponentProbationContext,
    mountProbeMode,
    createNativeIsolatedPendingComponentModuleImporter,
    probationComponentIds,
  } = await loadProbationDependencies();
  const probeMode = systemComponentProbationProbeMode(componentId);
  const source = createNativeComponentSlotSource(windowRef);
  const verifiedFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : windowRef?.fetch?.bind(windowRef);
  if (typeof verifiedFetch !== "function") {
    throw new TypeError("Pending component probation requires Native loopback fetch");
  }
  // The default production path imports candidate bytes only inside the
  // dedicated opaque-origin probe. Injection remains available to source tests;
  // Native composition never imports pending code in the privileged Surface.
  const isolatedImport = importModule ?? createNativeIsolatedPendingComponentModuleImporter({
    windowRef,
    allowedComponentIds: probationComponentIds,
    componentSlotSource: source,
    fetchImpl: verifiedFetch,
    timeoutMs,
  });
  const mountContext = probeMode === mountProbeMode
    ? await composeComponentProbationContext(componentId, { timeoutMs })
    : null;
  return runSystemPendingComponentProbation({
    componentId,
    source,
    fetchImpl: verifiedFetch,
    importModule: isolatedImport,
    mountContext,
    timeoutMs,
  });
}
