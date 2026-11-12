import { assertProfilePackCatalogPort } from "../../contracts/profile-pack-catalog.mjs";
import {
  SPACE_CREATION_PREFLIGHT_SCHEMA,
  validateSpaceCreationIntent,
  validateSpaceCreationPreflight,
} from "../../contracts/space-creation.mjs";
import { getSpaceType } from "./type-catalog.mjs";

const NO_AUTHORITY = Object.freeze({
  createSpace: false,
  provisionProfile: false,
  activateProfile: false,
});

function typeProjection(definition) {
  return definition == null ? null : Object.freeze({
    key: definition.key,
    domain: definition.domain,
    subtype: definition.subtype,
    lifecycle: definition.lifecycle,
  });
}

function blocked(definition, reason) {
  return validateSpaceCreationPreflight({
    schema: SPACE_CREATION_PREFLIGHT_SCHEMA,
    state: "blocked",
    reason,
    type: typeProjection(definition),
    profile: null,
    nextStep: null,
    authority: NO_AUTHORITY,
  });
}

export function planSpaceCreationPreflight(intentValue, { profileCatalog } = {}) {
  const intent = validateSpaceCreationIntent(intentValue);
  const catalog = assertProfilePackCatalogPort(profileCatalog);
  const definition = getSpaceType(intent.domain, intent.subtype);
  if (definition === null) return blocked(null, "unknown-space-type");
  if (definition.lifecycle === "deferred") return blocked(definition, "space-type-deferred");

  const defaultProfile = definition.creationDefaultProfile;
  if (defaultProfile === null) {
    return blocked(definition, "creation-default-profile-missing");
  }

  const profile = catalog.get(defaultProfile.slug, defaultProfile.version);
  if (profile === null) {
    return blocked(definition, "creation-default-profile-unavailable");
  }

  return validateSpaceCreationPreflight({
    schema: SPACE_CREATION_PREFLIGHT_SCHEMA,
    state: "profile-resolved",
    reason: null,
    type: typeProjection(definition),
    profile: {
      slug: profile.slug,
      version: profile.version,
      identity: `${profile.slug}@${profile.version}`,
      title: profile.title,
      spaceKind: profile.spaceKind,
    },
    nextStep: "validate-profile-provisioning",
    authority: NO_AUTHORITY,
  });
}
