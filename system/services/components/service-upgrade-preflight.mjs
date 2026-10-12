import {
  validateComponentManifests,
  validateComponentId,
  validateComponentVersion,
} from "../../contracts/component-manifest.mjs";
import { validateComponentSlotSourceCommit } from "../../contracts/component-slot-source.mjs";
import {
  validateComponentCompatibility,
  validateComponentCompatibilityCatalog,
  evaluateComponentUpgrade,
} from "../../contracts/component-update-compatibility.mjs";

export const SERVICE_COMPATIBILITY_COVERAGE_SCHEMA =
  "ordax.service-compatibility-coverage/1";
export const SERVICE_UPGRADE_PREFLIGHT_SCHEMA =
  "ordax.service-upgrade-preflight/1";

function checkedCatalog(manifests, descriptors) {
  const components = validateComponentManifests(manifests);
  if (!Array.isArray(descriptors) || descriptors.length > 128) {
    throw new TypeError("Compatibility descriptors must be a bounded array");
  }
  const contracts = descriptors.length
    ? validateComponentCompatibilityCatalog(descriptors)
    : [];
  const byManifest = new Map(components.map((entry) => [entry.id, entry]));
  const byContract = new Map(contracts.map((entry) => [entry.componentId, entry]));
  for (const descriptor of contracts) {
    const manifest = byManifest.get(descriptor.componentId);
    if (!manifest) {
      throw new TypeError("Compatibility descriptor has no canonical manifest: " + descriptor.componentId);
    }
    if (manifest.version !== descriptor.componentVersion) {
      throw new TypeError("Compatibility descriptor version differs from canonical manifest: " + manifest.id);
    }
    for (const required of descriptor.requires) {
      const provider = contracts.find((entry) =>
        entry.componentId !== descriptor.componentId
        && entry.provides.some((offered) => offered.id === required.id
          && offered.major >= required.minMajor
          && offered.major <= required.maxMajor));
      if (provider && !manifest.dependencies.includes(provider.componentId)) {
        throw new TypeError("Manifest is missing declared contract provider dependency: "
          + manifest.id + " -> " + provider.componentId);
      }
    }
  }
  return { components, contracts, byManifest, byContract };
}

// Read-only completeness report. A missing descriptor is not replaced by an
// invented empty contract, and a valid descriptor is not a release permission.
export function deriveServiceCompatibilityCoverage({
  manifests, descriptors,
} = {}) {
  const { components, byContract } = checkedCatalog(manifests, descriptors);
  const entries = components.map((component) => Object.freeze({
    id: component.id,
    releaseMode: component.releaseMode,
    status: byContract.has(component.id)
      ? "declared-and-catalog-validated" : "descriptor-not-declared",
    productionEvidence: "not-evaluated",
  })).sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze({
    schema: SERVICE_COMPATIBILITY_COVERAGE_SCHEMA,
    authority: "none",
    components: Object.freeze(entries),
    summary: Object.freeze({
      total: entries.length,
      declared: entries.filter((entry) => entry.status === "declared-and-catalog-validated").length,
      missing: entries.filter((entry) => entry.status === "descriptor-not-declared").length,
    }),
  });
}

function preflightDecision(componentId, allowed, reasonCode, migrationRequired = false) {
  return Object.freeze({
    schema: SERVICE_UPGRADE_PREFLIGHT_SCHEMA,
    authority: "none",
    componentId,
    compatibilityAllowed: allowed,
    reasonCode,
    migrationRequired,
    // This source gate cannot verify a signed package, perform staging, grant
    // activation, run migration code, promote health or issue a receipt.
    signedPackageEvidence: "not-evaluated",
    activationEvidence: "not-evaluated",
  });
}

