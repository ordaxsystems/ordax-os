import * as localAi from "../../contracts/local-ai.mjs";
import { bindLocalAiStreamContracts } from "../../intelligence-source/src/index.mjs";
export const { readLocalAiCompletionStream } = bindLocalAiStreamContracts(localAi);
