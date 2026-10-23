// Trusted *host-side* port binding for the single external Aura component.
// Product branding is owned by ordax-apps/app.json, never this policy module.
// No Native grant, Memory authority or model credentials cross this boundary.
import { createVerifiedSlotHostContextProvider } from "../../services/components/verified-host-context.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort } from "../../contracts/space-selection.mjs";
import { assertIntelligencePort } from "../../contracts/intelligence.mjs";

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
