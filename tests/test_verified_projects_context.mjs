import assert from "node:assert/strict";
import test from "node:test";

import { createVerifiedProjectsContextProvider } from "../system/composition/native/verified-projects-context.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { PROJECT_CLOUD_LINKS_READER_SCHEMA } from "../system/contracts/project-cloud-links-reader.mjs";
import {
  hasNativeExternalFirstPartyModuleRead,
  hasNativeExternalFirstPartyProbation,
} from "../system/services/apps/external-first-party-policy.mjs";

function mutableHostCatalog() {
  const callbacks = new Set();
  const port = {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot() { return { persistence: "device", projects: [] }; },
    subscribe(listener) {
      callbacks.add(listener);
      return () => callbacks.delete(listener);
    },
    create() { throw new Error("mutation must remain private"); },
    rename() { throw new Error("mutation must remain private"); },
    remove() { throw new Error("mutation must remain private"); },
  };
  return { port, notify(snapshot) { for (const callback of callbacks) callback(snapshot); }, callbacks };
}

test("canonical policy allows signed read of migrated apps but not promotion", () => {
  for (const id of ["network", "projects"]) {
    assert.equal(hasNativeExternalFirstPartyModuleRead(id), true);
    assert.equal(hasNativeExternalFirstPartyProbation(id), false);
  }
  assert.equal(hasNativeExternalFirstPartyModuleRead("assistant"), false);
  assert.equal(hasNativeExternalFirstPartyModuleRead("calendar"), false);
});

test("Projects receives only validated read-only host catalog and cloud links", () => {
  const host = mutableHostCatalog();
  const cloud = Object.freeze({
    schema: PROJECT_CLOUD_LINKS_READER_SCHEMA,
    getSnapshot() { return { schema: "ordax.project-cloud-links/1", persistence: "device", links: [] }; },
    subscribe() { return () => {}; },
  });
  const provide = createVerifiedProjectsContextProvider({
    projects: host.port, projectCloudLinks: cloud,
  });
  for (const appId of ["network", "internet", "assistant", "files", "__proto__"]) {
    assert.equal(provide(appId), null);
  }
  const context = provide("projects");
  assert.deepEqual(Object.keys(context).sort(), ["projectCloudLinks", "projects"]);
  assert.ok(Object.isFrozen(context));
  for (const method of [
    "create", "rename", "remove", "recordOpened", "recordFileOpened",
    "clearLastFile", "relocateLastFilePath",
  ]) {
    assert.equal(method in context.projects, false);
  }
  assert.equal("link" in context.projectCloudLinks, false);
  assert.equal("unlink" in context.projectCloudLinks, false);
  assert.deepEqual(context.projects.getSnapshot().projects, []);
  assert.deepEqual(context.projectCloudLinks.getSnapshot().links, []);

  let observed = null;
  const unsubscribe = context.projects.subscribe((snapshot) => { observed = snapshot; });
  host.notify({ persistence: "session", projects: [] });
  assert.equal(observed.persistence, "session");
  assert.ok(Object.isFrozen(observed));
  assert.equal(host.callbacks.size, 1);
  unsubscribe();
  assert.equal(host.callbacks.size, 0);
});

test("host mutation methods do not escape and invalid streamed snapshots fail closed", () => {
  const host = mutableHostCatalog();
  const projectReader = createVerifiedProjectsContextProvider({ projects: host.port })("projects").projects;
  const unsubscribe = projectReader.subscribe(() => { throw new Error("must not receive invalid data"); });
  assert.throws(
    () => host.notify({ persistence: "device", projects: [{ id: "wrong" }] }),
    /Project/,
  );
  unsubscribe();
});

test("unavailable host never fabricates a catalog or permission", () => {
  const context = createVerifiedProjectsContextProvider()("projects");
  assert.deepEqual(context, { projects: null, projectCloudLinks: null });
});
