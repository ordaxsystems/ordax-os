import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import { createComponentContextProviderRegistry } from "../system/services/components/context-provider-registry.mjs";
import { createNativeInstalledAppCapabilityContextProvider } from "../system/composition/native/installed-app-capability-context.mjs";
import { INSTALLED_APP_CAPABILITY_DECISION_SCHEMA } from "../system/services/device-agent/installed-app-capability-reader.mjs";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const deviceReader = {
  schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  async capabilities() {
    return { schema: DEVICE_AGENT_CAPABILITIES_SCHEMA, state: "ready", capabilities: [
      { id: "orders.update", modes: ["read", "write"] },
      { id: "notes.read", modes: ["read"] },
    ] };
  },
};
function identity(appId, publisherId = "ordaxsystems", digest = DIGEST_A, spaceId = "space-one") {
  return { appId, publisherId, packageSha256: digest,
    accountId: "account-one", spaceId, deviceId: "device-one", verified: true };
}
function decision(caller, capabilities) {
  return { schema: INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
    appId: caller.appId, publisherId: caller.publisherId,
    packageSha256: caller.packageSha256, accountId: caller.accountId,
    spaceId: caller.spaceId, deviceId: caller.deviceId, capabilities };
}

test("Native host context injects a separate read-only port for each verified installed app", async () => {
  const identities = new Map([
    ["orders", identity("orders")],
    ["notes", identity("notes", "publisher-two", DIGEST_B, "space-two")],
  ]);
  const grants = {
    orders: [{ id: "orders.update", modes: ["write"] }],
    notes: [{ id: "notes.read", modes: ["read"] }],
  };
  const provider = createNativeInstalledAppCapabilityContextProvider({
    capabilityReader: deviceReader,
    resolveCurrentInstalledApp: async id => identities.get(id) ?? null,
    readAllowedCapabilities: async caller => decision(caller, grants[caller.appId]),
  });
  const registry = createComponentContextProviderRegistry({
    label: "Native capability test", startDescription: "component mounting",
  });
  registry.install(provider);
  const ordersContext = await registry.compose("orders", Object.freeze({ root: "app-root" }));
  const notesContext = await registry.compose("notes", Object.freeze({ root: "notes-root" }));
  assert.equal(ordersContext.root, "app-root");
  assert.notEqual(ordersContext.capabilityReader, notesContext.capabilityReader);
  assert.equal(ordersContext.capabilityReader.schema, DEVICE_AGENT_CAPABILITY_READER_SCHEMA);
  assert.deepEqual((await ordersContext.capabilityReader.capabilities()).capabilities,
    [{ id: "orders.update", modes: ["write"] }]);
  assert.deepEqual((await notesContext.capabilityReader.capabilities()).capabilities,
    [{ id: "notes.read", modes: ["read"] }]);
  assert.equal("execute" in ordersContext.capabilityReader, false);
  assert.equal("grant" in ordersContext.capabilityReader, false);
  assert.equal("authorize" in ordersContext.capabilityReader, false);
  assert.equal(await registry.compose("not-installed", Object.freeze({ root: "unknown" })).then(
    value => Object.hasOwn(value, "capabilityReader")), false);

  grants.orders = [];
  assert.deepEqual((await ordersContext.capabilityReader.capabilities()).capabilities, []);
  identities.delete("orders");
  await assert.rejects(() => ordersContext.capabilityReader.capabilities(), /plain data object/);
  assert.deepEqual((await notesContext.capabilityReader.capabilities()).capabilities,
    [{ id: "notes.read", modes: ["read"] }]);
});

test("Native context refuses verified-slot identity mismatch and self-claimed unsigned apps", async () => {
  const mockGrant = async caller => decision(caller, []);
  const malicious = createNativeInstalledAppCapabilityContextProvider({
    capabilityReader: deviceReader,
    resolveCurrentInstalledApp: async () => identity("another-app"),
    readAllowedCapabilities: mockGrant,
  });
  await assert.rejects(() => malicious("orders"), /not a verified current slot/);
  const unverified = createNativeInstalledAppCapabilityContextProvider({
    capabilityReader: deviceReader,
    resolveCurrentInstalledApp: async id => ({ ...identity(id), verified: false }),
    readAllowedCapabilities: mockGrant,
  });
  await assert.rejects(() => unverified("orders"), /not a verified current slot/);
  assert.throws(() => createNativeInstalledAppCapabilityContextProvider({
    capabilityReader: deviceReader,
    resolveCurrentInstalledApp: async () => identity("orders"),
  }), /trusted host resolvers/);
});

test("Unchanged mounts do not cache identity across package upgrade or Space switch", async () => {
  let current = identity("orders");
  const provider = createNativeInstalledAppCapabilityContextProvider({
    capabilityReader: deviceReader,
    resolveCurrentInstalledApp: async id => id === "orders" ? current : null,
    readAllowedCapabilities: async caller => {
      if (caller.packageSha256 !== DIGEST_A || caller.spaceId !== "space-one") {
        return decision({ ...caller, packageSha256: DIGEST_A, spaceId: "space-one" },
          [{ id: "orders.update", modes: ["write"] }]);
      }
      return decision(caller, [{ id: "orders.update", modes: ["write"] }]);
    },
  });
  const context = await provider("orders");
  assert.deepEqual((await context.capabilityReader.capabilities()).capabilities,
    [{ id: "orders.update", modes: ["write"] }]);
  current = identity("orders", "ordaxsystems", DIGEST_B, "space-one");
  await assert.rejects(() => context.capabilityReader.capabilities(), /not bound to the verified caller/);
  current = identity("orders", "ordaxsystems", DIGEST_A, "another-space");
  await assert.rejects(() => context.capabilityReader.capabilities(), /not bound to the verified caller/);
});
