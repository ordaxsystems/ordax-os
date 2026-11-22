// Source: ordax-os/system/services/local-ai/model-compatibility.mjs @ 6f5a34a47374601f546f25c1b5351ec9376c39bc
export function bindModelCompatibilityContracts({ hardware, systemMetrics, candidate } = {}) {
  if (typeof hardware?.validateHardwareInventorySnapshot !== "function"
      || typeof systemMetrics?.validateSystemMetricsSnapshot !== "function"
      || !candidate || typeof candidate !== "object") {
    throw new TypeError("Canonical OS hardware, metrics and model candidate are required");
  }
  const { validateHardwareInventorySnapshot } = hardware;
  const { validateSystemMetricsSnapshot } = systemMetrics;
  const BUNDLED_LOCAL_AI_MODEL_CANDIDATE = candidate;
const LOCAL_AI_MODEL_COMPATIBILITY_SCHEMA = "ordax.local-ai-model-compatibility/1";

function expectedArchitecture(candidate) {
  if (candidate.artifactPlatform === "linux-x86_64") return "x86_64";
  throw new TypeError("Local AI model has no supported artifact architecture");
}

function normalizeArchitecture(value) {
  if (value === "x86_64" || value === "amd64" || value === "AMD64") return "x86_64";
  if (value === "aarch64" || value === "arm64") return "aarch64";
  return value;
}

function validateCandidate(value) {
  if (
    !value || value.schema !== "ordax.local-ai-model-candidate/1"
    || typeof value.id !== "string" || !value.id
    || !Number.isSafeInteger(value.modelBytes) || value.modelBytes <= 0
    || !Number.isSafeInteger(value.engineBytes) || value.engineBytes <= 0
    // Independently safe inputs can still overflow their computed lower
    // bound. Never surface rounded/unsafe byte counts to Store consumers.
    || !Number.isSafeInteger(value.modelBytes + value.engineBytes)
    || value.releaseMode !== "signed-system-release"
    || value.independentInstallAvailable !== false
    || value.independentUpdateAvailable !== false
    || value.benchmarkQualified !== false
    || value.memoryMinimumBytes !== null
    || value.memoryRecommendedBytes !== null
  ) {
    throw new TypeError("Local AI Store model candidate is not a reviewed read-only release preview");
  }
  expectedArchitecture(value);
  return value;
}

/**
 * Compatibility evidence and installation authority are deliberately separate.
 * An architecture match proves only that the pinned ELF targets this CPU family.
 * With no validated RAM/performance threshold the Store MUST NOT label it ready.
 * User storage free space is not the verified component artifact storage volume.
 */
function assessBundledLocalAiModel({
  candidate = BUNDLED_LOCAL_AI_MODEL_CANDIDATE,
  hardware = null,
  metrics = null,
} = {}) {
  const model = validateCandidate(candidate);
  const device = hardware === null ? null : validateHardwareInventorySnapshot(hardware);
  const resources = metrics === null ? null : validateSystemMetricsSnapshot(metrics);
  const architecture = device ? normalizeArchitecture(device.architecture) : null;
  const architectureMatches = architecture === null
    ? null
    : architecture === expectedArchitecture(model);

  return Object.freeze({
    schema: LOCAL_AI_MODEL_COMPATIBILITY_SCHEMA,
    modelId: model.id,
    status: architectureMatches === false
      ? "blocked-architecture"
      : architectureMatches === true
        ? "architecture-compatible-performance-unverified"
        : "device-not-assessed",
    artifactArchitecture: expectedArchitecture(model),
    deviceArchitecture: architecture,
    architectureMatches,
    memoryTotalBytes: resources?.memoryTotalBytes ?? null,
    memoryAvailableBytes: resources?.memoryAvailableBytes ?? null,
    userStorageFreeBytes: resources?.userStorageFreeBytes ?? null,
    minimumMemoryBytes: null,
    recommendedMemoryBytes: null,
    minimumInstallStorageBytes: null,
    modelAndEngineBytesLowerBound: model.modelBytes + model.engineBytes,
    gpuRequired: false,
    benchmarkQualified: false,
    independentInstallAvailable: false,
    independentUpdateAvailable: false,
    // This preview never confuses a source pin with activated/signed component state.
    installedOrUpdateVerified: false,
  });
}

  return Object.freeze({ assessBundledLocalAiModel, LOCAL_AI_MODEL_COMPATIBILITY_SCHEMA });
}
