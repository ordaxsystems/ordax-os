import assert from "node:assert/strict";
import test from "node:test";
import { WEB_PROVIDER_SCHEMA } from "../system/contracts/web-research.mjs";
import { createWebProviderRouter } from "../system/services/web-research/provider-router.mjs";

function provider(providerId, capabilities) {
  const value = {
    schema: WEB_PROVIDER_SCHEMA,
    providerId,
    capabilities,
  };
  for (const capability of capabilities) {
    value[capability] = async () => ({ providerId, capability });
  }
  return value;
}

test("router resolves only registered provider capabilities", () => {
  const first = provider("alpha", ["search", "extract"]);
  const second = provider("beta", ["search"]);
  const router = createWebProviderRouter({ providers: [first, second] });

  assert.equal(router.resolve("search"), first);
  assert.equal(router.resolve("search", { preferredProviderIds: ["beta", "alpha"] }), second);
  assert.equal(router.resolve("extract", { preferredProviderIds: ["beta", "alpha"] }), first);
  assert.throws(() => router.resolve("crawl"), /No configured Web provider/);
});

test("router rejects invalid provider registry state", () => {
  const first = provider("alpha", ["search"]);
  assert.throws(
    () => createWebProviderRouter({ providers: [first, provider("alpha", ["extract"])] }),
    /duplicate provider ids/,
  );
  assert.throws(() => createWebProviderRouter({ providers: {} }), /providers array/);
});

test("router snapshot exposes descriptors without provider implementation or secrets", () => {
  const first = {
    ...provider("alpha", ["search"]),
    apiKey: "must-not-leak",
  };
  const snapshot = createWebProviderRouter({ providers: [first] }).getSnapshot();

  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.providers));
  assert.deepEqual(snapshot.providers, [
    { providerId: "alpha", capabilities: ["search"] },
  ]);
  assert.equal("apiKey" in snapshot.providers[0], false);
  assert.equal("search" in snapshot.providers[0], false);
});

test("preferred providers are routing hints, not authority tokens", () => {
  const first = provider("alpha", ["search"]);
  const router = createWebProviderRouter({ providers: [first] });

  assert.throws(
    () => router.resolve("search", { preferredProviderIds: ["alpha", "alpha"] }),
    /duplicates/,
  );
  assert.equal(router.resolve("search", { preferredProviderIds: ["unknown"] }), first);
});