// Must be run with *verified current* descriptors by the activation owner.
// The caller remains responsible for signed release identity and current slot.
export function preflightServiceUpgrade({
  manifests,
  componentId,
  current,
  candidate,
  active,
  migrationPlan = null,
} = {}) {
  const id = validateComponentId(componentId);
  const catalog = validateComponentManifests(manifests);
  const manifest = catalog.find((entry) => entry.id === id);
  if (!manifest) {
    throw new TypeError("Upgrade preflight component has no canonical manifest");
  }
  if (manifest.releaseMode !== "component-slot") {
    return preflightDecision(id, false, "release-mode-not-component-slot");
  }
  if (!Array.isArray(active)) {
    throw new TypeError("Upgrade preflight requires explicit current active descriptors");
  }
  const existing = validateComponentCompatibility(current);
  const next = validateComponentCompatibility(candidate);
  if (existing.componentId !== id || next.componentId !== id) {
    return preflightDecision(id, false, "component-identity-mismatch");
  }
  // Once installed independently, the *verified active slot* may be newer
  // than the bundled source manifest. Never mistake that immutable source
  // version for the device's current installed version.
  const otherDescriptors = active.map(validateComponentCompatibility);
  if (new Set(otherDescriptors.map((item) => item.componentId)).size !== otherDescriptors.length
    || otherDescriptors.some((item) => item.componentId === id)) {
    throw new TypeError("Current active descriptors must be unique and exclude the candidate");
  }
  const knownIds = new Set(catalog.map((item) => item.id));
  for (const entry of otherDescriptors) {
    if (!knownIds.has(entry.componentId)) {
      throw new TypeError("Active component descriptor has no canonical manifest: " + entry.componentId);
    }
  }
  // A candidate may not be evaluated against an already incoherent active
  // contract set. Reuse the single canonical contract validator.
  try {
    validateComponentCompatibilityCatalog([existing, ...otherDescriptors]);
  } catch {
    return preflightDecision(id, false, "active-contract-snapshot-invalid");
  }
  const activeById = new Map(otherDescriptors.map((entry) => [entry.componentId, entry]));
  for (const consumer of catalog) {
    if (consumer.dependencies.includes(id) && !activeById.has(consumer.id)) {
      return preflightDecision(id, false, "active-consumer-descriptor-unavailable");
    }
  }
  const result = evaluateComponentUpgrade({
    current: existing,
    candidate: next,
    active: otherDescriptors,
    migrationPlan,
  });
  return preflightDecision(id, result.allowed, result.reasonCode, result.migrationRequired);
}

export const VERIFIED_SLOT_COMPATIBILITY_SCHEMA = "ordax.verified-slot-compatibility/1";
const TRUST_FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const INSPECTION_FIELDS = Object.freeze([
  "schema", "authority", "trustScope", "trustSHA256", "activationStatus",
  "componentId", "version", "sourceCommit", "descriptor",
]);

// A JSON report is not cryptographic proof by itself. Only the trusted
// Native runtime may call the verifier with its pinned key and recheck exact
// activation revision/identities. This parser never grants installation.
export function validateSlotCompatibilityInspection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...INSPECTION_FIELDS].sort().join(",")) {
    throw new TypeError("Signed slot compatibility inspection has invalid shape");
  }
  if (value.schema !== VERIFIED_SLOT_COMPATIBILITY_SCHEMA
    || value.authority !== "none"
    || value.trustScope !== "caller-supplied-public-anchor"
    || value.activationStatus !== "not-evaluated"
    || typeof value.trustSHA256 !== "string"
    || !TRUST_FINGERPRINT_RE.test(value.trustSHA256)) {
    throw new TypeError("Signed slot inspection may not claim pinned trust or activation");
  }
  const componentId = validateComponentId(value.componentId);
  const version = validateComponentVersion(value.version);
  const sourceCommit = validateComponentSlotSourceCommit(value.sourceCommit);
  const descriptor = validateComponentCompatibility(value.descriptor);
  if (descriptor.componentId !== componentId || descriptor.componentVersion !== version) {
    throw new TypeError("Signed slot inspection descriptor identity is inconsistent");
  }
  return Object.freeze({
    schema: VERIFIED_SLOT_COMPATIBILITY_SCHEMA,
    authority: "none",
    trustScope: "caller-supplied-public-anchor",
    trustSHA256: value.trustSHA256,
    activationStatus: "not-evaluated",
    componentId, version, sourceCommit, descriptor,
  });
}

