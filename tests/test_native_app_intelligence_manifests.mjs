import assert from "node:assert/strict";
import test from "node:test";

import {
  NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA,
  NATIVE_APP_INTELLIGENCE_SOURCE_SCHEMA,
  createNativeAppIntelligenceManifestSource,
} from "../system/adapters/native/app-intelligence-manifests.mjs";

function manifest(overrides = {}) {
  return {
    schema: "ordax.app-intelligence-manifest/1",
    appId: "notes",
    appVersion: "0.4.1",
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use somente as capacidades declaradas."],
    intents: [{
      id: "notes.create-note",
      description: "Criar uma nota.",
      effect: "write",
      confirmation: "policy",
      parameters: [],
      examples: ["Crie uma nota."],
    }],
    ...overrides,
  };
}

function windowRef(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (...args) => {
      calls.push(args);
      return {
        ok,
        status,
        async json() {
          return payload;
        },
      };
    },
  };
}

test("native app intelligence source revalidates verified manifest payloads", async () => {
  const window = windowRef({
    schema: NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA,
    manifests: [manifest()],
  });
  const source = await createNativeAppIntelligenceManifestSource(window);

  assert.equal(source.schema, NATIVE_APP_INTELLIGENCE_SOURCE_SCHEMA);
  assert.equal(source.getManifests().length, 1);
  assert.equal(source.getManifests()[0].appId, "notes");
  assert.equal(source.getManifests()[0].authority, "none");
  assert.equal(source.getManifests()[0].execution, "declarative-only");

  const [url, options] = window.calls[0];
  assert.equal(url, "/__ordax/native/app-intelligence-catalog");
  assert.equal(options.method, "GET");
  assert.equal(options.cache, "no-store");
  assert.equal(options.credentials, "same-origin");
});

test("native app intelligence source fails closed on transport or authority drift", async () => {
  await assert.rejects(
    () => createNativeAppIntelligenceManifestSource(windowRef({
      schema: "wrong",
      manifests: [],
    })),
    /schema is incompatible/,
  );

  await assert.rejects(
    () => createNativeAppIntelligenceManifestSource(windowRef({
      schema: NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA,
      manifests: [manifest({ authority: "app" })],
    })),
    /must not carry authority/,
  );

  await assert.rejects(
    () => createNativeAppIntelligenceManifestSource(
      windowRef({}, { ok: false, status: 409 }),
    ),
    /unavailable: 409/,
  );
});

test("refresh replaces manifests atomically and dispose clears local copy", async () => {
  let payload = {
    schema: NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA,
    manifests: [manifest()],
  };
  const calls = [];
  const window = {
    fetch: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        async json() {
          return payload;
        },
      };
    },
  };
  const source = await createNativeAppIntelligenceManifestSource(window);
  payload = {
    schema: NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA,
    manifests: [],
  };
  const refreshed = await source.refresh();
  assert.deepEqual(refreshed, []);
  assert.deepEqual(source.getManifests(), []);
  assert.equal(calls.length, 2);

  source.dispose();
  assert.deepEqual(source.getManifests(), []);
  await assert.rejects(() => source.refresh(), /disposed/);
});
