import * as localAi from "../../contracts/local-ai.mjs";
import { bindLocalAiStreamContracts } from "../../intelligence/src/index.mjs";
export const { readLocalAiCompletionStream } = bindLocalAiStreamContracts(localAi);
