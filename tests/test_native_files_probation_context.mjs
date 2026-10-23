import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEVICE_LOCAL_FILE_SPACE_SCOPE,
  FILE_SPACE_SCHEMA,
} from "../system/contracts/file-space.mjs";
import { createAppActivationChannel } from "../system/services/apps/activation.mjs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { hasNativeExternalFirstPartyModuleRead } from "../system/services/apps/external-first-party-policy.mjs";
import { createProjectContinuityFileSpace } from "../system/services/files/project-continuity-file-space.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";
import { createRecentFilesRuntime } from "../system/services/files/recent-files.mjs";
import { NATIVE_COMPONENT_PROBATION_IDS } from "../system/services/components/probation-policy.generated.mjs";
import {
  NATIVE_COMPONENT_PENDING_HOST_SCHEMA,
} from "../system/composition/native/component-pending-host.mjs";
import { createNativeWorkspacePendingBootstrap, createNativeWorkspaceHostPorts, installNativeWorkspaceVerifiedContext } from "../system/composition/native/component-workspace-ports.mjs";

class FakeElement {
  constructor(documentObject) {
    this.nodeType = 1;
    this.ownerDocument = documentObject;
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.hidden = false;
    this.removed = false;
  }
  append(...children) {
    for (const child of children) {
      child.parentNode?.remove();
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.childNodes = this.parentNode.childNodes.filter((child) => child !== this);
      this.parentNode = null;
    }
    this.removed = true;
  }
}

function makeSurfaceRoot() {
  const documentObject = {
    createElement() { return new FakeElement(documentObject); },
  };
  return new FakeElement(documentObject);
}

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

function ports() {
  const projects = createProjectCatalogRuntime();
  const recentFiles = createRecentFilesRuntime();
  const appActivation = createAppActivationChannel();
  const fileSpace = createProjectContinuityFileSpace(nativeFilePort(), projects);
  return { fileSpace, recentFiles, projects, appActivation };
}

