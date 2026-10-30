import assert from "node:assert/strict";
import test from "node:test";
import { createNativeVerifiedComponentPackageSource } from "../system/adapters/native/verified-component-package-source.mjs";
import { createNativeSignedCurrentCompatibilityResolver } from "../system/adapters/native/signed-current-compatibility.mjs";

const SHA = "7".repeat(40);
const current = Object.freeze({
  componentId: "assistant", state: "current", source: "slot", revision: 8,
  version: "0.1.2", sourceCommit: SHA,
  entrypoint: "system/apps/assistant/src/runtime.mjs", pendingHealth: null,
});
const descriptor = Object.freeze({
  schema: "ordax.component-compatibility/1", componentId: "assistant",
  componentVersion: "0.1.2",
  provides: [{ id: "ordax.component-runtime", major: 1 }],
  requires: [{ id: "ordax.identity-session", minMajor: 1, maxMajor: 1, optional: false }],
  state: null, authority: "none",
});
const source = createNativeVerifiedComponentPackageSource({
  location: { href: "http://127.0.0.1:43121/system/composition/native/index.html" },
});
const result = Object.freeze({
  schema: "ordax.native-verified-current-compatibility/1",
  componentId: "assistant", state: "current", revision: 8,
  version: "0.1.2", sourceCommit: SHA, descriptor,
});

test("signed Native compatibility is fetched from exact current activation revision", async () => {
  const requests = [];
  const resolver = createNativeSignedCurrentCompatibilityResolver({
    source,
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { ok: true, text: async () => JSON.stringify(result) };
    },
  });
  const signed = await resolver(current);
  assert.deepEqual(signed, descriptor);
  assert.ok(Object.isFrozen(signed));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url,
    "http://127.0.0.1:43121/__ordax/native/component-compatibility?component=assistant&state=current&revision=8");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.redirect, "error");
});

test("signed compatibility rejects stale, forged and malformed descriptor without using it", async () => {
  const cases = [
    { ...result, revision: 9 },
    { ...result, componentId: "studio" },
    { ...result, version: "0.1.3" },
    { ...result, sourceCommit: "0".repeat(40) },
    { ...result, descriptor: { ...descriptor, componentId: "studio" } },
    { ...result, descriptor: { ...descriptor, componentVersion: "0.1.3" } },
    { ...result, descriptor: { ...descriptor, authority: "system" } },
    { ...result, descriptor: { ...descriptor, requires: "none" } },
  ];
  for (const value of cases) {
    const resolver = createNativeSignedCurrentCompatibilityResolver({
      source,
      fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify(value) }),
    });
    await assert.rejects(resolver(current));
  }
});

test("signed compatibility fails closed on missing broker, unverified slot or unauthorized source origin", async () => {
  let fetched = 0;
  const resolver = createNativeSignedCurrentCompatibilityResolver({
    source, fetchImpl: async () => {
      fetched++;
      return { status: 404, ok: false, text: async () => "" };
    },
  });
  await assert.rejects(resolver(current), /unavailable/);
  await assert.rejects(resolver({ ...current, revision: 0 }), /positive current slot/);
  await assert.rejects(resolver({ ...current, source: "absent" }), /Non-slot|inconsistent/);
  const hostile = createNativeSignedCurrentCompatibilityResolver({
    source: {
      schema: source.schema,
      metadataUrl: () => "https://example.invalid/__ordax/native/component-runtime?component=assistant&state=current",
      fileUrl: source.fileUrl,
    },
    fetchImpl: async () => { throw Error("Must not fetch off-origin"); },
  });
  await assert.rejects(hostile(current), /canonical Native origin/);
  assert.equal(fetched, 1);
});
