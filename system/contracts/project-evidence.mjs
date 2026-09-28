import { validateProjectId } from "./project-catalog.mjs";

export const PROJECT_EVIDENCE_SCHEMA = "ordax.project-evidence/1";
export const PROJECT_EVIDENCE_SNAPSHOT_SCHEMA = "ordax.project-evidence-snapshot/1";
export const MAX_PROJECT_EVIDENCE_ITEMS = 24;
export const MAX_PROJECT_EVIDENCE_TEXT_CHARS = 4096;
export const MAX_PROJECT_EVIDENCE_TOTAL_CHARS = 32768;

const EVIDENCE_KINDS = new Set([
  "readme",
  "manifest",
  "tests",
  "docs",
  "contracts",
  "artifacts",
  "guidance",
]);

function boundedVisibleText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validateProjectEvidenceItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project evidence item must be an object");
  }
  if (!EVIDENCE_KINDS.has(value.kind)) {
    throw new TypeError("Project evidence kind is invalid");
  }
  return Object.freeze({
    kind: value.kind,
    label: boundedVisibleText(value.label, "Project evidence label", 160),
    text: boundedVisibleText(value.text, "Project evidence text", MAX_PROJECT_EVIDENCE_TEXT_CHARS),
    provenance: boundedVisibleText(value.provenance, "Project evidence provenance", 256),
  });
}

export function validateProjectEvidenceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project evidence snapshot must be an object");
  }
  if (value.schema !== PROJECT_EVIDENCE_SNAPSHOT_SCHEMA) {
    throw new TypeError("Project evidence snapshot schema is invalid");
  }
  if (!Array.isArray(value.items) || value.items.length > MAX_PROJECT_EVIDENCE_ITEMS) {
    throw new TypeError("Project evidence items must be a bounded array");
  }
  const items = value.items.map(validateProjectEvidenceItem);
  const total = items.reduce((sum, item) => sum + item.text.length, 0);
  if (total > MAX_PROJECT_EVIDENCE_TOTAL_CHARS) {
    throw new TypeError("Project evidence exceeds its total text bound");
  }
  if (!Number.isSafeInteger(value.capturedAt) || value.capturedAt < 0) {
    throw new TypeError("Project evidence capturedAt is invalid");
  }
  if (value.readOnly !== true || value.authority !== "none") {
    throw new TypeError("Project evidence must remain read-only and non-authoritative");
  }
  return Object.freeze({
    schema: PROJECT_EVIDENCE_SNAPSHOT_SCHEMA,
    projectId: validateProjectId(value.projectId),
    capturedAt: value.capturedAt,
    items: Object.freeze(items),
    readOnly: true,
    authority: "none",
  });
}

export function assertProjectEvidencePort(port) {
  if (!port || typeof port !== "object" || port.schema !== PROJECT_EVIDENCE_SCHEMA) {
    throw new TypeError("A compatible project-evidence port is required");
  }
  if (typeof port.inspect !== "function") {
    throw new TypeError("Project-evidence port must implement inspect(projectId)");
  }
  return port;
}
