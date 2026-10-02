export const PERSONAL_ACTION_PROPOSAL_SCHEMA = "ordax.personal-action-proposal/1";

const ALLOWED_KEYS = new Set([
  "schema",
  "workItemId",
  "entryId",
  "resourceValue",
  "rationale",
  "authority",
  "executionAuthorized",
  "approvalRequested",
]);

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  "toolId",
  "actionId",
  "effect",
  "resourceRef",
  "grantRef",
  "approvalId",
  "toolArtifactSha256",
  "decision",
  "authoritySource",
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

export function validatePersonalActionProposal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal action proposal must be an object");
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_AUTHORITY_KEYS.has(key)) {
      throw new TypeError(`Personal action proposal cannot carry authority field: ${key}`);
    }
    if (!ALLOWED_KEYS.has(key)) {
      throw new TypeError(`Personal action proposal contains undeclared field: ${key}`);
    }
  }

  if (
    value.schema !== undefined
    && value.schema !== PERSONAL_ACTION_PROPOSAL_SCHEMA
  ) {
    throw new TypeError("Personal action proposal schema is incompatible");
  }
  if (value.authority !== "none") {
    throw new TypeError("Personal action proposal authority must remain none");
  }
  if (value.executionAuthorized !== false || value.approvalRequested !== false) {
    throw new TypeError("Personal action proposal cannot authorize execution or request approval");
  }

  return Object.freeze({
    schema: PERSONAL_ACTION_PROPOSAL_SCHEMA,
    workItemId: boundedText(value.workItemId, "Personal action proposal work item id", 160),
    entryId: boundedText(value.entryId, "Personal action proposal entry id", 160),
    resourceValue: boundedText(value.resourceValue, "Personal action proposal resource value", 512),
    rationale: boundedText(value.rationale, "Personal action proposal rationale", 1000),
    authority: "none",
    executionAuthorized: false,
    approvalRequested: false,
  });
}
