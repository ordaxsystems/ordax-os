export const PROFILE_PACK_RESTORE_SCHEMA = "ordax.profile-pack-restore/2";
export const PROFILE_PACK_RESTORE_ENTRY_SCHEMA = "ordax.profile-pack-restore-entry/2";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const SPACE_KINDS = new Set(["personal", "work", "professional"]);
const STATES = new Set(["inactive", "resolved", "disabled-safe"]);
const REASONS = new Set([
  null,
  "manifest-missing",
  "space-kind-mismatch",
  "profile-retired",
  "manifest-blocks-activation",
  "external-provider-required",
  "provisioning-plan-missing",
  "required-components-unavailable",
  "device-inventory-unavailable",
  "component-receipt-drift",
]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, fields, label) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length
    || actual.some((field, index) => field !== expected[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function boundedText(value, label, max) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value.includes("\0")
  ) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function profileOrNull(value, label) {
  if (value === null) return null;
  const profile = objectValue(value, label);
  exactFields(profile, ["slug", "version"], label);
  if (
    typeof profile.slug !== "string"
    || !SLUG_PATTERN.test(profile.slug)
    || !Number.isSafeInteger(profile.version)
    || profile.version < 1
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return Object.freeze({
    slug: boundedText(profile.slug, `${label}.slug`, 80),
    version: profile.version,
  });
}

export function validateProfilePackRestoreSnapshot(value) {
  const snapshot = objectValue(value, "Profile Pack restore snapshot");
  exactFields(
    snapshot,
    ["schema", "persistence", "application", "bootCritical", "entries"],
    "Profile Pack restore snapshot",
  );
  if (snapshot.schema !== PROFILE_PACK_RESTORE_SCHEMA) {
    throw new TypeError("Profile Pack restore schema is incompatible");
  }
  if (snapshot.persistence !== "device") {
    throw new TypeError("Profile Pack restore requires device persistence");
  }
  if (snapshot.application !== "metadata-only" || snapshot.bootCritical !== false) {
    throw new TypeError("Profile Pack restore must remain metadata-only and non boot-critical");
  }
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length > 64) {
    throw new TypeError("Profile Pack restore entries are outside bounds");
  }
  const entries = Object.freeze(snapshot.entries.map((value, index) => {
    const label = `Profile Pack restore entries[${index}]`;
    const entry = objectValue(value, label);
    exactFields(
      entry,
      ["schema", "subjectId", "spaceId", "spaceKind", "state", "reason", "profile", "activatedAt"],
      label,
    );
    if (entry.schema !== PROFILE_PACK_RESTORE_ENTRY_SCHEMA) {
      throw new TypeError(`${label} schema is incompatible`);
    }
    const subjectId = boundedText(entry.subjectId, `${label}.subjectId`, 200);
    const spaceId = boundedText(entry.spaceId, `${label}.spaceId`, 160);
    if (!SPACE_KINDS.has(entry.spaceKind)) {
      throw new TypeError(`${label}.spaceKind is invalid`);
    }
    if (!STATES.has(entry.state) || !REASONS.has(entry.reason)) {
      throw new TypeError(`${label} state or reason is invalid`);
    }
    if (entry.state === "resolved" && entry.reason !== null) {
      throw new TypeError(`${label} resolved state cannot carry a reason`);
    }
    if (entry.state === "disabled-safe" && entry.reason === null) {
      throw new TypeError(`${label} disabled-safe state requires a reason`);
    }
    if (
      entry.state === "inactive"
      && (entry.reason !== null || entry.profile !== null || entry.activatedAt !== null)
    ) {
      throw new TypeError(`${label} inactive state cannot carry Profile authority`);
    }
    const profile = profileOrNull(entry.profile, `${label}.profile`);
    if (entry.state !== "inactive" && profile === null) {
      throw new TypeError(`${label} active restore state requires Profile identity`);
    }
    return Object.freeze({
      schema: PROFILE_PACK_RESTORE_ENTRY_SCHEMA,
      subjectId,
      spaceId,
      spaceKind: entry.spaceKind,
      state: entry.state,
      reason: entry.reason,
      profile,
      activatedAt: entry.activatedAt === null
        ? null
        : Number.isSafeInteger(entry.activatedAt) && entry.activatedAt >= 0
          ? entry.activatedAt
          : (() => { throw new TypeError(`${label}.activatedAt is invalid`); })(),
    });
  }));
  const ids = new Set(entries.map((entry) => `${entry.subjectId}\u001f${entry.spaceId}`));
  if (ids.size !== entries.length) {
    throw new TypeError("Profile Pack restore contains duplicate subject/Space identities");
  }
  return Object.freeze({
    schema: PROFILE_PACK_RESTORE_SCHEMA,
    persistence: "device",
    application: "metadata-only",
    bootCritical: false,
    entries,
  });
}
