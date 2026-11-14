import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeDesktopProductRuntimeStatus,
  validateDesktopProductRuntimeStatus,
} from "../system/adapters/native/desktop-product-runtime-status.mjs";

const observation = Object.freeze({
  schema: "ordax.product-runtime-supervisor-status/1", host: "ordax-desktop",
  state: "running", reason: "dev_remote_attestation_pending", enrolled: true,
  deviceId: "14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5",
  processRunning: true, mcpReady: false, capabilityDigest: null,
  centralSessionAttested: false,
});

test("read-only Desktop port uses existing Electron-authorized Native endpoint", async () => {
  const requests = [];
  const port = createNativeDesktopProductRuntimeStatus({ fetch: async (...args) => {
    requests.push(args);
    return { status: 200, headers: { get: () => "application/json; charset=utf-8" },
      json: async () => observation };
  } });
  const result = await port.read();
  assert.deepEqual(requests, [["/__ordax/native/product-runtime-status",
    { method: "GET", credentials: "same-origin", cache: "no-store" }]]);
  assert.equal(result.state, "running");
  assert.equal(result.deviceId, "14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5");
  assert.equal(result.mcpReady, false);
  assert.equal(result.centralSessionAttested, false);
  assert.equal(Object.isFrozen(result), true);
});

test("unauthorized, unavailable and forged Native statuses fail closed", async () => {
  for (const status of [401, 403, 404, 503]) {
    const port = createNativeDesktopProductRuntimeStatus({ fetch: async () => ({
      status, headers: { get: () => "application/json" },
      json: async () => ({ ...observation, mcpReady: true, centralSessionAttested: true }),
    }) });
    await assert.rejects(port.read(), /unavailable/);
  }
  assert.throws(() => validateDesktopProductRuntimeStatus({ ...observation, host: "windows-agent" }));
  assert.throws(() => validateDesktopProductRuntimeStatus({ ...observation, deviceId: "not-a-device" }));
  assert.throws(() => validateDesktopProductRuntimeStatus({
    ...observation, state: "running", processRunning: false,
  }));
  assert.throws(() => validateDesktopProductRuntimeStatus({
    ...observation, capabilityDigest: "FAKE",
  }));
  assert.throws(() => createNativeDesktopProductRuntimeStatus({}));
});
test("Native MCP observation cannot turn a running process into invented attested capabilities",()=>{
  const digest="f".repeat(64);
  for(const invalid of [
    {...observation,mcpReady:true},
    {...observation,mcpReady:true,capabilityDigest:digest},
    {...observation,mcpReady:true,centralSessionAttested:true},
    {...observation,centralSessionAttested:true},
    {...observation,centralSessionAttested:true,capabilityDigest:digest,enrolled:false},
    {...observation,centralSessionAttested:true,capabilityDigest:digest,state:"blocked",processRunning:false},
    {...observation,state:"blocked",processRunning:true},
    {...observation,state:"stopping",processRunning:false},
    {...observation,state:"stopped",processRunning:true},
  ])assert.throws(()=>validateDesktopProductRuntimeStatus(invalid));
  const attested=validateDesktopProductRuntimeStatus({
    ...observation,centralSessionAttested:true,mcpReady:true,
    capabilityDigest:digest,
  });
  assert.equal(attested.mcpReady,true);
  assert.equal(attested.capabilityDigest,digest);
  assert.equal(Object.isFrozen(attested),true);
});
