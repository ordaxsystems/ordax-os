// Test-only binding to the real, pinned OS contract validators.
import * as intelligence from "../../../../system/contracts/intelligence.mjs";
import * as localAi from "../../../../system/contracts/local-ai.mjs";
import * as modelRouter from "../../../../system/contracts/model-router.mjs";
import { regionalLocalePreference } from "../../../../system/services/preferences/regional.mjs";
import { bindIntelligenceContracts, bindLocalAiContracts, bindModelRouterContracts, bindModelCompatibilityContracts } from "../../src/index.mjs";
export const { createIntelligenceRuntime } = bindIntelligenceContracts({ intelligence, localAi, modelRouter, regionalLocalePreference });
export const { createModelRouterRuntime } = bindModelRouterContracts({ localAi, modelRouter });
export const { createLocalAiRuntime } = bindLocalAiContracts(localAi);
import * as hardware from "../../../../system/contracts/hardware-inventory.mjs";
import * as systemMetrics from "../../../../system/contracts/system-metrics.mjs";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "../../../../system/services/local-ai/model-candidate.generated.mjs";
export const { assessBundledLocalAiModel } = bindModelCompatibilityContracts({ hardware, systemMetrics, candidate: BUNDLED_LOCAL_AI_MODEL_CANDIDATE });
