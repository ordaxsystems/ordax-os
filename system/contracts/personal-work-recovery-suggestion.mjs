export const PERSONAL_WORK_RECOVERY_SUGGESTION_SCHEMA =
  "ordax.personal-work-recovery-suggestion/1";

const ALLOWED_KEYS = new Set([
  "schema",
  "workItemId",
  "rationale",
  "authority",
  "automaticResumeAuthorized",
  "contextSwitchAuthorized",
]);

function boundedText(value, label, max) {
  if (
    typeof value !== "string"
    || value.includes("\0")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new TypeError(`${label} must be bounded text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

export function validatePersonalWorkRecoverySuggestion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal Work recovery suggestion must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new TypeError(
        `Personal Work recovery suggestion contains undeclared field: ${key}`,
      );
    }
  }
  if (
    value.schema !== undefined
    && value.schema !== PERSONAL_WORK_RECOVERY_SUGGESTION_SCHEMA
  ) {
    throw new TypeError("Personal Work recovery suggestion schema is incompatible");
  }
  if (value.authority !== "none") {
    throw new TypeError("Personal Work recovery suggestion authority must remain none");
  }
  if (
    value.automaticResumeAuthorized !== false
    || value.contextSwitchAuthorized !== false
  ) {
    throw new TypeError(
      "Personal Work recovery suggestion cannot authorize resume or context switching",
    );
  }
  return Object.freeze({
    schema: PERSONAL_WORK_RECOVERY_SUGGESTION_SCHEMA,
    workItemId: boundedText(
      value.workItemId,
      "Personal Work recovery suggestion work item id",
      160,
    ),
    rationale: boundedText(
      value.rationale,
      "Personal Work recovery suggestion rationale",
      1000,
    ),
    authority: "none",
    automaticResumeAuthorized: false,
    contextSwitchAuthorized: false,
  });
}
