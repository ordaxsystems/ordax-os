export const NETWORK_PROFILE_AFFILIATIONS_SCHEMA = "ordax.network-profile-affiliations/1";

const PROFILE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$/;
const COMMUNITY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireBoolean(value, expected, label) {
  if (value !== expected) {
    throw new TypeError(`${label} must be ${expected}`);
  }
}

function requireNonEmptyString(value, label, max = 120) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function requireStringArray(value, label, pattern) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const seen = new Set();
  return Object.freeze(value.map((entry, index) => {
    requireNonEmptyString(entry, `${label}[${index}]`);
    if (!pattern.test(entry)) throw new TypeError(`${label}[${index}] has an invalid identifier`);
    if (seen.has(entry)) throw new TypeError(`${label} contains duplicate ${entry}`);
    seen.add(entry);
    return entry;
  }));
}

export function validateNetworkProfileAffiliations(value, { knownProfiles = null } = {}) {
  const root = requirePlainObject(value, "Network profile affiliations");
  if (root.$schema !== NETWORK_PROFILE_AFFILIATIONS_SCHEMA) {
    throw new TypeError("Network profile affiliations schema is incompatible");
  }
  if (root.status !== "mvp-catalog") throw new TypeError("Network profile affiliations status is incompatible");

  const rules = requirePlainObject(root.rules, "rules");
  requireBoolean(rules.recommendation_only, true, "rules.recommendation_only");
  requireBoolean(rules.auto_join, false, "rules.auto_join");
  requireBoolean(rules.auto_publish_space, false, "rules.auto_publish_space");
  requireBoolean(rules.membership_server_authoritative, true, "rules.membership_server_authoritative");

  const communitiesRaw = requirePlainObject(root.communities, "communities");
  const communities = {};
  for (const [communityId, raw] of Object.entries(communitiesRaw)) {
    if (!COMMUNITY_ID.test(communityId)) throw new TypeError(`Invalid community id ${communityId}`);
    const community = requirePlainObject(raw, `communities.${communityId}`);
    const title = requireNonEmptyString(community.title, `communities.${communityId}.title`);
    const kind = requireNonEmptyString(community.kind, `communities.${communityId}.kind`);
    const jurisdiction = requireNonEmptyString(community.jurisdiction, `communities.${communityId}.jurisdiction`, 16);
    if (!/^[A-Z]{2}$/.test(jurisdiction)) throw new TypeError(`communities.${communityId}.jurisdiction must be an ISO-like country code`);
    if (community.visibility !== "discoverable") throw new TypeError(`communities.${communityId}.visibility is unsupported`);
    if (community.join_policy !== "explicit-consent") throw new TypeError(`communities.${communityId}.join_policy must require explicit consent`);
    communities[communityId] = Object.freeze({
      title,
      kind,
      jurisdiction,
      visibility: community.visibility,
      joinPolicy: community.join_policy,
    });
  }

  const profilesRaw = requirePlainObject(root.profiles, "profiles");
  const profiles = {};
  for (const [profileId, raw] of Object.entries(profilesRaw)) {
    if (!PROFILE_ID.test(profileId)) throw new TypeError(`Invalid profile identity ${profileId}`);
    if (knownProfiles && !knownProfiles.has(profileId)) throw new TypeError(`Unknown Profile identity ${profileId}`);
    const profile = requirePlainObject(raw, `profiles.${profileId}`);
    const categories = requireStringArray(profile.directory_categories, `profiles.${profileId}.directory_categories`, CATEGORY);
    const recommended = requireStringArray(profile.recommended_communities, `profiles.${profileId}.recommended_communities`, COMMUNITY_ID);
    for (const communityId of recommended) {
      if (!Object.hasOwn(communities, communityId)) {
        throw new TypeError(`Profile ${profileId} references unknown community ${communityId}`);
      }
    }
    profiles[profileId] = Object.freeze({
      directoryCategories: categories,
      recommendedCommunities: recommended,
    });
  }

  return Object.freeze({
    schema: NETWORK_PROFILE_AFFILIATIONS_SCHEMA,
    status: root.status,
    rules: Object.freeze({
      recommendationOnly: true,
      autoJoin: false,
      autoPublishSpace: false,
      membershipServerAuthoritative: true,
    }),
    profiles: Object.freeze(profiles),
    communities: Object.freeze(communities),
  });
}
