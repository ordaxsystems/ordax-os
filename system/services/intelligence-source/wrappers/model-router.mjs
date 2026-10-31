import * as localAi from "../../contracts/local-ai.mjs";
import * as modelRouter from "../../contracts/model-router.mjs";
import { bindModelRouterContracts } from "../../intelligence-source/src/index.mjs";
export const { createModelRouterRuntime } = bindModelRouterContracts({ localAi, modelRouter });
