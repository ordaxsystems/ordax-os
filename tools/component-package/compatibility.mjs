import {
  intelligenceCompatibility,
  localAiCompatibility,
} from "../../system/services/components/compatibility/core.mjs";

const COMPATIBILITY_BY_COMPONENT = Object.freeze({
  "local-ai-service": localAiCompatibility,
  "ordax-intelligence": intelligenceCompatibility,
});

const componentId = process.argv[2] ?? "";
const compatibility = COMPATIBILITY_BY_COMPONENT[componentId];
if (!compatibility) {
  throw new Error(
    `No canonical runtime compatibility descriptor for ${componentId || "<empty>"}`,
  );
}

process.stdout.write(`${JSON.stringify(compatibility)}\n`);
