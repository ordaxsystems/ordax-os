export const PROFILE_COMPONENT_INVENTORY_SCHEMA = "ordax.profile-component-inventory/1";
export const PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA = "ordax.profile-component-inventory-port/1";

const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMPONENT_KINDS = new Set([
  "app",
  "knowledge-pack",
  "skill-pack",
  "model-pack",
  "connector",
]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function componentId(value, label) {
  if (typeof value !== "string" || !COMPONENT_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function installedAt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond`);
  }
  return value;
}

export function validateProfileComponentInventoryEntry(
  value,
  label = "Profile component inventory entry",
) {
  const entry = objectValue(value, label);
  const id = componentId(entry.id, `${label}.id`);
  if (!COMPONENT_KINDS.has(entry.kind)) {
    throw new TypeError(`${label}.kind is invalid`);
  }
  return Object.freeze({
    id,
    kind: entry.kind,
    sha256: sha256(entry.sha256, `${label}.sha256`),
    installedAt: installedAt(entry.installedAt, `${label}.installedAt`),
    receiptSha256: sha256(entry.receiptSha256, `${label}.receiptSha256`),
  });
}

export function createEmptyProfileComponentInventory() {
  return Object.freeze({
    schema: PROFILE_COMPONENT_INVENTORY_SCHEMA,
    revision: 0,
    persistence: "session",
    entries: Object.freeze([]),
  });
}

export function validateProfileComponentInventory(value) {
  const inventory = objectValue(value, "Profile component inventory");
  if (inventory.schema !== PROFILE_COMPONENT_INVENTORY_SCHEMA) {
    throw new TypeError("Unsupported Profile component inventory schema");
  }
  if (!Number.isSafeInteger(inventory.revision) || inventory.revision < 0) {
    throw new TypeError("Profile component inventory revision is invalid");
  }
  if (!["device", "session"].includes(inventory.persistence)) {
    throw new TypeError("Profile component inventory persistence is invalid");
  }
  if (!Array.isArray(inventory.entries) || inventory.entries.length > 256) {
    throw new TypeError("Profile component inventory entries must be bounded");
  }
  const entries = inventory.entries.map((entry, index) =>
    validateProfileComponentInventoryEntry(
      entry,
      `Profile component inventory entry[${index}]`,
    ));
  const identities = new Set(entries.map((entry) => `${entry.id}@${entry.sha256}`));
  if (identities.size !== entries.length) {
    throw new TypeError("Profile component inventory contains duplicate content identity");
  }
  return Object.freeze({
    schema: PROFILE_COMPONENT_INVENTORY_SCHEMA,
    revision: inventory.revision,
    persistence: inventory.persistence,
    entries: Object.freeze(entries),
  });
}

export function assertProfileComponentInventoryPort(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== PROFILE_COMPONENT_INVENTORY_PORT_SCHEMA
    || typeof port.getSnapshot !== "function"
    || typeof port.refresh !== "function"
    || typeof port.dispose !== "function"
  ) {
    throw new TypeError("A compatible Profile component inventory port is required");
  }
  validateProfileComponentInventory(port.getSnapshot());
  return port;
}