// Diagnostic bridge: all descriptors come from the same supplied public
// anchor; this is still NOT proof that any report is active/current/pinned.
export function preflightServiceUpgradeInspections({
  manifests, componentId, currentInspection, candidateInspection,
  activeInspections, migrationPlan = null,
} = {}) {
  const id = validateComponentId(componentId);
  const current = validateSlotCompatibilityInspection(currentInspection);
  const candidate = validateSlotCompatibilityInspection(candidateInspection);
  if (!Array.isArray(activeInspections) || activeInspections.length > 128) {
    throw new TypeError("Explicit bounded active slot inspections are required");
  }
  const active = activeInspections.map(validateSlotCompatibilityInspection);
  if (current.componentId !== id || candidate.componentId !== id) {
    return preflightDecision(id, false, "component-identity-mismatch");
  }
  if ([candidate, ...active].some((item) => item.trustSHA256 !== current.trustSHA256)) {
    return preflightDecision(id, false, "public-trust-source-mismatch");
  }
  return preflightServiceUpgrade({
    manifests, componentId: id,
    current: current.descriptor,
    candidate: candidate.descriptor,
    active: active.map((item) => item.descriptor),
    migrationPlan,
  });
}

export const ACTIVATION_SLOT_COMPATIBILITY_SNAPSHOT_SCHEMA =
  "ordax.activation-slot-compatibility-snapshot/1";

const ACTIVATION_SNAPSHOT_FIELDS = Object.freeze([
  "schema", "authority", "componentId", "target", "revision",
  "pendingHealth", "trustScope", "trustSHA256", "verifiedSlot",
]);

export function validateActivationCompatibilitySnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...ACTIVATION_SNAPSHOT_FIELDS].sort().join(",")) {
    throw new TypeError("Canonical activation compatibility snapshot shape is invalid");
  }
  if (value.schema !== ACTIVATION_SLOT_COMPATIBILITY_SNAPSHOT_SCHEMA
    || value.authority !== "none"
    || value.trustScope !== "caller-supplied-public-anchor"
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || !["current", "pending"].includes(value.target)
    || !["unknown", "healthy", "failed"].includes(value.pendingHealth)) {
    throw new TypeError("Activation compatibility snapshot status is invalid");
  }
  const slot = validateSlotCompatibilityInspection(value.verifiedSlot);
  if (slot.componentId !== value.componentId ||
    slot.trustSHA256 !== value.trustSHA256) {
    throw new TypeError("Activation state must bind exact verified slot identity and trust");
  }
  return Object.freeze({
    schema: ACTIVATION_SLOT_COMPATIBILITY_SNAPSHOT_SCHEMA,
    authority: "none",
    componentId: slot.componentId,
    target: value.target,
    revision: value.revision,
    pendingHealth: value.pendingHealth,
    trustScope: "caller-supplied-public-anchor",
    trustSHA256: slot.trustSHA256,
    verifiedSlot: slot,
  });
}

// A source-only compatibility diagnostic for a staged, NOT-YET-ARMED
// candidate. The trusted host must recheck the activation revision under its
// existing activation lock before arm-pending; this result grants no authority.
export function preflightServiceUpgradeWithActivationSnapshots({
  manifests, componentId, currentSnapshot, candidateInspection,
  activeSnapshots, expectedRevision, migrationPlan = null,
} = {}) {
  const id = validateComponentId(componentId);
  const current = validateActivationCompatibilitySnapshot(currentSnapshot);
  const candidate = validateSlotCompatibilityInspection(candidateInspection);
  if (!Array.isArray(activeSnapshots) || activeSnapshots.length > 128) {
    throw new TypeError("Active current activation snapshots must be a bounded array");
  }
  const others = activeSnapshots.map(validateActivationCompatibilitySnapshot);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new TypeError("Expected canonical activation revision is required");
  }
  if (current.componentId !== id || candidate.componentId !== id
    || current.target !== "current") {
    return preflightDecision(id, false, "activation-snapshot-identity-mismatch");
  }
  if (current.revision !== expectedRevision) {
    return preflightDecision(id, false, "activation-revision-stale");
  }
  if (others.some((entry) => entry.target !== "current")) {
    return preflightDecision(id, false, "active-consumer-not-current");
  }
  const ids = others.map((entry) => entry.componentId);
  if (new Set(ids).size !== ids.length || ids.includes(id)) {
    throw new TypeError("Active activation snapshot IDs must be unique and exclude current");
  }
  return preflightServiceUpgradeInspections({
    manifests, componentId: id,
    currentInspection: current.verifiedSlot,
    candidateInspection: candidate,
    activeInspections: others.map((entry) => entry.verifiedSlot),
    migrationPlan,
  });
}
