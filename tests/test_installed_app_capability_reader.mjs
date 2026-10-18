import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import {
  INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
  createInstalledAppCapabilityReader,
} from "../system/services/device-agent/installed-app-capability-reader.mjs";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function caller(appId = "orders", spaceId = "pizzaria", digest = DIGEST_A) {
  return {
    appId, packageSha256: digest, accountId: "account-one",
    spaceId, deviceId: "ordax-device-one", verified: true,
  };
}
function decision(subject, capabilities) {
  return {
    schema: INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
    appId: subject.appId, packageSha256: subject.packageSha256,
    accountId: subject.accountId, spaceId: subject.spaceId,
    deviceId: subject.deviceId, capabilities,
  };
}
function reader(state = "ready") {
  return {
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities({ client }) {
      assert.equal(client, "ordax-native");
      return {
        schema: DEVICE_AGENT_CAPABILITIES_SCHEMA, state,
        capabilities: [
          { id: "orders.update", modes: ["read", "write"] },
          { id: "notes.read", modes: ["read"] },
          { id: "files.write", modes: ["write"] },
        ],
      };
    },
  };
}

test("independent apps see only their own live OS-granted capabilities and modes", async () => {
  let orders = caller("orders", "pizzaria", DIGEST_A);
  let notes = caller("notes", "advocacia", DIGEST_B);
  let current = orders;
  let granted = {
    orders: [{ id: "orders.update", modes: ["write"] }],
    notes: [{ id: "notes.read", modes: ["read"] }],
  };
  const port = createInstalledAppCapabilityReader({
    capabilityReader: reader(),
    resolveCaller: async () => current,
    readAllowedCapabilities: async context => decision(context, granted[context.appId]),
  });
  const first = await port.capabilities();
  assert.equal(first.state, "ready");
  assert.deepEqual(first.capabilities, [{ id: "orders.update", modes: ["write"] }]);
  assert.equal(Object.hasOwn(port, "execute"), false);
  assert.equal(Object.hasOwn(port, "authorize"), false);
  assert.equal(Object.hasOwn(port, "grant"), false);

  current = notes;
  assert.deepEqual((await port.capabilities()).capabilities,
    [{ id: "notes.read", modes: ["read"] }]);

  current = orders;
  granted.orders = []; // OS revocation is observed on the very next read.
  assert.deepEqual((await port.capabilities()).capabilities, []);

  orders = caller("orders", "outro-space", DIGEST_A);
  current = orders;
  assert.deepEqual((await port.capabilities()).capabilities, []);
});

test("host current identity and OS grant decision must match package, account, Space and device", async () => {
  const real = caller();
  for (const key of ["appId", "packageSha256", "accountId", "spaceId", "deviceId"]) {
    const malicious = { ...real, [key]: key === "packageSha256" ? DIGEST_B : "other" };
    const port = createInstalledAppCapabilityReader({
      capabilityReader: reader(),
      resolveCaller: async () => real,
      readAllowedCapabilities: async () => decision(malicious, [{ id: "files.write", modes: ["write"] }]),
    });
    await assert.rejects(() => port.capabilities(), /not bound to the verified caller/, key);
  }
});

test("unverified caller, app-owned selectors and revoked package all fail closed", async () => {
  let current = caller();
  let grantsRead = 0;
  const port = createInstalledAppCapabilityReader({
    capabilityReader: reader(),
    resolveCaller: async () => current,
    readAllowedCapabilities: async identity => {
      grantsRead++;
      return decision(identity, [{ id: "orders.update", modes: ["read", "write"] }]);
    },
  });
  await assert.rejects(() => port.capabilities({ appId: "studio" }), /must not select a caller/);
  assert.equal(grantsRead, 0);
  current = { ...current, verified: false };
  await assert.rejects(() => port.capabilities(), /not a verified package/);
  assert.equal(grantsRead, 0);
  current = { ...caller(), packageSha256: "unverified" };
  await assert.rejects(() => port.capabilities(), /not a verified package/);
  assert.equal(grantsRead, 0);
});

test("unavailable device, malformed policy and extra authority never expose capabilities", async () => {
  const current = caller();
  const degraded = createInstalledAppCapabilityReader({
    capabilityReader: reader("degraded"),
    resolveCaller: async () => current,
    readAllowedCapabilities: async () => decision(current, [{ id: "orders.update", modes: ["write"] }]),
  });
  assert.deepEqual(await degraded.capabilities(), {
    schema: DEVICE_AGENT_CAPABILITIES_SCHEMA, state: "degraded", capabilities: [],
  });
  const malformed = createInstalledAppCapabilityReader({
    capabilityReader: reader(),
    resolveCaller: async () => current,
    readAllowedCapabilities: async () => ({
      ...decision(current, [{ id: "orders.update", modes: ["write"] }]),
      token: "must-not-be-accepted",
    }),
  });
  await assert.rejects(() => malformed.capabilities(), /fields are incompatible/);
  assert.throws(() => createInstalledAppCapabilityReader({
    capabilityReader: reader(), resolveCaller: async () => current,
  }), /trusted host resolvers/);
});
