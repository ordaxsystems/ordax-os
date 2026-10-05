import { validateDeviceActionRequestV2 } from "./device-action-envelope-v2.mjs";

export const STUDIO_ACTION_CATALOG_V2_SCHEMA = "ordax.studio-action-catalog/2";

const MODES = new Set(["read", "write"]);
const SCOPES = new Set(["project", "device"]);
const CAPABILITY_RE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const PARAMETER_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_METADATA_FIELDS = new Set([
  "operation",
  "execute",
  "localAction",
  "deviceAgent",
  "grant",
  "authorization",
  "provider",
  "command",
  "shell",
]);

export const STUDIO_ACTION_CATALOG_V2_SOURCE = Object.freeze({
  repository: "washingtonmsdj/mcp-blender",
  commit: "c09128c320c02a2cf82e32a0f9119164e3455eff",
  path: "ordax_dev_agent/product_gateway.py",
  productVersion: "0.4.1",
});

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function parameter(value) {
  if (typeof value !== "string" || !PARAMETER_RE.test(value) || value === "project") {
    throw new TypeError("Studio action catalog parameter id is invalid or duplicates top-level scope");
  }
  return value;
}

export function validateStudioActionCatalogV2Entry(value) {
  exactKeys(value, ["capability", "mode", "scope", "parameters"], "Studio action catalog v2 entry");
  if (typeof value.capability !== "string" || !CAPABILITY_RE.test(value.capability)) {
    throw new TypeError("Studio action catalog capability id is invalid");
  }
  if (!MODES.has(value.mode)) throw new TypeError("Studio action catalog mode is invalid");
  if (!SCOPES.has(value.scope)) throw new TypeError("Studio action catalog scope is invalid");
  if (!Array.isArray(value.parameters) || value.parameters.length > 32) {
    throw new TypeError("Studio action catalog parameters are invalid or unbounded");
  }
  const parameters = value.parameters.map(parameter);
  if (new Set(parameters).size !== parameters.length) {
    throw new TypeError("Studio action catalog parameter ids must be unique");
  }
  for (const field of Object.keys(value)) {
    if (FORBIDDEN_METADATA_FIELDS.has(field)) {
      throw new TypeError("Studio action catalog exposes forbidden implementation/authority metadata");
    }
  }
  return Object.freeze({
    capability: value.capability,
    mode: value.mode,
    scope: value.scope,
    parameters: Object.freeze([...parameters].sort()),
  });
}

const ENTRIES = [
  { capability: "projects.list", mode: "read", scope: "device", parameters: [] },
  { capability: "project.inventory", mode: "read", scope: "project", parameters: ["max_depth", "max_entries"] },
  { capability: "project.text_read", mode: "read", scope: "project", parameters: ["path"] },
  { capability: "project.search_text", mode: "read", scope: "project", parameters: ["query", "max_results", "max_files", "case_sensitive"] },
  { capability: "project.preview_status", mode: "read", scope: "project", parameters: [] },
  { capability: "agent.project_health", mode: "read", scope: "project", parameters: [] },
  { capability: "agent.project_briefing", mode: "read", scope: "project", parameters: ["query", "recall_limit"] },
  { capability: "git.diff", mode: "read", scope: "project", parameters: ["paths"] },
  { capability: "project.text_write", mode: "write", scope: "project", parameters: ["path", "content", "expected_sha256", "create"] },
  { capability: "project.text_patch", mode: "write", scope: "project", parameters: ["path", "expected_sha256", "replacements"] },
].map(validateStudioActionCatalogV2Entry);

export const STUDIO_ACTION_CATALOG_V2 = Object.freeze({
  schema: STUDIO_ACTION_CATALOG_V2_SCHEMA,
  authority: "none",
  source: STUDIO_ACTION_CATALOG_V2_SOURCE,
  entries: Object.freeze(ENTRIES),
});

export function validateStudioActionCatalogV2(value) {
  exactKeys(value, ["schema", "authority", "source", "entries"], "Studio action catalog v2");
  if (value.schema !== STUDIO_ACTION_CATALOG_V2_SCHEMA || value.authority !== "none") {
    throw new TypeError("Studio action catalog v2 schema/authority is invalid");
  }
  exactKeys(value.source, ["repository", "commit", "path", "productVersion"], "Studio action catalog v2 source");
  for (const key of Object.keys(STUDIO_ACTION_CATALOG_V2_SOURCE)) {
    if (value.source[key] !== STUDIO_ACTION_CATALOG_V2_SOURCE[key]) {
      throw new TypeError("Studio action catalog v2 source provenance is incompatible");
    }
  }
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 64) {
    throw new TypeError("Studio action catalog v2 entries are invalid or unbounded");
  }
  const entries = value.entries.map(validateStudioActionCatalogV2Entry);
  const capabilities = entries.map(({ capability }) => capability);
  if (new Set(capabilities).size !== capabilities.length) {
    throw new TypeError("Studio action catalog v2 capability ids must be unique");
  }
  return Object.freeze({
    schema: STUDIO_ACTION_CATALOG_V2_SCHEMA,
    authority: "none",
    source: STUDIO_ACTION_CATALOG_V2_SOURCE,
    entries: Object.freeze(entries),
  });
}

export function studioActionCatalogV2Entry(capability) {
  if (typeof capability !== "string") return null;
  return STUDIO_ACTION_CATALOG_V2.entries.find((entry) => entry.capability === capability) ?? null;
}

export function validateStudioActionCatalogV2Request(value) {
  const request = validateDeviceActionRequestV2(value);
  const entry = studioActionCatalogV2Entry(request.capability);
  if (entry === null) {
    throw new TypeError("Device action capability is not in the Studio action catalog v2");
  }

  if (entry.scope === "project" && request.projectId === null) {
    throw new TypeError("Project-scoped Studio action requires top-level projectId");
  }
  if (entry.scope === "device" && request.projectId !== null) {
    throw new TypeError("Device-scoped Studio action must not carry projectId");
  }

  const allowed = new Set(entry.parameters);
  const provided = Object.keys(request.parameters);
  if (provided.includes("project")) {
    throw new TypeError("Studio action project scope must come from top-level projectId");
  }
  const unsupported = provided.filter((field) => !allowed.has(field));
  if (unsupported.length > 0) {
    throw new TypeError(`Device action contains unsupported Studio parameter(s): ${unsupported.sort().join(", ")}`);
  }

  return Object.freeze({ request, entry });
}
