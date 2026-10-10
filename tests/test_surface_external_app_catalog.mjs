import test from "node:test";
import assert from "node:assert/strict";
import { createAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";
import { defineExternalFirstPartyApp } from "../system/apps/external-app-definition.mjs";
import { createSurfaceState, createWorkspaceSnapshot, getActiveArea, reduceSurfaceState }
  from "../system/surface/ui/surface-state.mjs";

const component = {
  id: "notes", title: "Notas", kind: "app", version: "0.4.3",
  releaseMode: "component-slot", criticality: "optional",
  failureDomain: "app", restartScope: "component", healthMode: "runtime",
  owner: "ordaxsystems/ordax-apps", dependencies: [],
};
const presentation = {
  schema: "ordax.app-presentation-manifest/1", appId: "notes",
  appVersion: "0.4.3", authority: "none", sourceLocale: "pt-BR",
  description: "Notas verificadas.", monogram: "NT", singleton: true,
  translations: { "en-US": { title: "Notes", description: "Verified notes." } },
};
const catalog = createAppRuntimeCatalog({
  external: [defineExternalFirstPartyApp(component, presentation)],
});
const host = { capabilityIds: [], connectivity: "online" };
const action = { type: "app.launch", appId: "notes" };
const active = getActiveArea;

test("surface launches only catalog-known external apps in the selected area", () => {
  let state = createSurfaceState(host, {}, null, catalog);
  state = reduceSurfaceState(state, action, catalog);
  assert.deepEqual(active(state).windows.map(w => w.appId), ["notes"]);
  const repeat = reduceSurfaceState(state, action, catalog);
  assert.equal(active(repeat).windows.length, 1);
  assert.equal(active(repeat).windows[0].id, "notes");
  state = reduceSurfaceState(repeat, { type: "area.switch", areaId: "area-2" }, catalog);
  state = reduceSurfaceState(state, action, catalog);
  assert.deepEqual(state.areas.map(a => a.windows.map(w => w.id)), [["notes"], ["notes"]]);
});

test("workspace uses same catalog on recovery and drops disappeared external apps", () => {
  let state = createSurfaceState(host, {}, null, catalog);
  state = reduceSurfaceState(state, action, catalog);
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" }, catalog);
  const snapshot = createWorkspaceSnapshot(state);
  const recovered = createSurfaceState(host, {}, snapshot, catalog);
  assert.deepEqual(active(recovered).windows.map(w => w.id), ["notes", "files"]);
  const absent = createSurfaceState(host, {}, snapshot);
  assert.deepEqual(active(absent).windows.map(w => w.id), ["files"]);
  assert.equal(reduceSurfaceState(absent, action), absent);
});

test("Surface reducer does not trust arbitrary app IDs or pretend catalog authority", () => {
  const state = createSurfaceState(host, {}, null, catalog);
  assert.equal(reduceSurfaceState(state, { type: "app.launch", appId: "unknown" }, catalog), state);
  assert.throws(() => createSurfaceState(host, {}, null, {
    schema: "ordax.app-runtime-catalog/1",
    list() { return []; },
    get() { return null; },
  }), /compatible app runtime catalog/);
  const empty = createAppRuntimeCatalog({ external: [] });
  assert.equal(reduceSurfaceState(state, action, empty), state);
});

test("catalog removal prunes failed external windows without losing OS workspace or persistence", () => {
  let state = createSurfaceState(host, {}, null, catalog);
  state = reduceSurfaceState(state, action, catalog);
  state = reduceSurfaceState(state, { type: "app.launch", appId: "files" }, catalog);
  state = reduceSurfaceState(state, { type: "area.switch", areaId: "area-2" }, catalog);
  state = reduceSurfaceState(state, action, catalog);
  const withoutInstalledNotes = createAppRuntimeCatalog({ external: [] });
  state = reduceSurfaceState(state, { type: "app.catalog.sync" }, withoutInstalledNotes);
  assert.deepEqual(state.areas.map(area => area.windows.map(w => w.appId)), [["files"], []]);
  assert.equal(state.areas[1].activeWindowId, null);
  assert.equal(state.areas[0].activeWindowId, "files");
  assert.equal(reduceSurfaceState(state, action, withoutInstalledNotes), state);
  const snapshot = createWorkspaceSnapshot(state);
  assert.deepEqual(snapshot.areas.map(area => area.windows.map(w => w.appId)), [["files"], []]);
});