test("Files probation provider installs before bind and creates host only for an actual Files probe", async () => {
  const root = makeSurfaceRoot();
  let provider = null;
  const bootstrap = createNativeWorkspacePendingBootstrap({
    installProvider(candidate) { provider = candidate; },
  });

  assert.equal(bootstrap.schema, NATIVE_COMPONENT_PENDING_HOST_SCHEMA);
  assert.equal(typeof provider, "function");
  assert.equal(root.childNodes.length, 0);
  assert.equal(await provider("notes"), null);

  let settled = false;
  const pending = provider("files").then((value) => {
    settled = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(root.childNodes.length, 0);

  const expected = ports();
  bootstrap.bind({ root, ports: expected });
  const context = await pending;
  assert.equal(settled, true);
  assert.strictEqual(context.fileSpace, expected.fileSpace);
  assert.strictEqual(context.recentFiles, expected.recentFiles);
  assert.strictEqual(context.projects, expected.projects);
  assert.strictEqual(context.appActivation, expected.appActivation);
  assert.equal(root.childNodes.length, 1);
  assert.strictEqual(context.root, root.childNodes[0]);
  assert.equal(context.root.hidden, true);
  assert.equal(context.root.style.display, "none");
  assert.equal(context.root.dataset.ordaxComponentProbationHost, "files");
  assert.equal(Object.isFrozen(context), true);

  bootstrap.destroy();
  assert.equal(root.childNodes.length, 0);
  assert.equal(context.root.removed, true);

  assert.equal(getFirstPartyApp("files"), null);
  assert.equal(hasNativeExternalFirstPartyModuleRead("files"), true);
  assert.equal(NATIVE_COMPONENT_PROBATION_IDS.includes("files"), true);
});

test("Files probation bind failure rejects waiting probes without creating a host", async () => {
  const root = makeSurfaceRoot();
  let provider = null;
  const bootstrap = createNativeWorkspacePendingBootstrap({
    installProvider(candidate) { provider = candidate; },
  });
  const pending = provider("files");

  assert.throws(
    () => bootstrap.bind({ root, ports: { ...ports(), fileSpace: null } }),
    /file-space/i,
  );
  await assert.rejects(() => pending, /file-space/i);
  assert.equal(root.childNodes.length, 0);
  bootstrap.destroy();
});

test("Files pending context cannot bypass the verified-current host-port gate", async () => {
  const root = makeSurfaceRoot();
  const p = ports();
  let current;
  installNativeWorkspaceVerifiedContext({ ...p, installProvider(provider) { current = provider; } });
  assert.throws(() => current("files"), /verified current Native slot/);
  let installedProvider;
  const bootstrap = createNativeWorkspacePendingBootstrap({
    installProvider(provider) { installedProvider = provider; },
  });
  assert.equal(await installedProvider("notes"), null);
  bootstrap.bind({ root, ports: p });
  const pending = await installedProvider("files");
  assert.strictEqual(pending.fileSpace, p.fileSpace);
  assert.strictEqual(pending.projects, p.projects);
  bootstrap.destroy();
  await assert.rejects(() => installedProvider("files"), /destroyed/);
  assert.throws(() => current("files"), /verified current Native slot/);
});

test("Files probation bind is DOM-neutral without a probe and refuses duplicate binding", () => {
  const root = makeSurfaceRoot();
  let provider = null;
  const bootstrap = createNativeWorkspacePendingBootstrap({
    installProvider(candidate) { provider = candidate; },
  });
  assert.equal(typeof provider, "function");
  bootstrap.bind({ root, ports: ports() });
  assert.equal(root.childNodes.length, 0);
  assert.throws(
    () => bootstrap.bind({ root, ...ports() }),
    /can only be bound once/,
  );
  assert.equal(root.childNodes.length, 0);
  bootstrap.destroy();
  bootstrap.destroy();
  assert.equal(root.childNodes.length, 0);
});

test("Native Files probation wiring installs before async boot and binds only after Surface mount", () => {
  const source = readFileSync(
    new URL("../system/composition/native/main.mjs", import.meta.url),
    "utf8",
  );
  const startIndex = source.indexOf("async function start() {");
  const installIndex = source.indexOf(
    "workspaceComponentBootstrap = createNativeWorkspacePendingBootstrap();",
    startIndex,
  );
  const firstAwaitIndex = source.indexOf("await ", startIndex);
  const surfaceIndex = source.indexOf("const surface = mountSurface(", startIndex);
  const bindIndex = source.indexOf("workspaceComponentBootstrap?.bind({", surfaceIndex);
  const currentGateIndex = source.indexOf(
    'installNativeWorkspaceVerifiedContext({',
    bindIndex,
  );
  const teardownIndex = source.indexOf("workspaceComponentBootstrap?.destroy();", bindIndex);

  assert.ok(startIndex >= 0);
  assert.ok(installIndex > startIndex);
  assert.ok(firstAwaitIndex > installIndex, "probation provider must install before async boot can yield");
  assert.ok(surfaceIndex > firstAwaitIndex);
  assert.ok(bindIndex > surfaceIndex, "probation ports must bind after mountSurface establishes the final root");
  assert.ok(currentGateIndex > bindIndex, "current-runtime trust gate must remain separate from probation");
  assert.ok(teardownIndex > currentGateIndex);
  assert.match(source.slice(bindIndex, currentGateIndex), /fileSpace: filesOwnerSpace/);
  assert.match(source.slice(bindIndex, currentGateIndex), /recentFiles/);
  assert.match(source.slice(bindIndex, currentGateIndex), /projects/);
  assert.match(source.slice(bindIndex, currentGateIndex), /appActivation/);
  assert.equal(NATIVE_COMPONENT_PROBATION_IDS.includes("files"), true);
  assert.equal(hasNativeExternalFirstPartyModuleRead("files"), true);
});
