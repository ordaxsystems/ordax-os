export const MOBILE_CAPABILITY_SCHEMA = "ordax.mobile-capability/1";
export const MOBILE_SESSION_REQUEST_SCHEMA = "ordax.mobile-capability-session-request/1";
export const MOBILE_SESSION_GRANT_SCHEMA = "ordax.mobile-capability-session-grant/1";
export const DEVICE_PRESENCE_SCHEMA = "ordax.device-presence/1";

const CAPABILITIES = new Map([
  ["microphone.stream", { consent: "foreground-session", media: true }],
  ["camera.stream", { consent: "foreground-session", media: true }],
  ["camera.capture", { consent: "foreground-action", media: true }],
  ["location.current", { consent: "foreground-action", media: false }],
  ["location.presence", { consent: "persistent-opt-in", media: false }],
  ["sensor.orientation", { consent: "foreground-session", media: false }],
  ["sensor.motion", { consent: "foreground-session", media: false }],
  ["files.share", { consent: "foreground-action", media: false }],
  ["notifications.receive", { consent: "persistent-opt-in", media: false }],
]);

const PURPOSE_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const DEVICE_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function text(value, label, max = 160) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} must be bounded printable text`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function capability(value) {
  if (!CAPABILITIES.has(value)) {
    throw new TypeError("Mobile capability is not registered");
  }
  return value;
}

function deviceId(value, label) {
  if (typeof value !== "string" || !DEVICE_RE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function mobileCapabilityPolicy(name) {
  const key = capability(name);
  return Object.freeze({ name: key, ...CAPABILITIES.get(key) });
}

export function validateMobileCapability(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Mobile capability descriptor must be an object");
  }
  if (value.schema !== MOBILE_CAPABILITY_SCHEMA) {
    throw new TypeError("Mobile capability schema is incompatible");
  }

  const name = capability(value.name);
  const policy = CAPABILITIES.get(name);

  return Object.freeze({
    schema: MOBILE_CAPABILITY_SCHEMA,
    deviceId: deviceId(value.deviceId, "Mobile device id"),
    name,
    available: value.available === true,
    platformPermissionGranted: value.platformPermissionGranted === true,
    consentMode: policy.consent,
    media: policy.media,
  });
}

export function validateMobileSessionRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Mobile capability session request must be an object");
  }
  if (value.schema !== MOBILE_SESSION_REQUEST_SCHEMA) {
    throw new TypeError("Mobile capability session request schema is incompatible");
  }
  const name = capability(value.capability);
  if (typeof value.purpose !== "string" || !PURPOSE_RE.test(value.purpose)) {
    throw new TypeError("Mobile capability purpose is invalid");
  }
  const requestedAt = integer(value.requestedAt, "Mobile capability requestedAt");
  const expiresAt = integer(value.expiresAt, "Mobile capability expiresAt");
  if (expiresAt <= requestedAt) {
    throw new TypeError("Mobile capability expiresAt must be after requestedAt");
  }

  return Object.freeze({
    schema: MOBILE_SESSION_REQUEST_SCHEMA,
    requestId: text(value.requestId, "Mobile capability request id", 128),
    accountId: text(value.accountId, "Mobile capability account id", 128),
    spaceId: text(value.spaceId, "Mobile capability Space id", 128),
    sourceDeviceId: deviceId(value.sourceDeviceId, "Mobile source device id"),
    requesterDeviceId: deviceId(value.requesterDeviceId, "Mobile requester device id"),
    capability: name,
    purpose: value.purpose,
    requestedAt,
    expiresAt,
    backgroundAllowed: value.backgroundAllowed === true,
  });
}

export function validateMobileSessionGrant(value, requestValue) {
  const request = validateMobileSessionRequest(requestValue);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Mobile capability session grant must be an object");
  }
  if (value.schema !== MOBILE_SESSION_GRANT_SCHEMA) {
    throw new TypeError("Mobile capability session grant schema is incompatible");
  }

  for (const [label, expected, actual] of [
    ["requestId", request.requestId, value.requestId],
    ["sourceDeviceId", request.sourceDeviceId, value.sourceDeviceId],
    ["requesterDeviceId", request.requesterDeviceId, value.requesterDeviceId],
    ["capability", request.capability, value.capability],
  ]) {
    if (expected !== actual) {
      throw new TypeError(`Mobile capability grant ${label} does not match request`);
    }
  }

  const policy = CAPABILITIES.get(request.capability);
  const grantedAt = integer(value.grantedAt, "Mobile capability grantedAt");
  const expiresAt = integer(value.expiresAt, "Mobile capability grant expiresAt");
  if (expiresAt <= grantedAt || expiresAt > request.expiresAt) {
    throw new TypeError("Mobile capability grant expiry is invalid");
  }
  if (value.userConsented !== true) {
    throw new TypeError("Mobile capability grant requires explicit user consent");
  }
  if (value.platformPermissionGranted !== true) {
    throw new TypeError("Mobile capability grant requires platform permission");
  }
  if (policy.consent !== "persistent-opt-in" && value.backgroundAllowed === true) {
    throw new TypeError("Mobile capability cannot run in background");
  }
  if (request.backgroundAllowed === true && policy.consent !== "persistent-opt-in") {
    throw new TypeError("Mobile capability request cannot ask for background access");
  }

  return Object.freeze({
    schema: MOBILE_SESSION_GRANT_SCHEMA,
    requestId: request.requestId,
    sourceDeviceId: request.sourceDeviceId,
    requesterDeviceId: request.requesterDeviceId,
    capability: request.capability,
    userConsented: true,
    platformPermissionGranted: true,
    grantedAt,
    expiresAt,
    backgroundAllowed: value.backgroundAllowed === true,
    visibleIndicatorRequired: true,
  });
}

export function validateDevicePresence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Device presence must be an object");
  }
  if (value.schema !== DEVICE_PRESENCE_SCHEMA) {
    throw new TypeError("Device presence schema is incompatible");
  }

  const precision = value.locationPrecision ?? "none";
  if (!["none", "coarse", "precise"].includes(precision)) {
    throw new TypeError("Device presence location precision is invalid");
  }
  if (precision !== "none" && value.locationOptIn !== true) {
    throw new TypeError("Device presence location requires explicit opt-in");
  }

  return Object.freeze({
    schema: DEVICE_PRESENCE_SCHEMA,
    accountId: text(value.accountId, "Device presence account id", 128),
    deviceId: deviceId(value.deviceId, "Device presence device id"),
    lastSeenAt: integer(value.lastSeenAt, "Device presence lastSeenAt"),
    online: value.online === true,
    networkClass: value.networkClass ?? "unknown",
    locationOptIn: value.locationOptIn === true,
    locationPrecision: precision,
    latitude: precision === "none" ? null : Number(value.latitude),
    longitude: precision === "none" ? null : Number(value.longitude),
    accuracyMeters: precision === "none" ? null : Number(value.accuracyMeters),
  });
}
