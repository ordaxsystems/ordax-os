import { validateComponentCompatibilityCatalog } from "../../system/contracts/component-update-compatibility.mjs";
import { coreRuntimeCompatibility } from "../../system/services/components/compatibility/core.mjs";

// The canonical catalog is the only source of component identities and
// compatibility descriptors. Never duplicate an ID-to-descriptor map here.
const catalog = validateComponentCompatibilityCatalog(coreRuntimeCompatibility);
const componentId = process.argv[2] ?? "";
const compatibility = catalog.find((entry) => entry.componentId === componentId);
if (!compatibility) {
  throw new Error(
    `No canonical runtime compatibility descriptor for ${componentId || "<empty>"}`,
  );
}

process.stdout.write(`${JSON.stringify(compatibility)}\n`);
