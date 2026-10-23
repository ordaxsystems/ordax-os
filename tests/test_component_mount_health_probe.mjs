import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import {
  DEVICE_LOCAL_FILE_SPACE_SCOPE,
  FILE_SPACE_SCHEMA,
} from "../system/contracts/file-space.mjs";
import { createNativeFilesHostPorts } from "../system/composition/native/files-trusted-context.mjs";
import { createAppActivationChannel } from "../system/services/apps/activation.mjs";
import { hasNativeExternalFirstPartyModuleRead } from "../system/services/apps/external-first-party-policy.mjs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { createProjectContinuityFileSpace } from "../system/services/files/project-continuity-file-space.mjs";
import { createProjectCatalogRuntime } from "../system/services/files/projects.mjs";
import { createRecentFilesRuntime } from "../system/services/files/recent-files.mjs";
import { NATIVE_COMPONENT_PROBATION_IDS } from "../system/services/components/probation-policy.generated.mjs";
import {
  COMPONENT_MOUNT_HEALTH_PROBE_MODE,
  createRuntimeMountHealthCheck,
} from "../system/services/components/runtime-mount-health-probe.mjs";

const COMMIT = "c".repeat(40);
const RESOLUTION = Object.freeze({
  componentId: "files",
  state: "pending",
  source: "slot",
  revision: 19,
  version: "0.1.0",
  sourceCommit: COMMIT,
  entrypoint: "system/surface/ui/files-component-runtime.mjs",
  pendingHealth: "unknown",
});
const RUNTIME_URL = `http://127.0.0.1:8765/__ordax/native/component-module/files/pending/0.1.0/${COMMIT}/system/surface/ui/files-component-runtime.mjs`;

class FakeElement {
  constructor(documentObject) {
    this.nodeType = 1;
    this.ownerDocument = documentObject;
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.className = "";
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

function filesProbationContext(root) {
  const projects = createProjectCatalogRuntime();
  const recentFiles = createRecentFilesRuntime();
  const appActivation = createAppActivationChannel();
  const fileSpace = createProjectContinuityFileSpace(nativeFilePort(), projects);
  // This is a pending-health fixture: it validates host ports, but must not
  // claim a verified installed 'current' Files slot.
  const ports = createNativeFilesHostPorts({
    fileSpace, recentFiles, projects, appActivation,
  });
  return Object.freeze({ ...ports, root });
}

function runtime(mount) {
  return Object.freeze({
    schema: COMPONENT_RUNTIME_SCHEMA,
    componentId: "files",
    version: "0.1.0",
    mount,
  });
}

test("Files mount-health proves a transient dedicated-root mount with host-owned typed ports", async () => {
  const surfaceRoot = makeSurfaceRoot();
  const context = filesProbationContext(surfaceRoot);
  let mounts = 0;
  let destroys = 0;
  let appRoot = null;
  const healthCheck = createRuntimeMountHealthCheck({
    componentId: "files",
    context,
    timeoutMs: 500,
  });

  const health = await healthCheck({
    runtime: runtime(async (received) => {
      mounts += 1;
      appRoot = received.root;
      assert.notStrictEqual(appRoot, surfaceRoot);
      assert.strictEqual(appRoot.parentNode, surfaceRoot);
      assert.equal(appRoot.childNodes.length, 0);
      assert.equal(appRoot.dataset.ordaxComponentRoot, "files");
      assert.equal(appRoot.style.display, "contents");
      assert.strictEqual(received.fileSpace, context.fileSpace);
      assert.strictEqual(received.recentFiles, context.recentFiles);
      assert.strictEqual(received.projects, context.projects);
      assert.strictEqual(received.appActivation, context.appActivation);
      const child = appRoot.ownerDocument.createElement("section");
      appRoot.append(child);
      return {
        destroy() {
          destroys += 1;
          child.remove();
        },
      };
    }),
    resolution: RESOLUTION,
    runtimeUrl: RUNTIME_URL,
  });

  assert.equal(COMPONENT_MOUNT_HEALTH_PROBE_MODE, "mount-contract");
  assert.equal(health, "healthy");
  assert.equal(mounts, 1);
  assert.equal(destroys, 1);
  assert.equal(surfaceRoot.childNodes.length, 0);
  assert.equal(appRoot.removed, true);

  // Pending mount proof does not displace the bundled bootstrap owner.
  assert.equal(getFirstPartyApp("files"), null);
  assert.equal(hasNativeExternalFirstPartyModuleRead("files"), true);
  assert.equal(NATIVE_COMPONENT_PROBATION_IDS.includes("files"), true);
});

test("Files mount-health failure removes the dedicated root and propagates failure", async () => {
  const surfaceRoot = makeSurfaceRoot();
  let appRoot = null;
  const healthCheck = createRuntimeMountHealthCheck({
    componentId: "files",
    context: filesProbationContext(surfaceRoot),
    timeoutMs: 500,
  });

  await assert.rejects(
    () => healthCheck({
      runtime: runtime(async ({ root }) => {
        appRoot = root;
        root.append(root.ownerDocument.createElement("div"));
        throw new Error("files mount failed");
      }),
      resolution: RESOLUTION,
      runtimeUrl: RUNTIME_URL,
    }),
    /files mount failed/,
  );
  assert.equal(surfaceRoot.childNodes.length, 0);
  assert.equal(appRoot.removed, true);
});

test("Files mount-health timeout releases the root and destroys a late mount", async () => {
  const surfaceRoot = makeSurfaceRoot();
  let finishMount;
  let destroys = 0;
  const healthCheck = createRuntimeMountHealthCheck({
    componentId: "files",
    context: filesProbationContext(surfaceRoot),
    timeoutMs: 100,
  });
  const pending = healthCheck({
    runtime: runtime(() => new Promise((resolve) => { finishMount = resolve; })),
    resolution: RESOLUTION,
    runtimeUrl: RUNTIME_URL,
  });

  await assert.rejects(() => pending, /mount timed out/);
  assert.equal(surfaceRoot.childNodes.length, 0);
  finishMount({ destroy() { destroys += 1; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(destroys, 1);
  assert.equal(surfaceRoot.childNodes.length, 0);
});

test("Files mount-health rejects stale identity and non-canonical module URLs before mount", async () => {
  const surfaceRoot = makeSurfaceRoot();
  let mounts = 0;
  const healthCheck = createRuntimeMountHealthCheck({
    componentId: "files",
    context: filesProbationContext(surfaceRoot),
    timeoutMs: 500,
  });
  const candidate = runtime(async () => {
    mounts += 1;
    return { destroy() {} };
  });

  await assert.rejects(
    () => healthCheck({
      runtime: candidate,
      resolution: { ...RESOLUTION, pendingHealth: "healthy" },
      runtimeUrl: RUNTIME_URL,
    }),
    /exact unknown-health pending slot/,
  );
  for (const runtimeUrl of [
    RUNTIME_URL.replace("/pending/", "/current/"),
    RUNTIME_URL.replace("127.0.0.1:8765", "evil.example"),
    RUNTIME_URL.replace(`/0.1.0/${COMMIT}/`, `/0.1.0/${"d".repeat(40)}/`),
    `${RUNTIME_URL}?candidate=forged`,
  ]) {
    await assert.rejects(
      () => healthCheck({ runtime: candidate, resolution: RESOLUTION, runtimeUrl }),
      /not exact pending-slot identity/,
    );
  }
  assert.equal(mounts, 0);
  assert.equal(surfaceRoot.childNodes.length, 0);
});
