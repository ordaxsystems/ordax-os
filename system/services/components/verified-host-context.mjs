import { validateComponentId } from "../../contracts/component-manifest.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";

// A signed current slot is required; caller-supplied app identity grants nothing.
export function createVerifiedSlotHostContextProvider({componentId, verifiedCurrent = null, createPorts} = {}) {
  const id = validateComponentId(componentId);
  if (typeof createPorts !== "function") throw new TypeError("Verified component requires typed ports");
  return function verifiedSlotHostContext(requestedId) {
    if (requestedId !== id) return null;
    if (verifiedCurrent === null) throw new TypeError("Component requires a verified current Native slot identity");
    const current = validateComponentRuntimeMetadata(verifiedCurrent,{componentId:id,state:"current"});
    if (current.source !== "slot") throw new TypeError("Host ports require an installed current slot");
    return createPorts();
  };
}
