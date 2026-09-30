import { createNativePersonalOrdaxStore } from "../../adapters/native/personal-ordax.mjs";
import {
  assertIntelligenceToolGrantIssuer,
  assertIntelligenceToolGrantRegistry,
} from "../../contracts/intelligence-tool-grant-authority.mjs";
import { createIntelligenceToolGrantAuthority } from "../../services/intelligence/tool-grants.mjs";
import { createPersonalOrdaxActionGateway } from "../../services/personal-ordax/action-gateway.mjs";
import { createPersonalOrdaxRuntime } from "../../services/personal-ordax/runtime.mjs";

export function createNativePersonalOrdaxComposition({
  windowRef = globalThis.window,
  identitySession,
  spaceSelection = null,
  projects = null,
  intelligence,
  toolResolver = () => null,
  grantAuthority = null,
} = {}) {
  if (!windowRef || typeof windowRef !== "object") {
    throw new TypeError("Native Personal OrdaX composition requires a window-like host");
  }
  if (typeof toolResolver !== "function") {
    throw new TypeError("Native Personal OrdaX composition tool resolver must be a function");
  }

  const ownsGrantAuthority = grantAuthority === null;
  const authority = grantAuthority ?? createIntelligenceToolGrantAuthority();
  const registry = assertIntelligenceToolGrantRegistry(authority.registry);
  assertIntelligenceToolGrantIssuer(authority.issuer);

  const actionGateway = createPersonalOrdaxActionGateway({
    toolResolver,
    grantResolver: (grantId) => registry.resolve(grantId),
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySession,
    spaceSelectionPort: spaceSelection,
    projectCatalogPort: projects,
    intelligencePort: intelligence,
    actionGatewayPort: actionGateway,
    store: createNativePersonalOrdaxStore(windowRef),
  });

  return Object.freeze({
    ...runtime,
    dispose() {
      runtime.dispose();
      if (ownsGrantAuthority) authority.dispose();
    },
  });
}
