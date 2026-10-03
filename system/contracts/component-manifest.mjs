export const COMPONENT_MANIFEST_SCHEMA = "ordax.component-manifest/1";

const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MAX_COMPONENT_VERSION_CHARS = 128;
const COMPONENT_KINDS = new Set(["base", "shell", "service", "app"]);
const RELEASE_MODES = new Set(["base-ab", "component-slot", "git-app", "bundled"]);
const CRITICALITIES = new Set(["boot-critical", "system", "optional"]);
const FAILURE_DOMAINS = new Set(["boot", "surface", "service", "app"]);
const RESTART_SCOPES = new Set(["reboot", "surface", "component", "none"]);
const HEALTH_MODES = new Set(["boot", "surface", "process", "runtime", "none"]);

function text(value, label, max = 120) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

export function validateComponentId(value) {
  if (typeof value !== "string" || !COMPONENT_ID_RE.test(value)) {
    throw new TypeError("Component id is invalid");
  }
  return value;
}

export function validateComponentVersion(value) {
  if (
    typeof value !== "string"
    || value.length > MAX_COMPONENT_VERSION_CHARS
    || !SEMVER_RE.test(value)
  ) {
    throw new TypeError("Component version must be bounded semantic version x.y.z");
  }
  return value;
}

function parseComponentVersion(value) {
  const version = validateComponentVersion(value);
  const match = SEMVER_RE.exec(version);
  return Object.freeze({
    version,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] == null ? Object.freeze([]) : Object.freeze(match[4].split(".")),
  });
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^[0-9]+$/.test(left);
  const rightNumeric = /^[0-9]+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareComponentVersions(leftValue, rightValue) {
  const left = parseComponentVersion(leftValue);
  const right = parseComponentVersion(rightValue);
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    if (index >= left.prerelease.length) return -1;
    if (index >= right.prerelease.length) return 1;
    const compared = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function componentVersionIsNewer(candidate, current) {
  return compareComponentVersions(candidate, current) > 0;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new TypeError(`Unsupported ${label}: ${String(value)}`);
  }
  return value;
}

function dependencies(componentId, value) {
  if (!Array.isArray(value)) {
    throw new TypeError("Component dependencies must be an array");
  }
  const result = value.map(validateComponentId);
  if (new Set(result).size !== result.length || result.includes(componentId)) {
    throw new TypeError("Component dependencies must be unique and cannot reference self");
  }
  return Object.freeze(result);
}

export function defineComponentManifest(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Component manifest must be an object");
  }

  const id = validateComponentId(spec.id);
  const kind = enumValue(spec.kind, COMPONENT_KINDS, "component kind");
  const releaseMode = enumValue(spec.releaseMode, RELEASE_MODES, "release mode");
  const criticality = enumValue(spec.criticality, CRITICALITIES, "criticality");
  const failureDomain = enumValue(spec.failureDomain, FAILURE_DOMAINS, "failure domain");
  const restartScope = enumValue(spec.restartScope, RESTART_SCOPES, "restart scope");
  const healthMode = enumValue(spec.healthMode, HEALTH_MODES, "health mode");

  if (releaseMode === "base-ab") {
    if (
      kind !== "base"
      || criticality !== "boot-critical"
      || failureDomain !== "boot"
      || restartScope !== "reboot"
      || healthMode !== "boot"
    ) {
      throw new TypeError("A/B release mode is reserved for the boot-critical base");
    }
  } else if (kind === "base") {
    throw new TypeError("The OrdaX base must use A/B release mode");
  }

  if (["component-slot", "git-app"].includes(releaseMode) && restartScope === "reboot") {
    throw new TypeError("Independent components must not require a full reboot");
  }
  if (releaseMode === "git-app" && kind !== "app") {
    throw new TypeError("Git development release mode is reserved for apps");
  }

  if (kind === "app" && failureDomain !== "app") {
    throw new TypeError("App components must declare app as their failure domain");
  }

  return Object.freeze({
    schema: COMPONENT_MANIFEST_SCHEMA,
    id,
    title: text(spec.title, "Component title"),
    kind,
    version: validateComponentVersion(spec.version),
    releaseMode,
    criticality,
    failureDomain,
    restartScope,
    healthMode,
    owner: text(spec.owner, "Component owner", 220),
    dependencies: dependencies(id, spec.dependencies ?? []),
  });
}

export function validateComponentManifests(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new TypeError("Component manifest catalog must be a bounded non-empty array");
  }
  const manifests = value.map((manifest) => defineComponentManifest(manifest));
  if (new Set(manifests.map((manifest) => manifest.id)).size !== manifests.length) {
    throw new TypeError("Component ids must be unique");
  }
  const ids = new Set(manifests.map((manifest) => manifest.id));
  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies) {
      if (!ids.has(dependency)) {
        throw new TypeError(
          `Component ${manifest.id} depends on unknown component ${dependency}`,
        );
      }
    }
  }

  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (componentId) => {
    if (visited.has(componentId)) return;
    if (visiting.has(componentId)) {
      throw new TypeError(`Component dependency cycle detected at ${componentId}`);
    }
    visiting.add(componentId);
    for (const dependency of manifestById.get(componentId).dependencies) {
      visit(dependency);
    }
    visiting.delete(componentId);
    visited.add(componentId);
  };
  for (const manifest of manifests) visit(manifest.id);

  return Object.freeze(manifests);
}

export function componentSupportsIndependentUpdate(manifest) {
  const validated = defineComponentManifest(manifest);
  return validated.releaseMode === "component-slot";
}

export function componentUsesGitDevelopmentUpdate(manifest) {
  const validated = defineComponentManifest(manifest);
  return validated.releaseMode === "git-app";
}
