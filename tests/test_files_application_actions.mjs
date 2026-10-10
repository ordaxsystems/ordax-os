import assert from "node:assert/strict";
import test from "node:test";

import { filesApplicationActionManifest } from "../system/apps/files/actions/manifest.mjs";
import {
  createFilesApplicationActionProvider,
  FILES_NATIVE_ACTIONS,
  applicationActionProviderArtifact,
} from "../system/apps/files/actions/providers/files-native.mjs";

function scopedPort(list) {
  const listing = (path) => ({ path, entries: [] });
  return {
    schema: "ordax.file-space/11",
    list,
    createDirectory: async (path) => listing(path),
    readTextFile: async (path) => ({ path, size: 0, text: "" }),
    renameEntry: async (path) => listing(path),
    copyFile: async (_source, _entry, target) => listing(target),
    moveEntry: async (_source, _entry, target) => listing(target),
    trashEntry: async (path) => listing(path),
    listTrash: async () => ({ entries: [] }),
    restoreTrashEntry: async () => ({ entries: [] }),
    exportFile: async () => true,
    importFile: async (path) => listing(path),
  };
}
function invocation(location, overrides = {}) {
  return {
    schema: "ordax.application-action-provider-invocation/1",
    workItemId: "files-test-1",
    resourceRef: "application-action:files-test",
    appId: "files",
    actionId: "files.browse",
    arguments: location === undefined ? {} : { location },
    ...overrides,
  };
}
test("canonical Files actions declare only the scoped read capability without execution authority", () => {
  const x = filesApplicationActionManifest;
  assert.equal(x.appId, "files");
  assert.equal(x.appVersion, "0.1.0");
  assert.equal(x.execution, "proposal-only");
  assert.equal(x.authority, "none");
  assert.deepEqual(x.capabilities.map(y => y.actionId), FILES_NATIVE_ACTIONS);
  assert.equal(x.capabilities[0].executionAuthorized, false);
  assert.equal(x.capabilities[0].modelDirectExecutionAuthorized, false);
  assert.equal(x.capabilities[0].riskClass, "read-only");
  assert.equal(applicationActionProviderArtifact.execution, "unavailable");
  assert.equal(applicationActionProviderArtifact.authority, "none");
});
test("Files provider uses only injected, host-scoped File Space and validates response identity", async () => {
  const paths = [];
  const entry = { name: "nota.txt", kind: "file", size: 14, modifiedAt: 1000 };
  const provider = createFilesApplicationActionProvider(scopedPort(async path => {
    paths.push(path);
    return { path, entries: Array.from({ length: 65 }, () => entry) };
  }));
  const result = await provider.invoke(invocation("Documentos"));
  assert.equal(result.status, "succeeded");
  assert.deepEqual(paths, ["/Documentos"]);
  assert.equal(result.output.location, "/Documentos");
  assert.equal(result.output.entries.length, 64);
  assert.equal(result.output.truncated, true);
  assert.equal(Object.hasOwn(result.output.entries[0], "modifiedAt"), false);
});
test("Files provider rejects malformed, forged, or non-scoped operations", async () => {
  let called = 0;
  const p = createFilesApplicationActionProvider(scopedPort(async path => {
    called++;
    return { path: "/Other", entries: [] };
  }));
  const invalid = [
    invocation("/", { actionId: "files.delete" }),
    invocation("../private"),
    invocation("C:\\Windows"),
    invocation("https://host/"),
    invocation("/", { arguments: { path: "/tmp" } }),
  ];
  for (const request of invalid) {
    assert.equal((await p.invoke(request)).status, "failed");
  }
  assert.equal(called, 0);
  assert.equal((await p.invoke(invocation("/Documentos"))).status, "failed");
  assert.equal(called, 1);
  assert.throws(() => createFilesApplicationActionProvider(null), /file-space/i);
});
