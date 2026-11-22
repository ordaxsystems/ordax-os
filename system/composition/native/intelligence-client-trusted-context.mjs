// Trusted *host-side* port binding for the single external Aura component.
// Product branding is owned by ordax-apps/app.json, never this policy module.
// No Native grant, Memory authority or model credentials cross this boundary.
import { createVerifiedSlotHostContextProvider } from "../../services/components/verified-host-context.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort } from "../../contracts/space-selection.mjs";
import { assertIntelligencePort } from "../../contracts/intelligence.mjs";
import { createNativePendingComponentHostBootstrap } from "./component-pending-host.mjs";
import { hasNativeExternalFirstPartyProbation } from "../../services/apps/external-first-party-policy.mjs";
import { getFirstPartyApp } from "../../apps/catalog.mjs";
import { createLocaleProfile } from "../../contracts/locale-profile.mjs";
import { LOCALIZATION_SCHEMA } from "../../contracts/localization.mjs";
import { SURFACE_RENDER_LIFECYCLE_SCHEMA } from "../../contracts/surface-render-lifecycle.mjs";

export function createNativeIntelligenceClientTrustedContextProvider({
  verifiedCurrent = null,
  identitySessionPort = null,
  spaceSelectionPort = null,
  intelligencePort = null,
} = {}) {
  return createVerifiedSlotHostContextProvider({
    componentId: "assistant", verifiedCurrent,
    createPorts: () => Object.freeze({
      identitySessionPort: assertIdentitySessionPort(identitySessionPort),
      spaceSelectionPort: assertSpaceSelectionPort(spaceSelectionPort),
      intelligence: assertIntelligencePort(intelligencePort),
    }),
  });
}

// Pending Aura is never given live Identity, Space, Intelligence, Memory or
// user-localization data. The isolated module executor replaces them with
// explicit unavailable snapshots and denies inference/mutation operations.
const PENDING_LOCALE = createLocaleProfile("pt-BR");
const PENDING_SURFACE_LIFECYCLE = Object.freeze({
  schema: SURFACE_RENDER_LIFECYCLE_SCHEMA,
  localization: Object.freeze({
    schema: LOCALIZATION_SCHEMA,
    getLocale: () => "pt-BR",
    getProfile: () => PENDING_LOCALE,
    translate: (messageId) => messageId,
    subscribe: () => () => {},
  }),
  subscribeRender: () => () => {},
  getAppTarget: () => null,
  setAppTarget() {
    throw new TypeError("Pending Aura cannot control Surface app targets");
  },
});

export function createNativeIntelligenceClientPendingBootstrap({ installProvider } = {}) {
  if (!hasNativeExternalFirstPartyProbation("assistant") || getFirstPartyApp("assistant")) {
    return null;
  }
  return createNativePendingComponentHostBootstrap({
    componentId: "assistant",
    createPorts: () => Object.freeze({ surfaceLifecycle: PENDING_SURFACE_LIFECYCLE }),
    ...(installProvider ? { installProvider } : {}),
  });
}
