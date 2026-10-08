export const PROFILE_ACTIVATION_STATE_SCHEMA = "ordax.profile-activation-state/1";
export const PROFILE_ACTIVATION_STATE_PORT_SCHEMA = "ordax.profile-activation-state-port/1";
export const MAX_PROFILE_ACTIVATION_SPACES = 64;
export const MAX_PROFILE_ACTIVATION_COMPONENTS = 64;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMPONENT_KINDS = new Set([
  "app",
  "knowledge-pack",
  "skill-pack",
  "model-pack",
  "connector",
]);
const PERSISTENCE = new Set(["device", "session"]);
const SPACE_KINDS = new Set(["personal", "work", "professional"]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((field, index) => field !== wanted[index])
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

function epoch(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch millisecond`);
  }
  return value;
}

function profileIdentity(value, label) {
  const profile = objectValue(value, label);
  exactFields(profile, ["slug", "version"], label);
  const slug = boundedText(profile.slug, `${label}.slug`, 80);
  if (!SLUG_PATTERN.test(slug)) throw new TypeError(`${label}.slug is invalid`);
  if (!Number.isSafeInteger(profile.version) || profile.version < 1) {
    throw new TypeError(`${label}.version is invalid`);
  }
  return Object.freeze({ slug, version: profile.version });
}

function componentRef(value, label) {
  const component = objectValue(value, label);
  exactFields(component, [
    "id",
    "kind",
    "version",
    "sha256",
    "receiptSha256",
    "installedAt",
  ], label);
  const id = boundedText(component.id, `${label}.id`, 128);
  if (!COMPONENT_ID_PATTERN.test(id)) throw new TypeError(`${label}.id is invalid`);
  if (!COMPONENT_KINDS.has(component.kind)) throw new TypeError(`${label}.kind is invalid`);
  const version = boundedText(component.version, `${label}.version`, 64);
  if (!SEMVER_PATTERN.test(version)) throw new TypeError(`${label}.version is invalid`);
  const sha256 = boundedText(component.sha256, `${label}.sha256`, 64);
  const receiptSha256 = boundedText(
    component.receiptSha256,
    `${label}.receiptSha256`,
    64,
  );
  if (!SHA256_PATTERN.test(sha256) || !SHA256_PATTERN.test(receiptSha256)) {
    throw new TypeError(`${label} hashes are invalid`);
  }
  return Object.freeze({
    id,
    kind: component.kind,
    version,
    sha256,
    receiptSha256,
    installedAt: epoch(component.installedAt, `${label}.installedAt`),
  });
}

export function validateProfileActivationRef(value, label = "Profile activation") {
  const activation = objectValue(value, label);
  exactFields(activation, ["profile", "components", "activatedAt"], label);
  if (
    !Array.isArray(activation.components)
    || activation.components.length > MAX_PROFILE_ACTIVATION_COMPONENTS
  ) {
    throw new TypeError(`${label}.components must be a bounded array`);
  }
  const components = Object.freeze(
    activation.components
      .map((entry, index) =>
        componentRef(entry, `${label}.components[${index}]`))
      .sort((left, right) =>
        `${left.id}@${left.version}@${left.sha256}`.localeCompare(
          `${right.id}@${right.version}@${right.sha256}`,
        )),
  );
  const identities = new Set(
    components.map((entry) => `${entry.id}@${entry.version}@${entry.sha256}`),
  );
  if (identities.size !== components.length) {
    throw new TypeError(`${label}.components contains duplicate identities`);
  }
  return Object.freeze({
    profile: profileIdentity(activation.profile, `${label}.profile`),
    components,
    activatedAt: epoch(activation.activatedAt, `${label}.activatedAt`),
  });
}

function activationOrNull(value, label) {
  return value === null ? null : validateProfileActivationRef(value, label);
}

function activationIdentity(value) {
  if (value === null) return null;
  return JSON.stringify({
    profile: value.profile,
    components: value.components.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      version: entry.version,
      sha256: entry.sha256,
      receiptSha256: entry.receiptSha256,
      installedAt: entry.installedAt,
    })),
  });
}

export function createEmptyProfileActivationState(persistence = "session") {
  if (!PERSISTENCE.has(persistence)) {
    throw new TypeError("Profile activation persistence is invalid");
  }
  return Object.freeze({
    schema: PROFILE_ACTIVATION_STATE_SCHEMA,
    revision: 0,
    persistence,
    spaces: Object.freeze([]),
  });
}

export function validateProfileActivationState(value) {
  const state = objectValue(value, "Profile activation state");
  exactFields(
    state,
    ["schema", "revision", "persistence", "spaces"],
    "Profile activation state",
  );
  if (state.schema !== PROFILE_ACTIVATION_STATE_SCHEMA) {
    throw new TypeError("Profile activation state schema is incompatible");
  }
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new TypeError("Profile activation state revision is invalid");
  }
  if (!PERSISTENCE.has(state.persistence)) {
    throw new TypeError("Profile activation state persistence is invalid");
  }
  if (
    !Array.isArray(state.spaces)
    || state.spaces.length > MAX_PROFILE_ACTIVATION_SPACES
  ) {
    throw new TypeError("Profile activation state spaces are outside bounds");
  }

  const spaces = Object.freeze(state.spaces.map((entry, index) => {
    const label = `Profile activation state spaces[${index}]`;
    const row = objectValue(entry, label);
    exactFields(row, ["spaceId", "spaceKind", "current", "previous"], label);
    const current = activationOrNull(row.current, `${label}.current`);
    const previous = activationOrNull(row.previous, `${label}.previous`);
    if (current === null && previous === null) {
      throw new TypeError(`${label} cannot be empty`);
    }
    if (
      current !== null
      && previous !== null
      && activationIdentity(current) === activationIdentity(previous)
    ) {
      throw new TypeError(`${label} current and previous must differ`);
    }
    const spaceKind = boundedText(row.spaceKind, `${label}.spaceKind`, 32);
    if (!SPACE_KINDS.has(spaceKind)) {
      throw new TypeError(`${label}.spaceKind is invalid`);
    }
    return Object.freeze({
      spaceId: boundedText(row.spaceId, `${label}.spaceId`, 160),
      spaceKind,
      current,
      previous,
    });
  }));
  const spaceIds = new Set(spaces.map((entry) => entry.spaceId));
  if (spaceIds.size !== spaces.length) {
    throw new TypeError("Profile activation state contains duplicate Space ids");
  }

  return Object.freeze({
    schema: PROFILE_ACTIVATION_STATE_SCHEMA,
    revision: state.revision,
    persistence: state.persistence,
    spaces,
  });
}

export function assertProfileActivationStatePort(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== PROFILE_ACTIVATION_STATE_PORT_SCHEMA
  ) {
    throw new TypeError("Compatible Profile activation state port is required");
  }
  for (const method of ["getSnapshot", "refresh", "dispose"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Profile activation state port must implement ${method}()`);
    }
  }
  if ("subscribe" in port && typeof port.subscribe !== "function") {
    throw new TypeError("Profile activation subscribe must be a function when provided");
  }
  validateProfileActivationState(port.getSnapshot());
  return port;
}


export function assertMutableProfileActivationStatePort(port) {
  assertProfileActivationStatePort(port);
  for (const method of ["previewActivation", "activate", "deactivate", "rollback"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Mutable Profile activation state port must implement ${method}()`);
    }
  }
  return port;
}
