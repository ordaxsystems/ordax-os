import * as localAi from "../../contracts/local-ai.mjs";
import { bindLocalAiContracts } from "../../intelligence/src/index.mjs";
export const { createLocalAiRuntime } = bindLocalAiContracts(localAi);
