export const NATIVE_COMPONENT_PROBATION_SCHEMA =
  "ordax.native-component-probation/1";

async function loadProbationDependencies() {
  const [sourceModule, orchestratorModule] = await Promise.all([
    import("../../adapters/native/component-slot-source.mjs"),
    import("../../services/components/probation-orchestrator.mjs"),
  ]);
  return {
    createNativeComponentSlotSource: sourceModule.createNativeComponentSlotSource,
    runSystemPendingComponentProbation: orchestratorModule.runSystemPendingComponentProbation,
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
  } = await loadProbationDependencies();
  const source = createNativeComponentSlotSource(windowRef);
  return runSystemPendingComponentProbation({
    componentId,
    source,
    fetchImpl,
    importModule,
    timeoutMs,
  });
}
