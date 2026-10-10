import assert from "node:assert/strict";
import test from "node:test";
import { discoverVerifiedExternalApplications } from "../system/services/apps/verified-external-app-catalog.mjs";

const SHA = "7".repeat(40);
const META = Object.freeze({
  componentId: "notes", state: "current", source: "slot",
  revision: 4, version: "0.5.0", sourceCommit: SHA,
  entrypoint: "system/apps/notes/src/runtime.mjs", pendingHealth: null,
});
const COMPONENT = Object.freeze({
  schema: "ordax.component-manifest/1", id: "notes", title: "Notas",
  kind: "app", version: "0.5.0", releaseMode: "component-slot",
  criticality: "optional", failureDomain: "app", restartScope: "component",
  healthMode: "runtime", owner: "ordaxsystems/ordax-apps", dependencies: [],
});
const PRESENTATION = Object.freeze({
  schema: "ordax.app-presentation-manifest/1",
  appId: "notes", appVersion: "0.5.0", authority: "none",
  sourceLocale: "pt-BR", description: "Notas verificadas",
  monogram: "NT", singleton: true,
  translations: { "en-US": { title: "Notes", description: "Verified notes" } },
});
const ASSOCIATIONS = Object.freeze({
  schema: "ordax.file-association-manifest/1",
  appId: "notes", appVersion: "0.5.0", authority: "none",
  role: "viewer", extensions: ["md", "txt"],
});

function fixture({ metadata = META, component = COMPONENT,
                   presentation = PRESENTATION, association = ASSOCIATIONS } = {}) {
  const calls = [];
  const source = Object.freeze({
    schema: "ordax.verified-component-package-source/1",
    metadataUrl(appId, state) {
      assert.equal(state, "current");
      return `http://127.0.0.1:4190/__ordax/native/component-runtime?component=${appId}&state=${state}`;
    },
    fileUrl({ componentId, state, resolution, path }) {
      assert.equal(componentId, "notes");
      assert.equal(state, "current");
      assert.equal(resolution.version, "0.5.0");
      return `http://127.0.0.1:4190/__ordax/native/component-module/notes/current/0.5.0/${SHA}/${path}`;
    },
  });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("component-runtime?")) return reply(metadata);
    if (url.endsWith("/app.json")) return reply(component);
    if (url.endsWith("/presentation/manifest.json")) return reply(presentation, presentation === null ? 404 : 200);
    if (url.endsWith("/associations/manifest.json")) return reply(association, association === null ? 404 : 200);
    throw new Error("Untrusted file request");
  };
  return { source, fetchImpl, calls };
}
function reply(value, status = 200) {
  return { status, ok: status === 200, async json() { return value; } };
}

test("verified current-slot presentation and association preserve exact owner and version", async () => {
  const t = fixture();
  const entries = await discoverVerifiedExternalApplications({
    source: t.source, fetchImpl: t.fetchImpl, appIds: ["notes"],
    onError(error) { throw error; },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].app.id, "notes");
  assert.equal(entries[0].app.panels[0].kind, "extension");
  assert.equal(entries[0].component.owner, "ordaxsystems/ordax-apps");
  assert.deepEqual(entries[0].association.extensions, ["md", "txt"]);
  assert.ok(Object.isFrozen(entries));
  assert.equal(t.calls.length, 4);
  for (const call of t.calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
  }
});

test("missing optional presentation disables discoverability and absent file associations do not grant Files", async () => {
  const absent = fixture({ presentation: null });
  assert.deepEqual(await discoverVerifiedExternalApplications({
    source: absent.source, fetchImpl: absent.fetchImpl, appIds: ["notes"],
  }), []);
  const noFiles = fixture({ association: null });
  const entries = await discoverVerifiedExternalApplications({
    source: noFiles.source, fetchImpl: noFiles.fetchImpl, appIds: ["notes"],
    onError(error) { throw error; },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].association, null);
});

test("identity, owner, manifest and metadata drift fail closed without runtime execution", async () => {
  for (const options of [
    { metadata: { ...META, version: "9.9.9" } },
    { metadata: { ...META, entrypoint: "system/apps/files/src/runtime.mjs" } },
    { component: { ...COMPONENT, owner: "attacker/repository" } },
    { component: { ...COMPONENT, version: "0.6.0" } },
    { presentation: { ...PRESENTATION, authority: "system" } },
    { association: { ...ASSOCIATIONS, appVersion: "9.9.9" } },
  ]) {
    const t = fixture(options);
    const errors = [];
    const entries = await discoverVerifiedExternalApplications({
      source: t.source, fetchImpl: t.fetchImpl, appIds: ["notes"],
      onError(error, id) { errors.push({ error, id }); },
    });
    assert.deepEqual(entries, []);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].id, "notes");
  }
});

test("only canonical external IDs can be discovered and package-source is read-only", async () => {
  const t = fixture();
  await assert.rejects(() => discoverVerifiedExternalApplications({
    source: t.source, fetchImpl: t.fetchImpl, appIds: ["unknown-app"],
  }), /canonical package policy/);
  await assert.rejects(() => discoverVerifiedExternalApplications({
    source: { ...t.source, install() {} }, fetchImpl: t.fetchImpl, appIds: ["notes"],
  }), /must not expose install/);
  // Calendar is a known Store id but cannot be imported by the Native
  // component-module broker until the canonical module-read policy allows it.
  assert.deepEqual(await discoverVerifiedExternalApplications({
    source: t.source, fetchImpl: t.fetchImpl, appIds: ["calendar"],
  }), []);
  assert.equal(t.calls.length, 0);
  assert.equal(t.calls.length, 0);
});
