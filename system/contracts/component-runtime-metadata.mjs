import {
  validateComponentId,
} from "./component-manifest.mjs";
import {
  validateComponentSlotResolution,
  validateComponentSlotState,
} from "./component-slot-source.mjs";

const METADATA_FIELDS = Object.freeze([
  "componentId",
  "state",
  "source",
  "revision",
  "version",
  "sourceCommit",
  "entrypoint",
  "pendingHealth",
]);

function assertExactKeys(value) {
  const actual = Object.keys(value).sort();
  const expected = [...METADATA_FIELDS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("Component runtime metadata fields are not canonical");
  }
}

export function validateComponentRuntimeMetadata(
  value,
  { componentId: expectedComponentId = null, state: expectedState = null } = {},
) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Component runtime metadata must be a plain object");
  }
  assertExactKeys(value);

  const componentId = validateComponentId(value.componentId);
  const state = validateComponentSlotState(value.state);
  if (expectedComponentId !== null && componentId !== validateComponentId(expectedComponentId)) {
    throw new TypeError("Component runtime metadata component identity mismatch");
  }
  if (expectedState !== null && state !== validateComponentSlotState(expectedState)) {
    throw new TypeError("Component runtime metadata state mismatch");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Component runtime metadata revision is invalid");
  }

  if (value.source === "slot") {
    if (state === "current" && value.pendingHealth !== null) {
      throw new TypeError("Current component runtime metadata cannot carry pending health");
    }
    return validateComponentSlotResolution({
      componentId,
      state,
      source: "slot",
      revision: value.revision,
      version: value.version,
      sourceCommit: value.sourceCommit,
      entrypoint: value.entrypoint,
      pendingHealth: value.pendingHealth,
    });
  }

  if (
    state !== "current"
    || !["absent", "bundled", "removed"].includes(value.source)
    || value.version !== null
    || value.sourceCommit !== null
    || value.entrypoint !== null
    || value.pendingHealth !== null
  ) {
    throw new TypeError("Non-slot component runtime metadata is inconsistent");
  }

  return Object.freeze({
    componentId,
    state: "current",
    source: value.source,
    revision: value.revision,
    version: null,
    sourceCommit: null,
    entrypoint: null,
    pendingHealth: null,
  });
}
