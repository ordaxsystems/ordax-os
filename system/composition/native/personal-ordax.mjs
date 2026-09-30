import { createNativePersonalOrdaxStore } from "../../adapters/native/personal-ordax.mjs";
import { createPersonalOrdaxRuntime } from "../../services/personal-ordax/runtime.mjs";

export function createNativePersonalOrdaxComposition({
  windowRef = globalThis.window,
  identitySession,
  spaceSelection = null,
  projects = null,
  intelligence,
} = {}) {
  if (!windowRef || typeof windowRef !== "object") {
    throw new TypeError("Native Personal OrdaX composition requires a window-like host");
  }

  return createPersonalOrdaxRuntime({
    identitySessionPort: identitySession,
    spaceSelectionPort: spaceSelection,
    projectCatalogPort: projects,
    intelligencePort: intelligence,
    store: createNativePersonalOrdaxStore(windowRef),
  });
}
