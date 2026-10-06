import { createNativeVerifiedComponentPackageSource } from "../../adapters/native/verified-component-package-source.mjs";
import { listFirstPartyApps } from "../../apps/catalog.mjs";
import { createApplicationIntelligenceAwareness } from "../../services/intelligence/application-awareness.mjs";
import { createApplicationContextIntelligence } from "../../services/intelligence/application-context.mjs";
import {
  EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS,
  loadVerifiedFirstPartyApplicationSemantics,
  overlayVerifiedFirstPartyApplications,
} from "../../services/intelligence/verified-app-semantics.mjs";

function resolveFetch(windowRef, fetchImpl) {
  if (fetchImpl !== null) {
    if (typeof fetchImpl !== "function") {
      throw new TypeError("Native Application Intelligence fetchImpl must be a function");
    }
    return fetchImpl;
  }
  return typeof windowRef?.fetch === "function" ? windowRef.fetch.bind(windowRef) : null;
}

export async function createNativeVerifiedApplicationContextIntelligence({
  windowRef = globalThis.window,
  intelligencePort,
  fetchImpl = null,
  packageSource = null,
  onSemanticError = () => {},
} = {}) {
  if (!windowRef || typeof windowRef !== "object") {
    throw new TypeError("Native Application Intelligence requires a window-like host");
  }
  if (typeof onSemanticError !== "function") {
    throw new TypeError("Native Application Intelligence semantic error handler must be a function");
  }

  const source = packageSource ?? createNativeVerifiedComponentPackageSource(windowRef);
  const fetcher = resolveFetch(windowRef, fetchImpl);
  const verifiedEntries = [];

  if (fetcher !== null) {
    for (const appId of EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS) {
      try {
        const entries = await loadVerifiedFirstPartyApplicationSemantics({
          appIds: [appId],
          source,
          fetchImpl: fetcher,
        });
        if (entries.length === 1) verifiedEntries.push(entries[0]);
      } catch (error) {
        onSemanticError(error, Object.freeze({ appId }));
      }
    }
  }

  const firstPartyApplications = overlayVerifiedFirstPartyApplications(
    listFirstPartyApps(),
    verifiedEntries,
  );
  const awarenessPort = createApplicationIntelligenceAwareness({
    firstPartyApplications,
    installedApplications: [],
    firstPartyIntelligenceManifests: verifiedEntries.map((entry) => entry.intelligenceManifest),
  });

  return createApplicationContextIntelligence({
    intelligencePort,
    awarenessPort,
    actionCapabilityRegistryPort: null,
  });
}
