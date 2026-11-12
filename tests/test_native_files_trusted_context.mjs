import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  DEVICE_LOCAL_FILE_SPACE_SCOPE,
  FILE_SPACE_SCHEMA,
} from "../system/contracts/file-space.mjs";
import { validateComponentRuntimeMetadata } from "../system/contracts/component-runtime-metadata.mjs";
import { createRecentFilesRuntime } from "../system/services/files/recent-files.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";
import { createAppActivationChannel } from "../system/services/apps/activation.mjs";
import { createProjectContinuityFileSpace } from "../system/services/files/project-continuity-file-space.mjs";
import { createNativeWorkspaceHostPorts, installNativeWorkspaceVerifiedContext } from "../system/composition/native/component-workspace-ports.mjs";
function createWorkspaceVerifiedProviderForTest(options={}) {
  let provided = null;
  const installed = options.verifiedCurrent ? [{ component:{id:"files"}, metadata:options.verifiedCurrent }] : [];
  installNativeWorkspaceVerifiedContext({ ...options, installed, installProvider(provider) { provided=provider; } });
  return provided;
}
import { hasNativeExternalFirstPartyModuleRead } from "../system/services/apps/external-first-party-policy.mjs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";

const verifiedFilesCurrent = Object.freeze({
  componentId: "files", state: "current", source: "slot", revision: 7,
  version: "0.3.0", sourceCommit: "a".repeat(40),
  entrypoint: "system/apps/files/src/runtime.mjs", pendingHealth: null,
});

function nativeFilePort() {
  const listing = path => ({ path, entries: [] });
  return Object.freeze({
    schema: FILE_SPACE_SCHEMA,
    scope: DEVICE_LOCAL_FILE_SPACE_SCOPE,
    async list(path) { return listing(path); },
    async createDirectory(path) { return listing(path); },
    async readTextFile(path) { return { path, size: 0, text: "" }; },
    async readImagePreview(path) { return { path, size: 0, mime: "image/png", bytes: new Uint8Array() }; },
    async readMediaPreview(path) { return { path, size: 0, mime: "audio/wav", bytes: new Uint8Array() }; },
    async readDocumentPreview(path) { return { path, size: 0, mime: "application/pdf", bytes: new Uint8Array() }; },
    async renameEntry(path) { return listing(path); },
    async copyFile(_src, _name, path) { return listing(path); },
    async moveEntry(_src, _name, path) { return listing(path); },
    async trashEntry(path) { return listing(path); },
    async listTrash() { return { entries: [] }; },
    async restoreTrashEntry() { return { entries: [] }; },
    async exportFile() { return true; },
    async importFile(path) { return listing(path); },
  });
}

test("Files trusted context binds only the existing typed host ports with project continuity", async () => {
  const projects = createProjectCatalogRuntime();
  const recentFiles = createRecentFilesRuntime();
  const appActivation = createAppActivationChannel();
  const fileSpace = createProjectContinuityFileSpace(nativeFilePort(), projects);
  const provider = createWorkspaceVerifiedProviderForTest({
    fileSpace, recentFiles, projects, appActivation,
    verifiedCurrent: verifiedFilesCurrent,
  });
  const context = provider("files");
  assert.equal(Object.isFrozen(context), true);
  assert.deepEqual(Object.keys(context).sort(), ["appActivation", "fileSpace", "projects", "recentFiles"]);
  assert.strictEqual(context.fileSpace, fileSpace);
  assert.strictEqual(context.recentFiles, recentFiles);
  assert.strictEqual(context.projects, projects);
  assert.strictEqual(context.appActivation, appActivation);
  assert.deepEqual(await context.fileSpace.list("/Documentos"), { path: "/Documentos", entries: [] });
  for (const other of ["activity", "notes", "studio", "settings", "assistant", "__proto__", "files-other"]) {
    assert.equal(provider(other), null, other);
  }
  assert.equal(provider(null), null);
  assert.equal(provider({ toString() { throw new Error("unexpected coercion"); } }), null);
});

