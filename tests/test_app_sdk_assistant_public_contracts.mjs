import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bundle = JSON.parse(readFileSync(new URL("../sdk/app-sdk-v1/bundle.json", import.meta.url), "utf8"));
const required = [
  {
    "name": "intelligence-conversation-capabilities",
    "schema": "ordax.intelligence-conversation-capabilities/1"
  },
  {
    "name": "personal-work-item",
    "schema": "ordax.personal-work-item/1"
  },
  {
    "name": "personal-activity",
    "schema": "ordax.personal-activity/1"
  },
  {
    "name": "personal-action-decision",
    "schema": "ordax.personal-action-decision/1"
  },
  {
    "name": "personal-approval",
    "schema": "ordax.personal-approval/1"
  },
  {
    "name": "personal-work-result",
    "schema": "ordax.personal-work-result/1"
  },
  {
    "name": "personal-action-attempt",
    "schema": "ordax.personal-action-attempt/1"
  },
  {
    "name": "personal-work-store",
    "schema": "ordax.personal-work-store/1"
  },
  {
    "name": "personal-work-store-state",
    "schema": "ordax.personal-work-store-state/1"
  },
  {
    "name": "personal-runtime",
    "schema": "ordax.personal-runtime/1"
  }
];

test("Assistant and Personal OrdaX schemas are published only as versioned App SDK data contracts", () => {
  assert.equal(bundle.bundle_version, "1.18.0");
  assert.equal(bundle.authority, "none");
  const byName = new Map(bundle.contracts.map(x => [x.name, x]));
  assert.equal(byName.size, bundle.contracts.length);
  for (const expected of required) {
    const entry = byName.get(expected.name);
    assert.ok(entry, expected.name + " must be published through the canonical exporter");
    assert.equal(entry.schema, expected.schema);
    assert.equal(entry.major, 1);
    assert.match(entry.source_path, /^system\/contracts\//);
    const sourcePath = fileURLToPath(new URL("../" + entry.source_path, import.meta.url));
    const source = readFileSync(sourcePath);
    const gitBlob = createHash("sha1").update("blob " + source.length + "\0").update(source).digest("hex");
    assert.equal(entry.source_git_blob, gitBlob, expected.name + " must pin the exact owner blob");
  }
});

test("portable Assistant SDK closure is public and exposes no native execution authority", () => {
  const byPath = new Set(bundle.contracts.map(x => x.source_path));
  const closure = [
    "intelligence.mjs", "intelligence-conversation-capabilities.mjs",
    "identity-session.mjs", "space-selection.mjs", "profile-activation-state.mjs",
    "personal-ordax.mjs", "personal-ordax-store.mjs", "component-runtime.mjs",
    "surface-render-lifecycle.mjs", "app-activation.mjs",
    "first-party-app.mjs", "component-manifest.mjs", "app-intelligence-manifest.mjs",
  ];
  for (const file of closure) assert.ok(byPath.has("system/contracts/" + file), file);
  const store = readFileSync(new URL("../system/contracts/personal-ordax-store.mjs", import.meta.url), "utf8");
  assert.match(store, /from "\.\/personal-ordax\.mjs"/);
  assert.equal(bundle.authority, "none");
});
