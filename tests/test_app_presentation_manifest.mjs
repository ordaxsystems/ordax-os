import assert from "node:assert/strict";
import test from "node:test";
import { validateAppPresentationManifest } from "../system/contracts/app-presentation-manifest.mjs";

const presentation = Object.freeze({
  schema: "ordax.app-presentation-manifest/1",
  appId: "notes",
  appVersion: "0.5.0",
  authority: "none",
  sourceLocale: "pt-BR",
  description: "Escreva notas.",
  monogram: "NT",
  singleton: true,
  translations: {
    "en-US": { title: "Notes", description: "Write notes." },
  },
});

test("external presentation validates identity, locale and immutable copy", () => {
  const result = validateAppPresentationManifest(presentation, { appId: "notes", appVersion: "0.5.0" });
  assert.equal(result.appId, "notes");
  assert.equal(result.translations["en-US"].title, "Notes");
  assert.ok(Object.isFrozen(result.translations));
  assert.ok(Object.isFrozen(result.translations["en-US"]));
});

test("external presentation cannot carry authority or drift from installed app", () => {
  assert.throws(() => validateAppPresentationManifest({ ...presentation, authority: "root" }), /cannot grant authority/);
  assert.throws(() => validateAppPresentationManifest(presentation, { appVersion: "0.6.0" }), /version drifted/);
  assert.throws(() => validateAppPresentationManifest({ ...presentation, permissions: [] }), /fields are not canonical/);
  assert.throws(() => validateAppPresentationManifest({ ...presentation, appId: "../notes" }), /Component id is invalid/);
});

test("presentation rejects unbounded, untrusted and malformed locale text", () => {
  assert.throws(() => validateAppPresentationManifest({ ...presentation, description: "x".repeat(321) }), /invalid/);
  assert.throws(() => validateAppPresentationManifest({
    ...presentation, translations: { "en-US": { title: "<script>\n", description: "Bad" } },
  }), /invalid/);
  assert.throws(() => validateAppPresentationManifest({
    ...presentation, translations: { "pt-BR": { title: "Duplicada", description: "Duplicada" } },
  }), /locale is invalid/);
  assert.throws(() => validateAppPresentationManifest({
    ...presentation, translations: { "en-US": { title: "Notes", description: "OK", capabilities: [] } },
  }), /fields are not canonical/);
});
