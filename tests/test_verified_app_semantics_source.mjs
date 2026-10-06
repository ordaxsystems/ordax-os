import assert from "node:assert/strict";
import test from "node:test";

import { createNativeVerifiedComponentPackageSource } from "../system/adapters/native/verified-component-package-source.mjs";
import { loadVerifiedFirstPartyIntelligenceManifests } from "../system/services/intelligence/verified-app-semantics.mjs";

const SHA = "7".repeat(40);

function windowRef() {
  return { location: { href: "http://127.0.0.1:43121/" } };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function slotMetadata(appId = "notes", version = "0.4.1") {
  return {
    componentId: appId,
    state: "current",
    source: "slot",
    revision: 5,
    version,
    sourceCommit: SHA,
    entrypoint: `system/apps/${appId}/src/runtime.mjs`,
    pendingHealth: null,
  };
}

function semantics(appId = "notes", version = "0.4.1") {
  return {
    schema: "ordax.app-intelligence-manifest/1",
    appId,
    appVersion: version,
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use somente as capacidades declaradas pelo app verificado."],
    intents: [
      {
        id: `${appId}.create-note`,
        description: "Criar uma nota.",
        effect: "write",
        confirmation: "policy",
        parameters: [],
        examples: ["Crie uma nota."],
      },
    ],
  };
}

test("verified app semantics loads manifest from the exact current slot identity", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const calls = [];
  const manifests = await loadVerifiedFirstPartyIntelligenceManifests({
    appIds: ["notes"],
    source,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      const parsed = new URL(url);
      if (parsed.pathname === "/__ordax/native/component-runtime") {
        return jsonResponse(slotMetadata());
      }
      assert.equal(
        parsed.pathname,
        "/__ordax/native/component-module/notes/current/0.4.1/"
          + SHA
          + "/system/apps/notes/ai/manifest.json",
      );
      return jsonResponse(semantics());
    },
  });

  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].appId, "notes");
  assert.equal(manifests[0].appVersion, "0.4.1");
  assert.equal(manifests[0].authority, "none");
  assert.equal(manifests[0].execution, "declarative-only");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
  }
});

test("absent external app is skipped without attempting to read a manifest", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  let calls = 0;
  const manifests = await loadVerifiedFirstPartyIntelligenceManifests({
    appIds: ["notes"],
    source,
    async fetchImpl(url) {
      calls += 1;
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/__ordax/native/component-runtime");
      return jsonResponse({
        componentId: "notes",
        state: "current",
        source: "absent",
        revision: 7,
        version: null,
        sourceCommit: null,
        entrypoint: null,
        pendingHealth: null,
      });
    },
  });
  assert.deepEqual(manifests, []);
  assert.equal(calls, 1);
});

test("manifest version must match the exact verified slot version", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  await assert.rejects(
    () => loadVerifiedFirstPartyIntelligenceManifests({
      appIds: ["notes"],
      source,
      async fetchImpl(url) {
        const parsed = new URL(url);
        if (parsed.pathname === "/__ordax/native/component-runtime") {
          return jsonResponse(slotMetadata("notes", "0.4.1"));
        }
        return jsonResponse(semantics("notes", "0.4.2"));
      },
    }),
    /appVersion mismatch/,
  );
});

test("verified package source never exposes mutation or execution methods", () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  for (const method of [
    "execute",
    "invoke",
    "run",
    "install",
    "uninstall",
    "promote",
    "rollback",
    "writeFile",
  ]) {
    assert.equal(source[method], undefined);
  }
});
