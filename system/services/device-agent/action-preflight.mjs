/**
 * System-owned, provider- and app-neutral read-only preflight.
 * This checks a presented grant's shape and current capability visibility;
 * it does NOT authenticate its provenance, mint grants or dispatch actions.
 * Composition/Action Gateway must resolve actual authorization from trusted
 * system and remote sources immediately before execution.
 */
import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
  validateDeviceCapabilityGrant,
} from "../../contracts/device-agent.mjs";
import {
  validateAuthorizedDeviceActionRequest,
} from "../../contracts/operational-realtime.mjs";

export const DEVICE_ACTION_PREFLIGHT_SCHEMA =
  "ordax.device-action-preflight/1";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Device action preflight clock must return epoch milliseconds");
  }
  return value;
}

function authorization(request, grant, capability, authorizedAt) {
  return Object.freeze({
    schema: DEVICE_ACTION_PREFLIGHT_SCHEMA,
    request,
    grant,
    capability,
    authorizedAt,
    dispatchAuthority: "none",
  });
}

export function createDeviceActionPreflight({
  capabilityReader,
  now = Date.now,
} = {}) {
  const reader = assertDeviceAgentCapabilityReaderPort(capabilityReader);
  if (typeof now !== "function") {
    throw new TypeError("Device action preflight requires a clock function");
  }

  return Object.freeze({
    schema: DEVICE_ACTION_PREFLIGHT_SCHEMA,
    async check(requestValue, grantValue) {
      const request = validateAuthorizedDeviceActionRequest(requestValue, grantValue);
      const grant = validateDeviceCapabilityGrant(grantValue);
      const authorizedAt = readClock(now);

      if (request.expiresAt <= authorizedAt) {
        throw new TypeError("Device action request is expired");
      }

      let snapshot;
      try {
        snapshot = validateDeviceAgentCapabilitiesSnapshot(
          await reader.capabilities({ client: request.client }),
        );
      } catch {
        throw new TypeError("Device Agent capability discovery failed closed");
      }

      if (snapshot.state !== "ready") {
        throw new TypeError("Device Agent is not ready for mutation authorization");
      }

      const capability = snapshot.capabilities.find(
        (candidate) => candidate.id === request.capability,
      );
      if (!capability) {
        throw new TypeError("Device action capability is not currently available");
      }
      if (!capability.modes.includes("write")) {
        throw new TypeError("Device action capability is not currently writable");
      }
      if (grant.actionGateway !== "ordax") {
        throw new TypeError("Device action must use the OrdaX Action Gateway");
      }

      return authorization(request, grant, capability, authorizedAt);
    },
  });
}
