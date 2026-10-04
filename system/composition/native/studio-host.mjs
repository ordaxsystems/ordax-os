import { assertStudioRuntimeV2Port } from "../../contracts/studio-runtime-v2.mjs";
import { assertMemoryPort } from "../../contracts/memory.mjs";
import { assertIntelligencePort } from "../../contracts/intelligence.mjs";
import { assertLocalizationPort } from "../../contracts/localization.mjs";

export const NATIVE_STUDIO_HOST_COMPOSITION_SCHEMA =
  "prototype-ordax.studio-native-host-composition/2";

const INPUT_FIELDS = Object.freeze([
  "studioRuntime",
  "memory",
  "intelligence",
  "localization",
]);

function assertExactInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Studio native host composition input must be an object");
  }
  const actual = Object.keys(value).sort();
  const expected = [...INPUT_FIELDS].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("Studio native host composition fields are incompatible");
  }
  return value;
}

export function createNativeStudioHostComposition(value) {
  const input = assertExactInput(value);
  const studioRuntime = assertStudioRuntimeV2Port(input.studioRuntime);
  const memory = assertMemoryPort(input.memory);
  const intelligence = assertIntelligencePort(input.intelligence);
  const localization = assertLocalizationPort(input.localization);

  return Object.freeze({
    schema: NATIVE_STUDIO_HOST_COMPOSITION_SCHEMA,
    authority: "none",
    target: "ordax-os",
    studioRuntime,
    memory,
    intelligence,
    localization,
  });
}
