export const PROFILE_PACK_SCHEMA = "ordax.profile-pack/1";
export const PROFILE_PACK_RUNTIME_SCHEMA = "ordax.profile-pack-runtime/1";
export const PROFILE_PACK_ACTIVATION_SCHEMA = "ordax.profile-pack-activation/1";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,79}$/;
const SPACE_KINDS = new Set(["personal", "work", "professional"]);
const PACK_STATES = new Set(["draft", "active", "retired"]);
const MEMORY_SCOPES = new Set(["device", "account", "space", "project", "session"]);
const COMPONENT_KINDS = new Set(["app", "knowledge-pack", "skill-pack", "model-pack", "connector"]);
const COMPONENT_AVAILABILITY = new Set(["available", "planned"]);
const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const VALIDATED_PROFILE_PACKS = new WeakSet();

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function boundedText(value, label, max = 160) {
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

function optionalText(value, label, max = 160) {
  if (value == null) return null;
  return boundedText(value, label, max);
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function textArray(value, label, maxItems = 32) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return Object.freeze(value.map((entry, index) => boundedText(entry, `${label}[${index}]`)));
}

function normalizeComponents(pack, label) {
  const value = pack.components ?? [];
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError(`${label} components must be a bounded array`);
  }
  const seen = new Set();
  return Object.freeze(value.map((raw, index) => {
    const component = objectValue(raw, `${label} components[${index}]`);
    const id = boundedText(component.id, `${label} components[${index}].id`, 128);
    const kind = boundedText(component.kind, `${label} components[${index}].kind`, 32);
    const version = boundedText(component.version, `${label} components[${index}].version`, 64);
    const availability = boundedText(component.availability, `${label} components[${index}].availability`, 16);
    const required = booleanValue(component.required, `${label} components[${index}].required`);
    const signatureRequired = booleanValue(
      component.signature_required,
      `${label} components[${index}].signature_required`,
    );
    if (!COMPONENT_KINDS.has(kind)) throw new TypeError(`${label} component kind is invalid`);
    if (!SEMVER_PATTERN.test(version)) throw new TypeError(`${label} component version is invalid`);
    if (!COMPONENT_AVAILABILITY.has(availability)) {
      throw new TypeError(`${label} component availability is invalid`);
    }
    const sha256 = component.sha256 == null ? null : boundedText(
      component.sha256,
      `${label} components[${index}].sha256`,
      64,
    );
    if (sha256 !== null && !SHA256_PATTERN.test(sha256)) {
      throw new TypeError(`${label} component sha256 is invalid`);
    }
    if (availability === "available" && (sha256 === null || !signatureRequired)) {
      throw new TypeError(`${label} available component requires hash and signature`);
    }
    if (availability === "planned" && sha256 !== null) {
      throw new TypeError(`${label} planned component cannot claim a publish hash`);
    }
    if (seen.has(id)) throw new TypeError(`${label} contains duplicate component id ${id}`);
    seen.add(id);
    return Object.freeze({
      id, kind, version, required, availability, sha256, signatureRequired,
    });
  }));
}

function normalizeSecurity(pack, label) {
  const security = objectValue(pack.security, `${label} security`);
  const autoGrantPrivileges = booleanValue(
    security.auto_grant_privileges,
    `${label} security.auto_grant_privileges`,
  );
  const allowUnsignedApps = booleanValue(
    security.allow_unsigned_apps,
    `${label} security.allow_unsigned_apps`,
  );
  const genericShellImplied = security.generic_shell_implied === undefined
    ? false
    : booleanValue(security.generic_shell_implied, `${label} security.generic_shell_implied`);
  const crossSpaceMemory = security.cross_space_memory === undefined
    ? false
    : booleanValue(security.cross_space_memory, `${label} security.cross_space_memory`);

  if (autoGrantPrivileges || allowUnsignedApps || genericShellImplied || crossSpaceMemory) {
    throw new TypeError(`${label} cannot broaden privilege, signature, shell or memory isolation policy`);
  }

  return Object.freeze({
    autoGrantPrivileges: false,
    allowUnsignedApps: false,
    genericShellImplied: false,
    crossSpaceMemory: false,
  });
}

function normalizeActivation(pack, label) {
  if (pack.activation === undefined) return null;
  const activation = objectValue(pack.activation, `${label} activation`);
  const publiclyAvailable = booleanValue(
    activation.publicly_available,
    `${label} activation.publicly_available`,
  );
  const reason = optionalText(activation.reason, `${label} activation.reason`, 240);
  if (!publiclyAvailable && reason === null) {
    throw new TypeError(`${label} unavailable activation must explain its reason`);
  }
  return Object.freeze({ publiclyAvailable, reason });
}

