import { createIntelligenceContextGrantBroker } from "./context-grants.mjs";
import { createIntelligenceContextShare } from "./context-share.mjs";

let defaultRuntime = null;

export function getDefaultIntelligenceContextSharingRuntime() {
  if (defaultRuntime !== null) return defaultRuntime;

  const grants = createIntelligenceContextGrantBroker();
  const share = createIntelligenceContextShare(grants);
  defaultRuntime = Object.freeze({ grants, share });
  return defaultRuntime;
}
