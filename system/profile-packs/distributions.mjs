import { assertValidatedProfilePackCatalog } from "../contracts/profile-pack.mjs";
import { validateProfileDistribution } from "../contracts/profile-provisioning.mjs";

export const LOCAL_PROFILE_DELIVERY_POLICIES = Object.freeze([
  Object.freeze({
    profile: Object.freeze({ slug: "developer", version: 1 }),
    deliveryMode: "bundled",
    metadataBundled: true,
    offlineAfterInstall: true,
    publicInstallEnabled: false,
    blockedReason:
      "MVP Developer Profile remains an internal composition proof until persistent provisioning and public package trust are promoted.",
  }),
  Object.freeze({
    profile: Object.freeze({ slug: "legal-br", version: 1 }),
    deliveryMode: "on-demand",
    metadataBundled: true,
    offlineAfterInstall: true,
    publicInstallEnabled: false,
    blockedReason:
      "Legal-BR remains unavailable until signed official-source knowledge, domain validation and public provisioning trust are implemented.",
  }),
]);

function identity(profile) {
  return `${profile.slug}@${profile.version}`;
}

function componentFromManifest(component) {
  return {
    id: component.id,
    kind: component.kind,
    version: component.version,
    required: component.required,
    availability: component.availability,
    sha256: component.sha256,
    size_bytes: component.sizeBytes,
    signature_required: component.signatureRequired,
  };
}

export function createLocalProfileDistributions(packs) {
  const validatedPacks = assertValidatedProfilePackCatalog(
    packs,
    "Local Profile distribution source",
  );
  const policyByIdentity = new Map();
  for (const policy of LOCAL_PROFILE_DELIVERY_POLICIES) {
    const key = identity(policy.profile);
    if (policyByIdentity.has(key)) {
      throw new TypeError(`Duplicate Profile delivery policy ${key}`);
    }
    policyByIdentity.set(key, policy);
  }

  const packIdentities = new Set(validatedPacks.map((pack) =>
    identity({ slug: pack.slug, version: pack.version })));
  for (const key of policyByIdentity.keys()) {
    if (!packIdentities.has(key)) {
      throw new TypeError(`Profile delivery policy has no canonical manifest ${key}`);
    }
  }

  return Object.freeze(validatedPacks.map((pack) => {
    const key = identity({ slug: pack.slug, version: pack.version });
    const policy = policyByIdentity.get(key);
    if (!policy) {
      throw new TypeError(`Canonical Profile manifest has no delivery policy ${key}`);
    }
    return validateProfileDistribution({
      $schema: "ordax.profile-distribution/1",
      profile: { slug: pack.slug, version: pack.version },
      delivery_mode: policy.deliveryMode,
      metadata_bundled: policy.metadataBundled,
      offline_after_install: policy.offlineAfterInstall,
      public_install_enabled: policy.publicInstallEnabled,
      blocked_reason: policy.blockedReason,
      components: pack.components.map(componentFromManifest),
    }, `Local Profile distribution ${key}`);
  }));
}

export function getLocalProfileDistribution(distributions, slug, version) {
  if (!Array.isArray(distributions)) {
    throw new TypeError("Profile distribution lookup requires a distribution catalog");
  }
  if (typeof slug !== "string" || !Number.isSafeInteger(version)) {
    throw new TypeError("Profile distribution lookup requires exact slug and version");
  }
  return distributions.find(
    (distribution) =>
      distribution.profile.slug === slug && distribution.profile.version === version,
  ) ?? null;
}
