import { validateSpace } from "../../contracts/spaces.mjs";
import { resolveSpaceType } from "./composition.mjs";

export function describeSpacePresentation(spaceValue) {
  const space = validateSpace(spaceValue);
  const definition = resolveSpaceType(space);
  const hasExplicitSemantics = space.domain != null && space.subtype != null;
  return Object.freeze({
    typeKey: definition?.key ?? null,
    typeLabelId: definition?.labelId ?? null,
    semanticSource: definition === null
      ? "unknown"
      : hasExplicitSemantics
        ? "canonical-space"
        : "legacy-profile-fallback",
  });
}
