import assert from "node:assert/strict";
import test from "node:test";
import { defineExternalFirstPartyApp, externalAppCopy } from "../system/apps/external-app-definition.mjs";
import { createAppRuntimeCatalog, assertAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";
import { listFirstPartyApps } from "../system/apps/catalog.mjs";

const component = {
  id: "notes",
  title: "Notas",
  kind: "app",
  version: "0.5.0",
  releaseMode: "component-slot",
  criticality: "optional",
  failureDomain: "app",
  restartScope: "component",
  healthMode: "runtime",
  owner: "ordaxsystems/ordax-apps",
  dependencies: ["surface-shell"],
};
const presentation = {
  schema: "ordax.app-presentation-manifest/1",
  appId: "notes",
  appVersion: "0.5.0",
  authority: "none",
  sourceLocale: "pt-BR",
  description: "Suas notas.",
  monogram: "NT",
  singleton: true,
  translations: { "en-US": { title: "Notes", description: "Your notes." } },
};

test("external app uses OS first-party schema, never stale apps/ import", () => {
  const app = defineExternalFirstPartyApp(component, presentation);
  assert.equal(app.id, "notes");
  assert.equal(app.component.owner, "ordaxsystems/ordax-apps");
  assert.equal(app.panels[0].kind, "extension");
  assert.equal(app.panels[0].extensionId, "notes");
  assert.deepEqual(app.requiredCapabilities, []);
  assert.equal(app.localization.sourceLocale, "pt-BR");
  assert.deepEqual(externalAppCopy(app, "en-US"), { title: "Notes", description: "Your notes." });
  assert.deepEqual(externalAppCopy(app, "fr-FR"), { title: "Notas", description: "Suas notas." });
});

test("external apps reject version mismatch and non-slot or non-app components", () => {
  assert.throws(() => defineExternalFirstPartyApp(component, { ...presentation, appVersion: "0.6.0" }), /version drifted/);
  assert.throws(() => defineExternalFirstPartyApp({ ...component, releaseMode: "bundled" }, presentation), /component-slot app/);
  assert.throws(() => defineExternalFirstPartyApp({ ...component, kind: "service", failureDomain: "service" }, presentation), /component-slot app/);
});

test("runtime catalog derives built-ins from the canonical catalog and adds only unique external identities", () => {
  const notes = defineExternalFirstPartyApp(component, presentation);
  const registry = createAppRuntimeCatalog({ external: [notes] });
  assertAppRuntimeCatalog(registry);
  assert.equal(registry.get("notes"), notes);
  assert.equal(registry.list().length, listFirstPartyApps().length + 1);
  assert.equal(registry.get("files"), listFirstPartyApps().find(app => app.id === "files"));
  assert.equal(registry.get("unknown"), null);
  assert.equal(registry.isAvailable(notes, []), true);
  assert.ok(Object.isFrozen(registry.list()));
});

test("built-ins cannot be replaced and repeated external ids fail closed", () => {
  const notes = defineExternalFirstPartyApp(component, presentation);
  const collision = defineExternalFirstPartyApp(
    { ...component, id: "files", title: "Arquivos", dependencies: ["surface-shell"] },
    { ...presentation, appId: "files" },
  );
  const registry = createAppRuntimeCatalog({ external: [collision, notes] });
  assert.equal(registry.get("files"), listFirstPartyApps().find(app => app.id === "files"));
  assert.equal(registry.list().length, listFirstPartyApps().length + 1);
  assert.throws(() => createAppRuntimeCatalog({ external: [notes, notes] }), /Duplicate external app id/);
  assert.throws(() => createAppRuntimeCatalog({ builtIns: [listFirstPartyApps()[0], listFirstPartyApps()[0]] }), /Duplicate built-in app id/);
  assert.throws(() => createAppRuntimeCatalog({ external: [{ ...notes, panels: [] }] }), /descriptive component-slot data/);
});
