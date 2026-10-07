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
  if (typeof value === "string") {
    if (value.length > LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH) {
      throw new RangeError(
        `Localization interpolation value ${key} exceeds ${LOCALIZATION_INTERPOLATION_MAX_TEXT_LENGTH} characters`,
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Localization interpolation value ${key} must be finite`);
    }
    return String(value);
  }
  throw new TypeError(
    `Localization interpolation value ${key} must be text or a finite number`,
  );
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
