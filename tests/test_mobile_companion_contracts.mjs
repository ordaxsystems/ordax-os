import test from "node:test";
import assert from "node:assert/strict";

import {
  DEVICE_PRESENCE_SCHEMA,
  MOBILE_CAPABILITY_SCHEMA,
  MOBILE_SESSION_GRANT_SCHEMA,
  MOBILE_SESSION_REQUEST_SCHEMA,
  mobileCapabilityPolicy,
  validateDevicePresence,
  validateMobileCapability,
  validateMobileSessionGrant,
  validateMobileSessionRequest,
} from "../system/contracts/mobile-companion.mjs";

function request(overrides = {}) {
  return {
    schema: MOBILE_SESSION_REQUEST_SCHEMA,
    requestId: "req-1",
    accountId: "account-1",
    spaceId: "space-1",
    sourceDeviceId: "phone-1",
    requesterDeviceId: "notebook-1",
    capability: "camera.stream",
    purpose: "desktop.virtual-camera",
    requestedAt: 100,
    expiresAt: 400,
    backgroundAllowed: false,
    ...overrides,
  };
}

test("registered mobile capabilities expose fixed consent policy", () => {
  assert.deepEqual(
    mobileCapabilityPolicy("camera.stream"),
    { name: "camera.stream", consent: "foreground-session", media: true },
  );
  assert.throws(() => mobileCapabilityPolicy("camera.silent"), /not registered/);

  const descriptor = validateMobileCapability({
    schema: MOBILE_CAPABILITY_SCHEMA,
    deviceId: "phone-1",
    name: "microphone.stream",
    available: true,
    platformPermissionGranted: true,
  });
  assert.equal(descriptor.consentMode, "foreground-session");
});

test("camera and microphone requests cannot silently ask for background use", () => {
  const valid = validateMobileSessionRequest(request());
  assert.equal(valid.capability, "camera.stream");

  assert.throws(
    () => validateMobileSessionRequest(request({ backgroundAllowed: true })),
    /background/,
  );
});

test("grant requires platform permission and explicit OrdaX consent", () => {
  const req = request();
  const grant = validateMobileSessionGrant({
    schema: MOBILE_SESSION_GRANT_SCHEMA,
    requestId: "req-1",
    sourceDeviceId: "phone-1",
    requesterDeviceId: "notebook-1",
    capability: "camera.stream",
    userConsented: true,
    platformPermissionGranted: true,
    grantedAt: 120,
    expiresAt: 300,
    backgroundAllowed: false,
  }, req);
  assert.equal(grant.visibleIndicatorRequired, true);

  assert.throws(
    () => validateMobileSessionGrant({
      schema: MOBILE_SESSION_GRANT_SCHEMA,
      requestId: "req-1",
      sourceDeviceId: "phone-1",
      requesterDeviceId: "notebook-1",
      capability: "camera.stream",
      userConsented: false,
      platformPermissionGranted: true,
      grantedAt: 120,
      expiresAt: 300,
    }, req),
    /explicit user consent/,
  );
});

test("device location is opt-in and account scoped by the caller contract", () => {
  const presence = validateDevicePresence({
    schema: DEVICE_PRESENCE_SCHEMA,
    accountId: "account-1",
    deviceId: "phone-1",
    lastSeenAt: 1000,
    online: true,
    networkClass: "cellular",
    locationOptIn: true,
    locationPrecision: "coarse",
    latitude: -12.9,
    longitude: -38.5,
    accuracyMeters: 1000,
  });
  assert.equal(presence.locationPrecision, "coarse");

  assert.throws(
    () => validateDevicePresence({
      schema: DEVICE_PRESENCE_SCHEMA,
      accountId: "account-1",
      deviceId: "phone-1",
      lastSeenAt: 1000,
      online: true,
      locationOptIn: false,
      locationPrecision: "precise",
      latitude: -12.9,
      longitude: -38.5,
      accuracyMeters: 5,
    }),
    /explicit opt-in/,
  );
});
