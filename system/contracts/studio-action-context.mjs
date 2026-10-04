import {
  validateDeviceActionActorV2,
  validateDeviceActionClientV2,
  validateDeviceActionDeviceIdV2,
  validateDeviceActionScopeIdV2,
} from "./device-action-envelope-v2.mjs";

export const STUDIO_ACTION_CONTEXT_SCHEMA = "ordax.studio-action-context/1";

const FIELDS = Object.freeze([
  "schema",
  "actor",
  "deviceId",
  "client",
  "spaceId",
]);

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length
    || actual.some((key, index) => key !== allowed[index])
  ) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

export function validateStudioActionContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Studio action context must be an object");
  }
  exactKeys(value, FIELDS, "Studio action context");
  if (value.schema !== STUDIO_ACTION_CONTEXT_SCHEMA) {
    throw new TypeError("Studio action context schema is incompatible");
  }
  return Object.freeze({
    schema: STUDIO_ACTION_CONTEXT_SCHEMA,
    actor: validateDeviceActionActorV2(value.actor),
    deviceId: validateDeviceActionDeviceIdV2(value.deviceId),
    client: validateDeviceActionClientV2(value.client),
    spaceId: validateDeviceActionScopeIdV2(value.spaceId, "Studio action context Space id"),
  });
}
