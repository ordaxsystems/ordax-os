export const INTELLIGENCE_ARTIFACT_SCHEMA = "ordax.intelligence-artifact/1";

const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const KINDS = new Set([
  "inference-engine",
  "model",
  "embedding-model",
  "tool-runtime",
  "knowledge-pack",
]);
const ARCHES = new Set(["any", "x86_64", "aarch64"]);
const ACTIVATION = new Set(["bundled", "component-slot", "derived-index", "content-pack"]);

function text(value, label, max = 240) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} is outside bounds`);
  return normalized;
}

function id(value, label) {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function semver(value, label) {
  if (typeof value !== "string" || !SEMVER_RE.test(value)) throw new TypeError(`${label} must be semantic version`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function stringArray(value, label, maxItems = 32) {
  if (!Array.isArray(value) || value.length > maxItems) throw new TypeError(`${label} must be a bounded array`);
  const result = value.map((item) => text(item, label, 160));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze(result);
}

export function defineIntelligenceArtifact(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("Intelligence artifact must be an object");
  }
  if (!KINDS.has(spec.kind)) throw new TypeError("Intelligence artifact kind is unsupported");
  if (!ARCHES.has(spec.architecture)) throw new TypeError("Intelligence artifact architecture is unsupported");
  if (!ACTIVATION.has(spec.activationMode)) throw new TypeError("Intelligence artifact activation mode is unsupported");
  if (typeof spec.sha256 !== "string" || !SHA256_RE.test(spec.sha256)) {
    throw new TypeError("Intelligence artifact sha256 is invalid");
  }
  const minRamMiB = positiveInteger(spec.resources?.minRamMiB, "minRamMiB");
  const minDiskMiB = positiveInteger(spec.resources?.minDiskMiB, "minDiskMiB");
  const compatibility = spec.compatibility;
  if (!compatibility || typeof compatibility !== "object" || Array.isArray(compatibility)) {
    throw new TypeError("Intelligence artifact compatibility is required");
  }
  return Object.freeze({
    schema: INTELLIGENCE_ARTIFACT_SCHEMA,
    id: id(spec.id, "artifact id"),
    kind: spec.kind,
    version: semver(spec.version, "artifact version"),
    architecture: spec.architecture,
    activationMode: spec.activationMode,
    sha256: spec.sha256,
    sizeBytes: positiveInteger(spec.sizeBytes, "sizeBytes"),
    source: Object.freeze({
      uri: text(spec.source?.uri, "source uri", 512),
      revision: text(spec.source?.revision, "source revision", 160),
      license: text(spec.source?.license, "source license", 120),
    }),
    compatibility: Object.freeze({
      intelligenceContractMajor: positiveInteger(
        compatibility.intelligenceContractMajor,
        "intelligenceContractMajor",
      ),
      localAiContractMajor:
        compatibility.localAiContractMajor === null
          ? null
          : positiveInteger(compatibility.localAiContractMajor, "localAiContractMajor"),
      runtimeApis: stringArray(compatibility.runtimeApis ?? [], "runtimeApis"),
      requires: stringArray(compatibility.requires ?? [], "requires"),
      conflicts: stringArray(compatibility.conflicts ?? [], "conflicts"),
    }),
    resources: Object.freeze({
      minRamMiB,
      minDiskMiB,
      acceleratorOptional: spec.resources?.acceleratorOptional === true,
    }),
    security: Object.freeze({
      signatureRequired: spec.security?.signatureRequired === true,
      provenanceRequired: spec.security?.provenanceRequired === true,
      runtimeNetworkAllowed: spec.security?.runtimeNetworkAllowed === true,
      mutableHostAccessAllowed: spec.security?.mutableHostAccessAllowed === true,
    }),
  });
}

export function isArtifactCompatible(artifact, environment) {
  const value = defineIntelligenceArtifact(artifact);
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError("Compatibility environment is required");
  }
  if (
    value.architecture !== "any"
    && value.architecture !== environment.architecture
  ) return false;
  if (environment.ramMiB < value.resources.minRamMiB) return false;
  if (environment.diskMiB < value.resources.minDiskMiB) return false;
  if (environment.intelligenceContractMajor !== value.compatibility.intelligenceContractMajor) {
    return false;
  }
  if (
    value.compatibility.localAiContractMajor !== null
    && environment.localAiContractMajor !== value.compatibility.localAiContractMajor
  ) return false;
  const available = new Set(environment.runtimeApis ?? []);
  if (value.compatibility.runtimeApis.some((api) => !available.has(api))) return false;
  const capabilities = new Set(environment.capabilities ?? []);
  if (value.compatibility.requires.some((required) => !capabilities.has(required))) return false;
  if (value.compatibility.conflicts.some((conflict) => capabilities.has(conflict))) return false;
  return true;
}
