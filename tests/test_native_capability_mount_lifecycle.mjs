import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { loadVerifiedCurrentComponentRuntime } from "../system/services/components/current-slot-loader.mjs";
import { installTrustedComponentContextProvider } from "../system/services/components/runtime-loader.mjs";
import {
  createNativeInstalledAppCapabilityContextProvider,
} from "../system/composition/native/installed-app-capability-context.mjs";
import {
  INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
  revokeInstalledAppCapabilityReader,
} from "../system/services/device-agent/installed-app-capability-reader.mjs";

const identity = Object.freeze({
  appId: "internet",
  publisherId: "ordaxsystems",
  packageSha256: "a".repeat(64),
  runtimeInstanceId: "11111111-1111-4111-8111-111111111111",
  accountId: "account-1",
  spaceId: "space-1",
  deviceId: "device-1",
  verified: true,
});
const revision = Object.freeze({
  componentId: "internet", state: "current", source: "slot",
  revision: 4, version: "0.3.0", sourceCommit: "a".repeat(40),
  entrypoint: "src/runtime.mjs", pendingHealth: null,
});
const source = createNativeComponentSlotSource({
  location: { href: "http://127.0.0.1:43121/" },
});
const granted = [{ id: "internet.read", modes: ["read"] }];
const available = {
  schema: DEVICE_AGENT_CAPABILITIES_SCHEMA, state: "ready",
  capabilities: granted,
};
let policyRead = async subject => ({
  schema: INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
  appId: subject.appId, publisherId: subject.publisherId,
  packageSha256: subject.packageSha256, accountId: subject.accountId,
  spaceId: subject.spaceId, deviceId: subject.deviceId,
  capabilities: granted,
});
const provider = createNativeInstalledAppCapabilityContextProvider({
  resolveCurrentInstalledApp: async id => id === "internet" ? identity : null,
  readAllowedCapabilities: async caller => policyRead(caller),
  capabilityReader: {
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities({ client }) {
      assert.equal(client, "ordax-native");
      return available;
    },
  },
});
installTrustedComponentContextProvider(provider);

function run({ states = [revision], mount = () => ({ destroy() {} }) } = {}) {
  let captured;
  let reads = 0;
  const request = loadVerifiedCurrentComponentRuntime({
    componentId: "internet", source,
    fetchImpl: async () => ({
      ok: true,
      json: async () => states[Math.min(reads++, states.length - 1)],
    }),
    importModule: async () => ({
      componentRuntime: {
        schema: COMPONENT_RUNTIME_SCHEMA, componentId: "internet",
        version: "0.3.0",
        mount(context) {
          captured = context.capabilityReader;
          return mount(context);
        },
      },
    }),
  });
  return { request, captured: () => captured };
}

test("the canonical verified-slot destroy revokes only its mount's read-only port", async () => {
  const a = run();
  const firstMount = await a.request;
  const b = run();
  const secondMount = await b.request;
  assert.ok(firstMount);
  assert.ok(secondMount);
  assert.notEqual(a.captured(), b.captured());
  assert.deepEqual((await a.captured().capabilities()).capabilities, granted);
  firstMount.destroy();
  firstMount.destroy();
  await assert.rejects(() => a.captured().capabilities(), /no longer mounted/);
  assert.equal(revokeInstalledAppCapabilityReader(a.captured()), false);
  assert.deepEqual((await b.captured().capabilities()).capabilities, granted);
  secondMount.destroy();
  await assert.rejects(() => b.captured().capabilities(), /no longer mounted/);
});

test("a failed mount or a substituted slot immediately invalidates the captured port", async () => {
  const failed = run({
    mount: () => { throw new Error("component failed while mounting"); },
  });
  assert.equal(await failed.request, null);
  await assert.rejects(() => failed.captured().capabilities(), /no longer mounted/);

  const changed = run({
    states: [revision, revision, { ...revision, revision: 5 }],
  });
  assert.equal(await changed.request, null);
  await assert.rejects(() => changed.captured().capabilities(), /no longer mounted/);
});

test("revocation during an in-flight OS policy read denies the final result", async () => {
  let finishRead;
  let signalRead;
  const readStarted = new Promise(resolve => { signalRead = resolve; });
  policyRead = async subject => new Promise(resolve => {
    finishRead = () => resolve({
      schema: INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
      appId: subject.appId, publisherId: subject.publisherId,
      packageSha256: subject.packageSha256,
      accountId: subject.accountId, spaceId: subject.spaceId,
      deviceId: subject.deviceId, capabilities: granted,
    });
    signalRead();
  });
  const captured = run();
  const mount = await captured.request;
  assert.ok(mount);
  const pending = captured.captured().capabilities();
  // Synchronize with the policy read; never rely on a microtask race.
  await readStarted;
  mount.destroy();
  finishRead();
  await assert.rejects(pending, /no longer mounted/);
  policyRead = async subject => ({
    schema: INSTALLED_APP_CAPABILITY_DECISION_SCHEMA,
    appId: subject.appId, publisherId: subject.publisherId,
    packageSha256: subject.packageSha256, accountId: subject.accountId,
    spaceId: subject.spaceId, deviceId: subject.deviceId, capabilities: granted,
  });
});
