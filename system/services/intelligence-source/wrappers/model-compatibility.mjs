import * as hardware from "../../contracts/hardware-inventory.mjs";
import * as systemMetrics from "../../contracts/system-metrics.mjs";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "./model-candidate.generated.mjs";
import { bindModelCompatibilityContracts } from "../../intelligence-source/src/index.mjs";
export const { LOCAL_AI_MODEL_COMPATIBILITY_SCHEMA, assessBundledLocalAiModel } =
  bindModelCompatibilityContracts({ hardware, systemMetrics, candidate: BUNDLED_LOCAL_AI_MODEL_CANDIDATE });
