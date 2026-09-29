import {
  APPLICATION_COMPATIBILITY_INSPECTION_SCHEMA,
  assertApplicationCompatibilityPort,
} from "../../contracts/application-compatibility.mjs";
import {
  APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA,
  defineApplicationCompatibilityProfile,
  validateApplicationCompatibilityProfilePlan,
} from "../../contracts/application-compatibility-profile.mjs";

const PROFILE_ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function profileStorageKey(family, profileId) {
  return `application-compatibility/${family}/${profileId}`;
}

export function createApplicationCompatibilityProfilePlanner({ compatibility } = {}) {
  const port = assertApplicationCompatibilityPort(compatibility);

  function planCreate({ inspection, runtimeId = null, profileId, payloadDigest } = {}) {
    if (
      !inspection
      || typeof inspection !== "object"
      || inspection.schema !== APPLICATION_COMPATIBILITY_INSPECTION_SCHEMA
    ) {
      throw new TypeError("A validated application compatibility inspection is required");
    }
    if (typeof profileId !== "string" || !PROFILE_ID_RE.test(profileId)) {
      throw new TypeError("Compatibility profile id is invalid");
    }
    if (typeof payloadDigest !== "string" || !DIGEST_RE.test(payloadDigest)) {
      throw new TypeError("Compatibility profile payload digest must be sha256:<lowercase-hex>");
    }

    const launch = port.planLaunch({ inspection, runtimeId });
    if (!launch.ready || launch.runtimeId === null) {
      return validateApplicationCompatibilityProfilePlan({
        ready: false,
        reason: launch.reason,
        profile: null,
      });
    }

    const profile = defineApplicationCompatibilityProfile({
      id: profileId,
      family: inspection.family,
      runtimeId: launch.runtimeId,
      architecture: inspection.architecture,
      payload: {
        name: inspection.name,
        digest: payloadDigest,
      },
      storageKey: profileStorageKey(inspection.family, profileId),
      persistence: "durable-user",
      hostAuthority: "none",
    });

    return validateApplicationCompatibilityProfilePlan({
      ready: true,
      reason: "profile-plan-ready",
      profile,
    });
  }

  return Object.freeze({
    schema: APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA,
    planCreate,
  });
}
