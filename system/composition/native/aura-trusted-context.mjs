// Trusted *host-side* port binding for the single external Aura component.
// Product branding is owned by ordax-apps/app.json, never this policy module.
// No Native grant, Memory authority or model credentials cross this boundary.
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { assertSpaceSelectionPort } from "../../contracts/space-selection.mjs";
import { assertIntelligencePort } from "../../contracts/intelligence.mjs";

export function createNativeAuraTrustedContextProvider({
  verifiedCurrent = null,
  identitySessionPort = null,
  spaceSelectionPort = null,
  intelligencePort = null,
} = {}) {
  return function nativeAuraTrustedContext(componentId) {
    if (componentId !== "assistant") return null;
    if (verifiedCurrent === null) {
      throw new TypeError("Aura requires a verified current Native component slot");
    }
    const current = validateComponentRuntimeMetadata(verifiedCurrent, {
      componentId: "assistant", state: "current",
    });
    if (current.source !== "slot") {
      throw new TypeError("Aura host ports require an installed signed current slot");
    }
    return Object.freeze({
      identitySessionPort: assertIdentitySessionPort(identitySessionPort),
      spaceSelectionPort: assertSpaceSelectionPort(spaceSelectionPort),
      intelligence: assertIntelligencePort(intelligencePort),
    });
  };
}
