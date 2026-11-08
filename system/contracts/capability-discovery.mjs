export const CAPABILITY_DISCOVERY_SCHEMA = "ordax.capability-discovery/1";

const SNAPSHOT_FIELDS = new Set([
  "schema", "revision", "revisionScope", "authority", "toolExecution", "entries",
]);
const ENTRY_FIELDS = new Set([
  "id", "kind", "ownerId", "availability", "reason", "actionId",
  "inputSchema", "riskClass", "confirmation", "execution", "authority",
]);
const JSON_SCHEMA_FIELDS = new Set([
  "type", "maxLength", "minimum", "maximum", "enum", "pattern", "description",
]);
const RISK_CLASSES = new Set(["read-only", "local-change", "external-effect", "privileged"]);
const CONFIRMATIONS = new Set(["none", "policy-gated", "always"]);
const CAPABILITY_ID = /^(?:app:[a-z][a-z0-9-]{0,127}:[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*|system:[a-z0-9]+(?:[.-][a-z0-9]+)*)$/;
const ARGUMENT_ID = /^[a-z][a-z0-9-]{0,63}$/;

function exact(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new TypeError(label + " has undeclared field: " + key);
  }
}
function inputSchema(value) {
  exact(value, new Set(["type", "properties", "required", "additionalProperties"]),
    "Capability input schema");
  if (value.type !== "object" || value.additionalProperties !== false ||
      !Array.isArray(value.required) || value.required.length > 24) {
    throw new TypeError("Capability input schema must be a closed object");
  }
  const properties = value.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties) ||
      Object.keys(properties).length > 24) {
    throw new TypeError("Capability input properties are invalid");
  }
  for (const [name, parameter] of Object.entries(properties)) {
    if (!ARGUMENT_ID.test(name)) throw new TypeError("Capability input parameter id is invalid");
    exact(parameter, JSON_SCHEMA_FIELDS, "Capability input parameter");
    if (!["string", "boolean", "integer", "number"].includes(parameter.type)) {
      throw new TypeError("Capability input type is invalid");
    }
    if (parameter.maxLength != null && (parameter.type !== "string" ||
        !Number.isSafeInteger(parameter.maxLength) ||
        parameter.maxLength < 1 || parameter.maxLength > 8192)) {
      throw new TypeError("Capability input maxLength is invalid");
    }
    if (parameter.enum != null && (!Array.isArray(parameter.enum) ||
        parameter.type !== "string" ||
        parameter.enum.length < 1 || parameter.enum.length > 64 ||
        parameter.enum.some(item => typeof item !== "string" ||
          item.length < 1 || item.length > 160) ||
        new Set(parameter.enum).size !== parameter.enum.length)) {
      throw new TypeError("Capability input enum is invalid");
    }
    if (parameter.minimum != null && (!Number.isFinite(parameter.minimum) ||
        !["integer", "number"].includes(parameter.type))) {
      throw new TypeError("Capability input minimum is invalid");
    }
    if (parameter.maximum != null && (!Number.isFinite(parameter.maximum) ||
        !["integer", "number"].includes(parameter.type))) {
      throw new TypeError("Capability input maximum is invalid");
    }
    if (parameter.minimum != null && parameter.maximum != null &&
        parameter.minimum > parameter.maximum) {
      throw new TypeError("Capability input numeric bounds are inconsistent");
    }
    if (parameter.pattern != null && (parameter.type !== "string" ||
        parameter.pattern !== "^[a-z][a-z0-9-]{0,127}$")) {
      throw new TypeError("Capability input pattern is unsupported");
    }
    if (parameter.description != null &&
        (typeof parameter.description !== "string" ||
        parameter.description.length > 1024)) {
      throw new TypeError("Capability input description is invalid");
    }
  }
  if (new Set(value.required).size !== value.required.length ||
      value.required.some(key => !Object.hasOwn(properties, key))) {
    throw new TypeError("Capability required arguments must be declared and unique");
  }
}

export function validateCapabilityDiscoverySnapshot(snapshot) {
  exact(snapshot, SNAPSHOT_FIELDS, "Capability discovery");
  if (snapshot.schema !== CAPABILITY_DISCOVERY_SCHEMA ||
      !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 ||
      snapshot.revisionScope !== "session" || snapshot.authority !== "none" ||
      snapshot.toolExecution !== false || !Array.isArray(snapshot.entries) ||
      snapshot.entries.length > 1024) {
    throw new TypeError("Capability discovery envelope is invalid");
  }
  const ids = new Set();
  for (const entry of snapshot.entries) {
    exact(entry, ENTRY_FIELDS, "Capability discovery entry");
    if (typeof entry.id !== "string" || !CAPABILITY_ID.test(entry.id) ||
        ids.has(entry.id) || entry.authority !== "none" ||
        entry.execution !== "unavailable") {
      throw new TypeError("Capability discovery entry is invalid or has execution authority");
    }
    ids.add(entry.id);
    if (entry.kind === "system-state") {
      // This namespace belongs exclusively to Native action declarations.
      // Never let a generic service state impersonate a semantic action ID.
      if (entry.id.startsWith("system:action.")) {
        throw new TypeError("System discovery entry uses reserved native action namespace");
      }
      if (typeof entry.ownerId !== "string" ||
          !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entry.ownerId) ||
          !["reported-available", "unavailable"].includes(entry.availability) ||
          entry.actionId !== null || entry.inputSchema !== null ||
          entry.riskClass !== null || entry.confirmation !== null ||
          (entry.reason !== null && typeof entry.reason !== "string")) {
        throw new TypeError("System discovery entry is inconsistent");
      }
    } else if (entry.kind === "application-action") {
      if (entry.id !== "app:" + entry.ownerId + ":" + entry.actionId ||
          entry.availability !== "declared-only" || entry.reason !== null ||
          !RISK_CLASSES.has(entry.riskClass) ||
          !CONFIRMATIONS.has(entry.confirmation)) {
        throw new TypeError("Application discovery identity is inconsistent");
      }
      inputSchema(entry.inputSchema);
    } else if (entry.kind === "native-action") {
      if (typeof entry.ownerId !== "string" ||
          !/^[a-z][a-z0-9-]{0,159}$/.test(entry.ownerId) ||
          typeof entry.actionId !== "string" ||
          !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(entry.actionId) ||
          !entry.id.startsWith("system:action.") ||
          entry.availability !== "declared-only" || entry.reason !== null ||
          !RISK_CLASSES.has(entry.riskClass) ||
          entry.confirmation !== "always") {
        throw new TypeError("Native action discovery is inconsistent");
      }
      inputSchema(entry.inputSchema);
      if (Object.keys(entry.inputSchema.properties).length !== 1 ||
          entry.inputSchema.properties["resource-value"]?.type !== "string" ||
          entry.inputSchema.properties["resource-value"]?.maxLength !== 8192 ||
          entry.inputSchema.required.length !== 1 ||
          entry.inputSchema.required[0] !== "resource-value") {
        throw new TypeError("Native action discovery input is inconsistent");
      }
    } else {
      throw new TypeError("Capability discovery kind is unknown");
    }
  }
  return snapshot;
}
