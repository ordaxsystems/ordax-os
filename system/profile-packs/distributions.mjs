import { assertValidatedProfilePackCatalog } from "../contracts/profile-pack.mjs";
import { validateProfileDistribution } from "../contracts/profile-provisioning.mjs";

const DELIVERY_POLICIES = Object.freeze([
  Object.freeze({
    profile: Object.freeze({ slug: "developer", version: 1 }),
    deliveryMode: "bundled",
    metadataBundled: true,
    offlineAfterInstall: true,
    publicInstallEnabled: false,
    blockedReason:
      "MVP Developer Profile remains an internal composition proof until persistent provisioning and public package trust are promoted.",
    componentSizes: Object.freeze({}),
  }),
  Object.freeze({
    profile: Object.freeze({ slug: "legal-br", version: 1 }),
    deliveryMode: "on-demand",
    metadataBundled: true,
    offlineAfterInstall: true,
    publicInstallEnabled: false,
    blockedReason:
      "Legal-BR remains unavailable until signed official-source knowledge, domain validation and public provisioning trust are implemented.",
    componentSizes: Object.freeze({}),
  }),
]);

function identity(profile) {
  return `${profile.slug}@${profile.version}`;
}

function distributionFromPack(pack, policy) {
  const manifestComponentIds = new Set(pack.components.map((component) => component.id));
  for (const componentId of Object.keys(policy.componentSizes)) {
    if (!manifestComponentIds.has(componentId)) {
      throw new TypeError(
        `Profile delivery policy references unknown manifest component ${componentId}`,
      );
    }
  }

  return validateProfileDistribution({
    $schema: "ordax.profile-distribution/1",
    profile: { slug: pack.slug, version: pack.version },
    delivery_mode: policy.deliveryMode,
    metadata_bundled: policy.metadataBundled,
    offline_after_install: policy.offlineAfterInstall,
    public_install_enabled: policy.publicInstallEnabled,
    blocked_reason: policy.blockedReason,
    components: pack.components.map((component) => ({
      id: component.id,
      kind: component.kind,
      version: component.version,
      required: component.required,
      availability: component.availability,
      sha256: component.sha256,
      size_bytes: policy.componentSizes[component.id] ?? null,
      signature_required: component.signatureRequired,
    })),
  });
}

export function createLocalProfileDistributions(packs) {
  const validated = assertValidatedProfilePackCatalog(packs);
  const packsByIdentity = new Map(
    validated.map((pack) => [identity(pack), pack]),
  );
  const policyIdentities = new Set(DELIVERY_POLICIES.map((policy) => identity(policy.profile)));

  for (const pack of validated) {
    if (!policyIdentities.has(identity(pack))) {
      throw new TypeError(
        `Bundled Profile Pack ${identity(pack)} has no local delivery policy`,
      );
    }
  }

  const distributions = DELIVERY_POLICIES.map((policy) => {
    const key = identity(policy.profile);
    const pack = packsByIdentity.get(key);
    if (!pack) {
      throw new TypeError(`Local Profile delivery policy ${key} has no canonical manifest`);
    }
    return distributionFromPack(pack, policy);
  });

  return Object.freeze(distributions);
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
