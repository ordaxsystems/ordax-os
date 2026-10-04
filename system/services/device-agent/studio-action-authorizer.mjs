import {
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
  validateDeviceCapabilityGrant,
} from "../../contracts/device-agent.mjs";
import {
  validateAuthorizedDeviceActionRequest,
} from "../../contracts/operational-realtime.mjs";
import {
  validateStudioActionCatalogRequest,
} from "../../contracts/studio-action-catalog.mjs";

export const STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA =
  "ordax.studio-device-action-authorization/1";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Studio action authorizer clock must return epoch milliseconds");
  }
  return value;
}

function authorization(request, grant, capability, binding, authorizedAt) {
  return Object.freeze({
    schema: STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA,
    request,
    grant,
    capability,
    binding,
    authorizedAt,
    dispatchAuthority: "none",
  });
}

export function createStudioDeviceActionAuthorizer({
  capabilityReader,
  now = Date.now,
} = {}) {
  const reader = assertDeviceAgentCapabilityReaderPort(capabilityReader);
  if (typeof now !== "function") {
    throw new TypeError("Studio action authorizer requires a clock function");
  }

  return Object.freeze({
    schema: STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA,
    async authorize(requestValue, grantValue) {
      const catalogValue = validateStudioActionCatalogRequest(requestValue);
      const request = validateAuthorizedDeviceActionRequest(catalogValue.request, grantValue);
      const binding = catalogValue.binding;
      const grant = validateDeviceCapabilityGrant(grantValue);
      const authorizedAt = readClock(now);

      if (binding.mode !== "write") {
        throw new TypeError("Studio mutation authorization requires a write catalog binding");
      }
      if (request.expiresAt <= authorizedAt) {
        throw new TypeError("Studio device action request is expired");
      }

      let snapshot;
      try {
        snapshot = validateDeviceAgentCapabilitiesSnapshot(
          await reader.capabilities({ client: request.client }),
        );
      } catch {
        throw new TypeError("Studio Device Agent capability discovery failed closed");
      }

      if (snapshot.state !== "ready") {
        throw new TypeError("Studio Device Agent is not ready for mutation authorization");
      }

      const capability = snapshot.capabilities.find(
        (candidate) => candidate.id === request.capability,
      );
      if (!capability) {
        throw new TypeError("Studio device action capability is not currently available");
      }
      if (!capability.modes.includes("write")) {
        throw new TypeError("Studio device action capability is not currently writable");
      }
      if (grant.actionGateway !== "ordax") {
        throw new TypeError("Studio device action must use the OrdaX Action Gateway");
      }

      return authorization(request, grant, capability, binding, authorizedAt);
    },
  });
}
