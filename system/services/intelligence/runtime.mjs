import * as intelligence from "../../contracts/intelligence.mjs";
import * as localAi from "../../contracts/local-ai.mjs";
import * as modelRouter from "../../contracts/model-router.mjs";
import { regionalLocalePreference } from "../preferences/regional.mjs";
import { bindIntelligenceContracts } from "../../intelligence/src/index.mjs";
export const { createIntelligenceRuntime } = bindIntelligenceContracts({ intelligence, localAi, modelRouter, regionalLocalePreference });