export function validateProfilePack(value, label = "Profile Pack") {
  const pack = objectValue(value, label);
  if (pack.$schema !== PROFILE_PACK_SCHEMA) {
    throw new TypeError(`${label} schema is incompatible`);
  }

  const slug = boundedText(pack.slug, `${label} slug`, 80);
  if (!SLUG_PATTERN.test(slug)) throw new TypeError(`${label} slug is invalid`);
  if (!Number.isSafeInteger(pack.version) || pack.version < 1) {
    throw new TypeError(`${label} version is invalid`);
  }
  if (!PACK_STATES.has(pack.state)) throw new TypeError(`${label} state is invalid`);
  if (!SPACE_KINDS.has(pack.space_kind)) throw new TypeError(`${label} space kind is invalid`);

  const knowledge = objectValue(pack.knowledge, `${label} knowledge`);
  const intelligence = objectValue(pack.intelligence, `${label} intelligence`);
  const memoryScopes = textArray(intelligence.memory_scopes, `${label} memory scopes`, 8);
  if (memoryScopes.some((scope) => !MEMORY_SCOPES.has(scope))) {
    throw new TypeError(`${label} memory scope is invalid`);
  }

  const externalProviderRequired = booleanValue(
    intelligence.external_provider_required,
    `${label} intelligence.external_provider_required`,
  );
  const preferredPurpose = optionalText(
    intelligence.preferred_purpose,
    `${label} intelligence.preferred_purpose`,
    80,
  );
  const jurisdiction = optionalText(
    pack.jurisdiction ?? knowledge.jurisdiction,
    `${label} jurisdiction`,
    80,
  );

  const normalized = Object.freeze({
    schema: PROFILE_PACK_SCHEMA,
    slug,
    version: pack.version,
    state: pack.state,
    title: boundedText(pack.title, `${label} title`, 120),
    category: boundedText(pack.category, `${label} category`, 80),
    spaceKind: pack.space_kind,
    apps: textArray(pack.apps, `${label} apps`),
    templates: textArray(pack.templates, `${label} templates`),
    components: normalizeComponents(pack, label),
    knowledge: Object.freeze({
      jurisdiction,
      sourceClasses: textArray(knowledge.source_classes, `${label} knowledge.source_classes`),
      refreshPolicy: boundedText(
        knowledge.refresh_policy,
        `${label} knowledge.refresh_policy`,
        80,
      ),
    }),
    intelligence: Object.freeze({
      memoryScopes,
      preferredPurpose,
      externalProviderRequired,
    }),
    security: normalizeSecurity(pack, label),
    activation: normalizeActivation(pack, label),
  });
  VALIDATED_PROFILE_PACKS.add(normalized);
  return normalized;
}

export function validateProfilePackCatalog(values, label = "Profile Pack catalog") {
  if (!Array.isArray(values) || values.length > 64) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const seen = new Set();
  const packs = values.map((candidate, index) => {
    const pack = validateProfilePack(candidate, `${label}[${index}]`);
    const identity = `${pack.slug}@${pack.version}`;
    if (seen.has(identity)) throw new TypeError(`${label} contains duplicate ${identity}`);
    seen.add(identity);
    return pack;
  });
  return Object.freeze(packs);
}

export function assertValidatedProfilePackCatalog(values, label = "Validated Profile Pack catalog") {
  if (!Array.isArray(values) || values.length > 64) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const seen = new Set();
  for (const [index, pack] of values.entries()) {
    if (!pack || typeof pack !== "object" || !VALIDATED_PROFILE_PACKS.has(pack)) {
      throw new TypeError(`${label}[${index}] must come from validateProfilePack()`);
    }
    const identity = `${pack.slug}@${pack.version}`;
    if (seen.has(identity)) {
      throw new TypeError(`${label} contains duplicate ${identity}`);
    }
    seen.add(identity);
  }
  return Object.freeze([...values]);
}

export function validateProfilePackSpace(value, label = "Profile Pack Space") {
  const space = objectValue(value, label);
  const id = boundedText(space.id, `${label} id`, 160);
  if (!SPACE_KINDS.has(space.kind)) throw new TypeError(`${label} kind is invalid`);
  return Object.freeze({ id, kind: space.kind });
}

export function assertProfilePackRuntime(port) {
  if (!port || typeof port !== "object" || port.schema !== PROFILE_PACK_RUNTIME_SCHEMA) {
    throw new TypeError("Compatible Profile Pack runtime is required");
  }
  for (const method of ["getSnapshot", "subscribe", "list", "get", "activate", "deactivate", "rollback", "dispose"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Profile Pack runtime must implement ${method}()`);
    }
  }
  return port;
}
