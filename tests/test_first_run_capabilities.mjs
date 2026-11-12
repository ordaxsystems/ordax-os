import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEVICE_PROFILE_PORT_SCHEMA, DEVICE_PROFILE_SCHEMA } from "../system/contracts/device-profile.mjs";
import { IDENTITY_CREDENTIALS_SCHEMA } from "../system/contracts/identity-credentials.mjs";
import { LOCAL_SESSION_SCHEMA } from "../system/contracts/local-session.mjs";
import { NETWORK_MANAGEMENT_SCHEMA } from "../system/contracts/network-management.mjs";
import {
  FIRST_RUN_CAPABILITIES_SCHEMA,
  deriveFirstRunCapabilities,
} from "../system/services/first-run/capabilities.mjs";

const actions = (...supportedActions) => ({ supportedActions });
const credentials = (withPolicy = false) => ({
  schema: IDENTITY_CREDENTIALS_SCHEMA,
  signIn() {},
  register() {},
  ...(withPolicy ? { registrationPolicy() {} } : {}),
});
const network = () => ({
  schema: NETWORK_MANAGEMENT_SCHEMA,
  status() {}, scan() {}, connect() {}, disconnect() {}, forget() {}, reconnect() {},
});
const localSession = () => ({
  schema: LOCAL_SESSION_SCHEMA,
  getSnapshot: () => ({
    state: "unlocked",
    credentialConfigured: false,
    protectionScope: "surface-session-not-storage-encryption",
  }),
  subscribe() {}, configureCredential() {}, removeCredential() {}, lock() {}, unlock() {},
});
const deviceProfile = () => ({
  schema: DEVICE_PROFILE_PORT_SCHEMA,
  getSnapshot: () => ({
    schema: DEVICE_PROFILE_SCHEMA,
    devicePublicId: "ordax-12345678",
    displayName: "Meu OrdaX",
  }),
  rename() {},
});

test("First Run capabilities fail closed when optional owners are absent", () => {
  const snapshot = deriveFirstRunCapabilities({ identityActionsSnapshot: actions("sign-in", "register") });
  assert.equal(snapshot.schema, FIRST_RUN_CAPABILITIES_SCHEMA);
  assert.deepEqual(
    { ...snapshot, schema: undefined },
    {
      schema: undefined,
      networkManagement: false,
      localSession: false,
      deviceProfile: false,
      identityCredentials: false,
      identitySignIn: false,
      identityRegister: false,
      registrationPolicy: false,
    },
  );
});

test("identity actions never advertise credentials that have no validated credentials port", () => {
  assert.throws(() => deriveFirstRunCapabilities({
    identityCredentials: {},
    identityActionsSnapshot: actions("sign-in"),
  }), /identity credentials port/i);
  const snapshot = deriveFirstRunCapabilities({
    identityCredentials: credentials(),
    identityActionsSnapshot: actions("sign-in"),
  });
  assert.equal(snapshot.identitySignIn, true);
  assert.equal(snapshot.identityRegister, false);
});

test("read-only registration policy is available with credentials even when Native signup is denied", () => {
  assert.equal(deriveFirstRunCapabilities({
    identityCredentials: credentials(true),
    identityActionsSnapshot: actions("register"),
  }).registrationPolicy, true);
  assert.equal(deriveFirstRunCapabilities({
    identityCredentials: credentials(true),
    identityActionsSnapshot: actions("sign-in"),
  }).registrationPolicy, true);
});

test("network, local-session and device-profile capabilities require compatible owner ports", () => {
  const snapshot = deriveFirstRunCapabilities({
    networkManagement: network(),
    localSession: localSession(),
    deviceProfile: deviceProfile(),
    identityActionsSnapshot: actions(),
  });
  assert.equal(snapshot.networkManagement, true);
  assert.equal(snapshot.localSession, true);
  assert.equal(snapshot.deviceProfile, true);
  assert.throws(() => deriveFirstRunCapabilities({
    networkManagement: {},
    identityActionsSnapshot: actions(),
  }), /network-management port/i);
  assert.throws(() => deriveFirstRunCapabilities({
    deviceProfile: {},
    identityActionsSnapshot: actions(),
  }), /device profile port/i);
});


test("First Run contract names the executable capabilities owner", async () => {
  const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));
  assert.equal(contract.owners.capabilities, "system/services/first-run/capabilities.mjs");
});
