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
const INSTANCE_ONE = "11111111-1111-4111-8111-111111111111";
const INSTANCE_TWO = "22222222-2222-4222-8222-222222222222";

function caller(appId = "orders", spaceId = "pizzaria", digest = DIGEST_A) {
  return {
    appId, publisherId: "ordaxsystems", packageSha256: digest,
    runtimeInstanceId: INSTANCE_ONE, accountId: "account-one",
    spaceId, deviceId: "ordax-device-one", verified: true,
  };
}
function decision(subject, capabilities) {
  return {
    schema: INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
    appId: subject.appId, publisherId: subject.publisherId, packageSha256: subject.packageSha256,
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
  for (const key of ["appId", "publisherId", "packageSha256", "accountId", "spaceId", "deviceId"]) {
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

test("host caller and policy decision reject accessor and symbol-based identity objects", async () => {
  const base = caller();
  const attacker = { ...base };
  Object.defineProperty(attacker, "appId", {
    enumerable: true,
    get() { throw new Error("untrusted accessor must not be executed"); },
  });
  const hostileCaller = createInstalledAppCapabilityReader({
    capabilityReader: reader(),
    resolveCaller: async () => attacker,
    readAllowedCapabilities: async () => { throw new Error("must never read a grant"); },
  });
  await assert.rejects(() => hostileCaller.capabilities(), /accessor fields/);

  const scope = decision(base, [{ id: "orders.update", modes: ["write"] }]);
  const extra = { ...scope, [Symbol("untrusted")]: "authority" };
  const hostilePolicy = createInstalledAppCapabilityReader({
    capabilityReader: reader(),
    resolveCaller: async () => base,
    readAllowedCapabilities: async () => extra,
  });
  await assert.rejects(() => hostilePolicy.capabilities(), /fields are incompatible/);
});


test("guest OS session is scoped explicitly and cannot reuse another account grant", async () => {
  const guest = { ...caller(), accountId: null, spaceId: null };
  const readerPort = createInstalledAppCapabilityReader({
    resolveCaller: async () => guest,
    readAllowedCapabilities: async identity => decision(identity, [{ id: "notes.read", modes: ["read"] }]),
    capabilityReader: reader(),
  });
  assert.deepEqual((await readerPort.capabilities()).capabilities,
    [{ id: "notes.read", modes: ["read"] }]);
  const crossAccount = createInstalledAppCapabilityReader({
    resolveCaller: async () => guest,
    readAllowedCapabilities: async identity => decision(
      { ...identity, accountId: "other-account" }, [{ id: "notes.read", modes: ["read"] }],
    ),
    capabilityReader: reader(),
  });
  await assert.rejects(() => crossAccount.capabilities(), /not bound to the verified caller/);
});

test("OS account, Space or package change during in-flight policy read fails closed", async () => {
  let current = caller();
  const initial = current;
  const port = createInstalledAppCapabilityReader({
    resolveCaller: async () => current,
    readAllowedCapabilities: async identity => {
      current = { ...initial, spaceId: "changed-space" };
      return decision(identity, [{ id: "orders.update", modes: ["write"] }]);
    },
    capabilityReader: reader(),
  });
  await assert.rejects(() => port.capabilities(), /changed during capability discovery/);
  current = initial;
  const afterUninstall = createInstalledAppCapabilityReader({
    resolveCaller: async () => current,
    readAllowedCapabilities: async identity => {
      current = null;
      return decision(identity, [{ id: "orders.update", modes: ["write"] }]);
    },
    capabilityReader: reader(),
  });
  await assert.rejects(() => afterUninstall.capabilities(), /not a plain data object|must be a plain data object/);
});


test("host-issued instance changes invalidate the mounted reader even when app bytes and grants are unchanged", async () => {
  let running = caller();
  const port = createInstalledAppCapabilityReader({
    mountCaller: running,
    resolveCaller: async () => running,
    readAllowedCapabilities: async identity =>
      decision(identity, [{ id: "orders.update", modes: ["write"] }]),
    capabilityReader: reader(),
  });
  assert.equal((await port.capabilities()).capabilities.length, 1);
  running = { ...running, runtimeInstanceId: INSTANCE_TWO };
  await assert.rejects(() => port.capabilities(), /mount identity is no longer current/);
  const newlyMounted = createInstalledAppCapabilityReader({
    mountCaller: running,
    resolveCaller: async () => running,
    readAllowedCapabilities: async identity =>
      decision(identity, [{ id: "orders.update", modes: ["write"] }]),
    capabilityReader: reader(),
  });
  assert.equal((await newlyMounted.capabilities()).capabilities.length, 1);
  // Same hash is not enough to resurrect the previous mount after reinstall.
  await assert.rejects(() => port.capabilities(), /mount identity is no longer current/);
});

test("missing, malformed or app-claimed runtime instance IDs cannot authorize discovery", async () => {
  for (const bad of [undefined, null, "1".repeat(32), "12345678-1234-1234-1234-123456789abc"]) {
    const actual = { ...caller(), runtimeInstanceId: bad };
    const port = createInstalledAppCapabilityReader({
      resolveCaller: async () => actual,
      readAllowedCapabilities: async () => { throw new Error("must not run permission lookup"); },
      capabilityReader: reader(),
    });
    await assert.rejects(() => port.capabilities(), /not a verified package/);
  }
});


test("changing only the Native execution instance while permission discovery is in flight fails closed", async () => {
  let current = caller();
  const original = current;
  const port = createInstalledAppCapabilityReader({
    mountCaller: original,
    resolveCaller: async () => current,
    readAllowedCapabilities: async identity => {
      current = { ...original, runtimeInstanceId: INSTANCE_TWO };
      return decision(identity, [{ id: "orders.update", modes: ["write"] }]);
    },
    capabilityReader: reader(),
  });
  await assert.rejects(() => port.capabilities(), /changed during capability discovery/);
});


test("identity validation does not execute custom coercion on app, digest or instance fields", async () => {
  for (const field of ["appId", "packageSha256", "runtimeInstanceId"]) {
    let coerced = false;
    const actual = { ...caller(), [field]: {
      toString() { coerced = true; throw new Error("untrusted coercion ran"); },
    } };
    const port = createInstalledAppCapabilityReader({
      resolveCaller: async () => actual,
      readAllowedCapabilities: async () => { throw new Error("grant lookup must not run"); },
      capabilityReader: reader(),
    });
    await assert.rejects(() => port.capabilities(), /not a verified package/);
    assert.equal(coerced, false, field);
  }
});
