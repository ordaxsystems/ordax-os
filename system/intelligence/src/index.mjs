// Bind these modules to validators imported by the OS from its public contracts.
// OS composition injects Identity/Space authorization and Memory outside this package.
export { bindIntelligenceContracts } from "./intelligence/runtime.mjs";
export { bindModelRouterContracts } from "./intelligence/model-router.mjs";
export { bindLocalAiContracts } from "./local-ai/runtime.mjs";
export { bindLocalAiStreamContracts } from "./local-ai/completion-stream.mjs";
export { bindModelCompatibilityContracts } from "./local-ai/model-compatibility.mjs";
