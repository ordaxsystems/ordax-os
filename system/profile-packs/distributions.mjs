import { validateProfileDistribution } from "../contracts/profile-provisioning.mjs";

const developer = validateProfileDistribution({
  $schema: "ordax.profile-distribution/1",
  profile: { slug: "developer", version: 1 },
  delivery_mode: "bundled",
  metadata_bundled: true,
  offline_after_install: true,
  public_install_enabled: false,
  blocked_reason:
    "MVP Developer Profile remains an internal composition proof until persistent provisioning and public package trust are promoted.",
  components: [],
});

const legalBr = validateProfileDistribution({
  $schema: "ordax.profile-distribution/1",
  profile: { slug: "legal-br", version: 1 },
  delivery_mode: "on-demand",
  metadata_bundled: true,
  offline_after_install: true,
  public_install_enabled: false,
  blocked_reason:
    "Legal-BR remains unavailable until signed official-source knowledge, domain validation and public provisioning trust are implemented.",
  components: [
    {
      id: "knowledge.legal-br-core",
      kind: "knowledge-pack",
      version: "0.1.0",
      required: true,
      availability: "planned",
      sha256: null,
      size_bytes: null,
      signature_required: true,
    },
    {
      id: "skill.legal-document-review",
      kind: "skill-pack",
      version: "0.1.0",
      required: true,
      availability: "planned",
      sha256: null,
      size_bytes: null,
      signature_required: true,
    },
  ],
});

export const LOCAL_PROFILE_DISTRIBUTIONS = Object.freeze([developer, legalBr]);

export function getLocalProfileDistribution(slug, version) {
  if (typeof slug !== "string" || !Number.isSafeInteger(version)) {
    throw new TypeError("Profile distribution lookup requires exact slug and version");
  }
  return LOCAL_PROFILE_DISTRIBUTIONS.find(
    (distribution) =>
      distribution.profile.slug === slug && distribution.profile.version === version,
  ) ?? null;
}
