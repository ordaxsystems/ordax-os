import assert from "node:assert/strict";
import test from "node:test";

import {
  createNativeInstalledAppAwarenessSource,
} from "../system/adapters/native/app-intelligence-awareness.mjs";

function response(status, body = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

function envelope() {
  return {
    $schema: "ordax.native-app-intelligence-awareness/1",
    componentId: "notes",
    componentVersion: "0.4.1",
    sourceCommit: "a".repeat(40),
    revision: 9,
    component: {
      schema: "ordax.component-manifest/1",
      id: "notes",
      title: "Notas",
      kind: "app",
      version: "0.4.1",
      releaseMode: "component-slot",
      criticality: "optional",
      failureDomain: "app",
      restartScope: "component",
      healthMode: "runtime",
      owner: "washingtonmsdj/ordax-apps",
      dependencies: [],
    },
    manifest: {
      schema: "ordax.app-intelligence-manifest/1",
      appId: "notes",
      appVersion: "0.4.1",
      authority: "none",
      execution: "declarative-only",
      instructions: ["Use somente capacidades declaradas."],
      intents: [],
    },
    authority: "none",
  };
}

test("installed app awareness source binds component identity and semantics", async () => {
  let request = null;
  const source = createNativeInstalledAppAwarenessSource({
    async fetch(url, options) {
      request = { url, options };
      return response(200, envelope());
    },
  });

  const value = await source.read("notes");
  assert.equal(value.component.id, "notes");
  assert.equal(value.component.title, "Notas");
  assert.equal(value.component.releaseMode, "component-slot");
  assert.equal(value.manifest.appId, "notes");
  assert.equal(value.manifest.execution, "declarative-only");
  assert.equal(value.authority, "none");
  assert.equal(request.url, "/__ordax/native/app-intelligence-awareness?component=notes");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "same-origin");
});

test("absent or unsupported installed app awareness is null", async () => {
  const source = createNativeInstalledAppAwarenessSource({
    async fetch() { return response(404); },
  });
  assert.equal(await source.read("notes"), null);
});

test("installed app awareness rejects component and semantic identity drift", async () => {
  const wrongComponent = envelope();
  wrongComponent.component.version = "0.4.2";
  const componentSource = createNativeInstalledAppAwarenessSource({
    async fetch() { return response(200, wrongComponent); },
  });
  await assert.rejects(
    () => componentSource.read("notes"),
    /component identity is invalid/,
  );

  const wrongManifest = envelope();
  wrongManifest.manifest.appId = "studio";
  const manifestSource = createNativeInstalledAppAwarenessSource({
    async fetch() { return response(200, wrongManifest); },
  });
  await assert.rejects(
    () => manifestSource.read("notes"),
    /appId mismatch/,
  );
});
