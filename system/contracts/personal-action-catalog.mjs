export const PERSONAL_ACTION_CATALOG_SCHEMA = "ordax.personal-action-catalog/1";
export const PERSONAL_ACTION_ENTRY_SCHEMA = "ordax.personal-action-entry/1";

const EFFECTS = new Set(["read", "write", "external-egress", "device-control"]);
const INPUT_KINDS = new Set(["resource-value"]);

function text(value, label, max = 200) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validatePersonalActionEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Personal action entry must be an object");
  }
  const effect = text(value.effect, "Personal action entry effect", 40);
  if (!EFFECTS.has(effect)) {
    throw new TypeError("Personal action entry effect is invalid");
  }
  const inputKind = text(value.inputKind, "Personal action entry input kind", 80);
  if (!INPUT_KINDS.has(inputKind)) {
    throw new TypeError("Personal action entry input kind is invalid");
  }
  const toolArtifactSha256 = text(
    value.toolArtifactSha256,
    "Personal action entry tool artifact sha256",
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(toolArtifactSha256)) {
    throw new TypeError("Personal action entry tool artifact sha256 is invalid");
  }
  return Object.freeze({
    schema: PERSONAL_ACTION_ENTRY_SCHEMA,
    id: text(value.id, "Personal action entry id", 160),
    toolId: text(value.toolId, "Personal action entry tool id", 160),
    toolArtifactSha256,
    actionId: text(value.actionId, "Personal action entry action id", 160),
    effect,
    inputKind,
    resourceScheme: text(value.resourceScheme, "Personal action entry resource scheme", 80),
  });
}

export function assertPersonalActionCatalog(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== PERSONAL_ACTION_CATALOG_SCHEMA
  ) {
    throw new TypeError("Compatible Personal action catalog is required");
  }
  for (const method of ["list", "propose", "request"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Personal action catalog must implement ${method}()`);
    }
  }
  const entries = value.list();
  if (!Array.isArray(entries)) {
    throw new TypeError("Personal action catalog list() must return an array");
  }
  entries.map(validatePersonalActionEntry);
  return value;
}
