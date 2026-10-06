import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_CATALOG_SCHEMA,
  assertProjectCatalogPort,
  assertProjectCatalogReader,
} from "../system/contracts/project-catalog.mjs";

function snapshot() {
  return Object.freeze({
    persistence: "device",
    projects: Object.freeze([]),
  });
}

function readerOnly() {
  return Object.freeze({
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("listener required");
      return () => {};
    },
  });
}

test("read-only Project consumers do not need mutation authority", () => {
  const reader = readerOnly();
  assert.equal(assertProjectCatalogReader(reader), reader);
  assert.throws(
    () => assertProjectCatalogPort(reader),
    /project-catalog port must implement create\(\)/,
  );
  for (const mutation of [
    "create",
    "rename",
    "recordOpened",
    "recordFileOpened",
    "clearLastFile",
    "relocateLastFilePath",
    "remove",
  ]) {
    assert.equal(Object.hasOwn(reader, mutation), false);
  }
});

test("full Project catalog remains a valid reader without a wrapper or duplicate state", () => {
  const full = Object.freeze({
    ...readerOnly(),
    create() {},
    rename() {},
    recordOpened() {},
    recordFileOpened() {},
    clearLastFile() {},
    relocateLastFilePath() {},
    remove() {},
  });
  assert.equal(assertProjectCatalogReader(full), full);
  assert.equal(assertProjectCatalogPort(full), full);
});

test("Project reader validates the snapshot at the trust boundary", () => {
  assert.throws(
    () => assertProjectCatalogReader({
      schema: PROJECT_CATALOG_SCHEMA,
      getSnapshot() {
        return {
          persistence: "device",
          projects: [{
            id: "forged",
            name: "Finance App",
            path: "/Documentos/finance-app",
            createdAt: 1000,
            lastOpenedAt: 1000,
            lastFilePath: null,
          }],
        };
      },
      subscribe() { return () => {}; },
    }),
    /Project id is invalid/,
  );
});