test("Files trusted context fails closed for absent, malformed and mismatched host ports", () => {
  assert.throws(() => createWorkspaceVerifiedProviderForTest()("files"), /verified current Native slot/);
  const projects = createProjectCatalogRuntime();
  const recentFiles = createRecentFilesRuntime();
  const activation = createAppActivationChannel();
  const ports = {
    fileSpace: createProjectContinuityFileSpace(nativeFilePort(), projects),
    recentFiles, projects, appActivation: activation,
    verifiedCurrent: verifiedFilesCurrent,
  };
  assert.throws(
    () => createWorkspaceVerifiedProviderForTest({ ...ports, fileSpace: { schema: FILE_SPACE_SCHEMA } })("files"),
    /must implement/,
  );
  assert.throws(
    () => createWorkspaceVerifiedProviderForTest({ ...ports, recentFiles: {} })("files"),
    /compatible recent-files/,
  );
  assert.throws(
    () => createWorkspaceVerifiedProviderForTest({ ...ports, projects: null })("files"),
    /compatible project-catalog/,
  );
  assert.throws(
    () => createWorkspaceVerifiedProviderForTest({ ...ports, appActivation: null })("files"),
    /compatible app-activation/,
  );
  assert.equal(createWorkspaceVerifiedProviderForTest({ fileSpace: {} })("notes"), null);
});

test("Files host ports require exact verified current slot, not appId or bundled source", () => {
  const projects = createProjectCatalogRuntime();
  const ports = {
    fileSpace: createProjectContinuityFileSpace(nativeFilePort(), projects),
    recentFiles: createRecentFilesRuntime(),
    projects,
    appActivation: createAppActivationChannel(),
  };
  assert.equal(validateComponentRuntimeMetadata(verifiedFilesCurrent, {
    componentId: "files", state: "current",
  }).source, "slot");
  assert.throws(
    () => createWorkspaceVerifiedProviderForTest(ports)("files"),
    /verified current Native slot/,
  );
  for (const invalid of [
    { ...verifiedFilesCurrent, componentId: "notes" },
    { ...verifiedFilesCurrent, state: "pending", pendingHealth: "unknown" },
    { ...verifiedFilesCurrent, source: "bundled", version: null, sourceCommit: null, entrypoint: null },
    { ...verifiedFilesCurrent, source: "absent", version: null, sourceCommit: null, entrypoint: null },
    { ...verifiedFilesCurrent, revision: -1 },
    { ...verifiedFilesCurrent, sourceCommit: "not-a-commit" },
    { ...verifiedFilesCurrent, entrypoint: "../../private.mjs" },
  ]) {
    assert.throws(
      () => createWorkspaceVerifiedProviderForTest({
        ...ports, verifiedCurrent: invalid,
      })("files"),
      /identity mismatch|state mismatch|installed current slot|invalid|component|version|commit|entrypoint/i,
    );
  }
  // Invalid credentials do not affect other app IDs or expose any File Space.
  const provider = createWorkspaceVerifiedProviderForTest({
    fileSpace: {}, verifiedCurrent: { get source() { throw Error("untrusted getter"); } },
  });
  assert.equal(provider("notes"), null);
});

test("Files host binding requires exact verified slot after bundled source removal", async () => {
  assert.equal(getFirstPartyApp("files"), null);
  assert.equal(hasNativeExternalFirstPartyModuleRead("files"), true);
  const composition = await readFile(
    new URL("../system/composition/native/main.mjs", import.meta.url), "utf8",
  );
  assert.doesNotMatch(composition, /createNativeFilesTrustedContextProvider/);
  assert.match(composition, /createNativeWorkspacePendingBootstrap/);
  assert.match(composition, /installNativeWorkspaceVerifiedContext/);
  assert.match(composition, /fileSpace: filesOwnerSpace/);
  assert.match(composition, /installed: installedAppCatalog\?\.installed \?\? \[\]/);
  assert.match(composition, /installed: installedAppCatalog\?\.installed \?\? \[\]/);
});
