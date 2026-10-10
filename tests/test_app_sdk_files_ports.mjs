import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  RECENT_FILES_SCHEMA,
  MAX_RECENT_FILES,
  validateRecentFilesSnapshot,
  assertRecentFilesPort,
} from "../system/contracts/recent-files.mjs";

test("App SDK preserves the canonical recent-files public interface from version 1.15 onward", async () => {
  const sdk = JSON.parse(await readFile(new URL("../sdk/app-sdk-v1/bundle.json", import.meta.url), "utf8"));
  const [major, minor] = sdk.bundle_version.split(".").map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 15));
  assert.equal(sdk.authority, "none");
  const published = sdk.contracts.filter((entry) => entry.name === "recent-files");
  assert.equal(published.length, 1);
  assert.equal(published[0].schema, RECENT_FILES_SCHEMA);
  assert.equal(published[0].major, 1);
  assert.equal(published[0].source_path, "system/contracts/recent-files.mjs");
  assert.match(published[0].source_git_blob, /^[0-9a-f]{40}$/);
  assert.ok(sdk.contracts.some((entry) => entry.name === "file-space" && entry.schema === "ordax.file-space/11"));
  assert.equal(sdk.contracts.some((entry) => entry.source_path === "system/services/files/recent-files.mjs"), false);
  assert.equal(sdk.contracts.some((entry) => entry.source_path === "system/adapters/native/recent-files.mjs"), false);
});

test("recent-files contract only accepts bounded, typed snapshots and host-provided ports", () => {
  assert.equal(MAX_RECENT_FILES, 32);
  assert.throws(() => validateRecentFilesSnapshot({ persistence: "device", entries: [{ path: "/" }] }));
  assert.throws(() => validateRecentFilesSnapshot({ persistence: "system", entries: [] }));
  const current = validateRecentFilesSnapshot({ persistence: "session", entries: [] });
  assert.deepEqual(current.entries, []);
  const port = {
    schema: RECENT_FILES_SCHEMA,
    getSnapshot: () => current,
    subscribe: () => () => {},
    recordOpened: () => current,
    remove: () => current,
    clear: () => current,
    relocate: () => current,
  };
  assert.equal(assertRecentFilesPort(port), port);
  assert.throws(() => assertRecentFilesPort({ ...port, schema: "ordax.recent-files/2" }));
  assert.throws(() => assertRecentFilesPort({ ...port, relocate: null }));
});
