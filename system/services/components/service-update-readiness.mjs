import { SERVICE_UPDATE_INVENTORY_SCHEMA } from "./service-update-inventory.mjs";

export const SERVICE_UPDATE_READINESS_SCHEMA = "ordax.service-update-readiness/1";
const PACKAGE_SCHEMA = "prototype-ordax.runtime-component-package-policy/1";

const REQUIRED_RUNTIME_GATES = Object.freeze([
  "canonical_component_trust_anchor_pinned",
  "slot_activation_available",
  "native_slot_serving_available",
  "pending_health_promotion_available",
  "rollback_slot_activation_available",
  "publish_allowed",
]);

function checkedUniqueIds(value, name) {
  if (!Array.isArray(value) || value.some((id) =>
    typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id))
  ) {
    throw new TypeError(name + " must contain component IDs");
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError(name + " must not contain duplicates");
  }
  return new Set(value);
}

function validatePolicy(policy, components) {
  if (!policy || policy.$schema !== PACKAGE_SCHEMA) {
    throw new TypeError("Canonical component-package policy is required");
  }
  const IDs = new Set(components.map((component) => component.id));
  const supported = checkedUniqueIds(policy.supported_components, "Supported components");
  const packagingOnly = checkedUniqueIds(policy.packaging_only_components, "Packaging-only components");
  for (const id of supported) {
    if (!IDs.has(id)) throw new TypeError("Package policy references unknown component: " + id);
  }
  for (const id of packagingOnly) {
    if (!supported.has(id)) throw new TypeError("Packaging-only component is not supported: " + id);
  }
  for (const field of REQUIRED_RUNTIME_GATES) {
    if (typeof policy[field] !== "boolean") {
      throw new TypeError("Package policy gate must be explicit boolean: " + field);
    }
  }
  // Where the canonical policy declares a release mode for a component,
  // the manifest must agree. Derive the policy key from the component ID;
  // never hand-maintain a second allowlist (Internet was previously omitted).
  for (const component of components) {
    const key = component.id.replaceAll("-", "_") + "_release_mode";
    if (Object.hasOwn(policy, key) && policy[key] !== component.releaseMode) {
      throw new TypeError(
        "Canonical release mode mismatch between manifest and package policy: " + component.id,
      );
    }
  }
  return { supported, packagingOnly };
}

// Read-only report. Package-policy flags describe prerequisites, never installed
// state, signed receipts, compatibility verdicts or authorization to publish.
export function deriveNativeServiceUpdateReadiness({ inventory, packagePolicy } = {}) {
  if (!inventory || inventory.schema !== SERVICE_UPDATE_INVENTORY_SCHEMA
    || inventory.authority !== "none" || !Array.isArray(inventory.components)
    || !Array.isArray(inventory.domains)) {
    throw new TypeError("Validated read-only service inventory is required");
  }
  const { supported, packagingOnly } = validatePolicy(packagePolicy, inventory.components);
  const components = inventory.components.map((component) => {
    const packagingCandidate = supported.has(component.id);
    const blockers = [];
    if (component.releaseMode !== "component-slot") {
      blockers.push("not-component-slot");
    }
    if (!packagingCandidate) blockers.push("no-canonical-package-policy");
    if (packagingOnly.has(component.id)) blockers.push("packaging-proof-only");
    if (component.releaseMode === "component-slot" && packagingCandidate) {
      for (const gate of REQUIRED_RUNTIME_GATES) {
        if (!packagePolicy[gate]) blockers.push("release-gate-closed:" + gate);
      }
    }
    // Even a completely open contract is not proof of a signed artifact,
    // current activation, exact compatibility, health or physical deployment.
    return Object.freeze({
      id: component.id,
      releaseMode: component.releaseMode,
      packagingCandidate,
      policyAssessment: blockers.length > 0 ? "blocked" : "proof-required",
      blockers: Object.freeze(blockers),
      productionEvidence: "not-evaluated",
    });
  });
  const componentById = new Map(components.map((c) => [c.id, c]));
  const domains = inventory.domains.map((domain) => Object.freeze({
    path: domain.path,
    componentIds: domain.componentIds,
    policyAssessment: domain.componentIds.length === 0
      ? "embedded-no-component"
      : domain.componentIds.some((id) => componentById.get(id)?.policyAssessment !== "blocked")
        ? "component-proof-required" : "bundle-or-development-only",
    productionEvidence: "not-evaluated",
  }));

  return Object.freeze({
    schema: SERVICE_UPDATE_READINESS_SCHEMA,
    authority: "none",
    policySource: PACKAGE_SCHEMA,
    components: Object.freeze(components),
    domains: Object.freeze(domains),
    summary: Object.freeze({
      componentCount: components.length,
      serviceDomainCount: domains.length,
      packagingCandidates: components.filter((c) => c.packagingCandidate).length,
      blockedComponents: components.filter((c) => c.policyAssessment === "blocked").length,
      proofRequiredComponents: components.filter((c) => c.policyAssessment === "proof-required").length,
      productionEvidence: "not-evaluated",
    }),
  });
}
