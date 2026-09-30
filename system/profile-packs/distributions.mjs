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
    profile: Object.freeze({ slug: "pizzaria-br", version: 1 }),
    deliveryMode: "bundled",
    metadataBundled: true,
    offlineAfterInstall: true,
    publicInstallEnabled: true,
    blockedReason: null,
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

  for (const component of pack.components) {
    if (
      component.availability === "available"
      && policy.deliveryMode === "on-demand"
      && !Object.prototype.hasOwnProperty.call(policy.componentSizes, component.id)
    ) {
      throw new TypeError(
        `On-demand published Profile component ${component.id} requires delivery size metadata`,
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
  const policiesByIdentity = new Map(
    DELIVERY_POLICIES.map((policy) => [identity(policy.profile), policy]),
  );

  const distributions = validated.map((pack) => {
    const key = identity(pack);
    const policy = policiesByIdentity.get(key);
    if (!policy) {
      throw new TypeError(
        `Bundled Profile Pack ${key} has no local delivery policy`,
      );
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
