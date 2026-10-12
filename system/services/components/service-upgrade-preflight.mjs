import {
  validateComponentManifests,
  validateComponentId,
} from "../../contracts/component-manifest.mjs";
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
    allowed,
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
  if (existing.componentVersion !== manifest.version) {
    return preflightDecision(id, false, "current-manifest-version-mismatch");
  }
  const otherDescriptors = active.map(validateComponentCompatibility);
  if (new Set(otherDescriptors.map((item) => item.componentId)).size !== otherDescriptors.length
    || otherDescriptors.some((item) => item.componentId === id)) {
    throw new TypeError("Current active descriptors must be unique and exclude the candidate");
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
