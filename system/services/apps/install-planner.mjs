import {
  FIRST_PARTY_APP_INSTALL_PLAN_SCHEMA,
  FIRST_PARTY_APP_INSTALL_PLANNER_SCHEMA,
  defineFirstPartyAppInstallArtifact,
  validateFirstPartyAppInstallPlan,
} from "../../contracts/first-party-app-install-plan.mjs";
import {
  getFirstPartyAppDeliveryPolicy,
  projectFirstPartyAppDelivery,
} from "./delivery-policy.mjs";

function blocked(appId, reason) {
  return validateFirstPartyAppInstallPlan({
    schema: FIRST_PARTY_APP_INSTALL_PLAN_SCHEMA,
    appId,
    ready: false,
    reason,
    artifact: null,
    authority: "none",
  });
}

export function createFirstPartyAppInstallPlanner() {
  return Object.freeze({
    schema: FIRST_PARTY_APP_INSTALL_PLANNER_SCHEMA,

    planInstall({
      appId,
      observation,
      artifact = null,
    }) {
      const policy = getFirstPartyAppDeliveryPolicy(appId);
      if (!policy) {
        throw new TypeError(`Unknown first-party app delivery id: ${String(appId)}`);
      }

      const projection = projectFirstPartyAppDelivery(appId, observation);

      if (policy.deliveryClass === "structural") {
        return blocked(appId, "policy-not-installable");
      }
      if (observation.installed) {
        return blocked(appId, "already-installed");
      }
      if (observation.transition !== "idle") {
        return blocked(appId, "lifecycle-busy");
      }
      if (observation.blockedReason !== null) {
        return blocked(appId, "platform-blocked");
      }
      if (!observation.catalogued || projection.state === "not-catalogued") {
        return blocked(appId, "not-catalogued");
      }
      if (!projection.installable) {
        return blocked(appId, "policy-not-installable");
      }
      if (artifact === null) {
        return blocked(appId, "artifact-unavailable");
      }

      const candidate = defineFirstPartyAppInstallArtifact(artifact);
      if (candidate.appId !== appId) {
        throw new TypeError("First-party app install artifact identity does not match requested app");
      }
      if (!candidate.verified) {
        return blocked(appId, "artifact-unverified");
      }
      if (!candidate.compatible) {
        return blocked(appId, "incompatible-artifact");
      }

      // Stable/MVP has no platform-authoritative production activation gate yet.
      // A caller-supplied boolean must never mint readiness by convention.
      return blocked(appId, "production-activation-blocked");
    },
  });
}
