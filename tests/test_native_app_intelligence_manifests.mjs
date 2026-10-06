import assert from "node:assert/strict";
import test from "node:test";

import {
  createNativeAppIntelligenceManifestSource,
} from "../system/adapters/native/app-intelligence-manifests.mjs";

function response(status, body = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function envelope() {
  return {
    $schema: "ordax.native-app-intelligence-manifest/1",
    componentId: "notes",
    componentVersion: "0.4.1",
    sourceCommit: "a".repeat(40),
    revision: 9,
    manifest: {
      schema: "ordax.app-intelligence-manifest/1",
      appId: "notes",
      appVersion: "0.4.1",
      authority: "none",
      execution: "declarative-only",
      instructions: ["Use apenas capacidades declaradas."],
      intents: [],
    },
    authority: "none",
  };
}

test("native manifest source returns semantics only from canonical envelope", async () => {
  let request = null;
  const source = createNativeAppIntelligenceManifestSource({
    async fetch(url, options) {
      request = { url, options };
      return response(200, envelope());
    },
  });

  const value = await source.read("notes");
  assert.equal(value.manifest.appId, "notes");
  assert.equal(value.manifest.execution, "declarative-only");
  assert.equal(value.authority, "none");
  assert.equal(request.url, "/__ordax/native/app-intelligence-manifest?component=notes");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "same-origin");
});

test("missing active component semantics are represented as null", async () => {
  const source = createNativeAppIntelligenceManifestSource({
    async fetch() { return response(404); },
  });
  assert.equal(await source.read("notes"), null);
});

test("native manifest source rejects identity or authority drift", async () => {
  const wrong = envelope();
  wrong.manifest.appId = "studio";
  const source = createNativeAppIntelligenceManifestSource({
    async fetch() { return response(200, wrong); },
  });
  await assert.rejects(() => source.read("notes"), /appId mismatch|component mismatch/);

  const authority = envelope();
  authority.authority = "native";
  const source2 = createNativeAppIntelligenceManifestSource({
    async fetch() { return response(200, authority); },
  });
  await assert.rejects(() => source2.read("notes"), /boundary is invalid/);
});
