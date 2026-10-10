import { assertLocalizationMessageValue } from "../../contracts/localization.mjs";

export const LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH = 4096;

const PLACEHOLDER_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function assertValues(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Localization interpolation values must be an object");
  }
  return value;
}

function interpolationValue(value, key) {
  const resolved = assertLocalizationMessageValue(
    value,
    `Localization interpolation value ${key}`,
  );
  if (typeof resolved === "string") {
    if (resolved.length > LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH) {
      throw new RangeError(
        `Localization interpolation value ${key} exceeds ${LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH} UTF-16 code units`,
      );
    }
    return resolved;
  }
  return String(resolved);
}

export function interpolateLocalizationMessage(text, values = {}) {
  if (typeof text !== "string") {
    throw new TypeError("Localization message text must be a string");
  }
  const resolvedValues = assertValues(values);
  return text.replace(PLACEHOLDER_PATTERN, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(resolvedValues, key)) return match;
    const value = resolvedValues[key];
    if (value === undefined || value === null) return match;
    return interpolationValue(value, key);
  });
}
