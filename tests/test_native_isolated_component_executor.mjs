import assert from "node:assert/strict";
import test from "node:test";

import {
  createNativeIsolatedPendingComponentModuleImporter,
  createNativeIsolatedComponentModuleImporter,
  NATIVE_ISOLATED_COMPONENT_PROBE_SCHEMA,
  NATIVE_ISOLATED_COMPONENT_EXECUTOR_SCHEMA,
} from "../system/adapters/native/isolated-component-executor.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";
import { DEVICE_LOCAL_FILE_SPACE_SCOPE, FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { createAppActivationChannel } from "../system/services/apps/activation.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { RECENT_FILES_SCHEMA } from "../system/contracts/recent-files.mjs";
import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import { SURFACE_RENDER_LIFECYCLE_SCHEMA } from "../system/contracts/surface-render-lifecycle.mjs";
import { runNativePendingComponentProbation } from "../system/composition/native/component-probation.mjs";

const ORIGIN = "http://127.0.0.1:43121";
const BRIDGE = "ordax.native.isolated-component-bridge/1";
const PROBE = "ordax.native.isolated-component-probe/1";
const MODULE = `${ORIGIN}/__ordax/native/component-module/notes/current/0.4.2/`
  + `${"a".repeat(40)}/src/runtime.mjs`;
const IDENTITY = Object.freeze({ appId: "notes", publisherId: "ordaxsystems", ownerScope: "device" });
const CURRENT_SLOT = Object.freeze({
  componentId: "notes",
  state: "current",
  source: "slot",
  revision: 17,
  version: "0.4.2",
  sourceCommit: "a".repeat(40),
  entrypoint: "src/runtime.mjs",
  pendingHealth: null,
});
const PENDING_SLOT = Object.freeze({
  ...CURRENT_SLOT,
  state: "pending",
  revision: 19,
  pendingHealth: "unknown",
});
const PENDING_MODULE = MODULE.replace("/current/", "/pending/");

class FakePort {
  constructor() { this.listeners = new Set(); this.peer = null; this.closed = false; }
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  start() {}
  postMessage(data) {
    if (this.closed || this.peer?.closed) return;
    queueMicrotask(() => {
      for (const listener of [...this.peer.listeners]) listener({ data });
    });
  }
  close() { this.closed = true; }
}

class FakeMessageChannel {
  constructor() {
    this.port1 = new FakePort();
    this.port2 = new FakePort();
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

class FakeElement {
  constructor(documentObject, tagName = "div") {
    this.ownerDocument = documentObject;
    this.tagName = tagName;
    this.nodeType = 1;
    this.parentNode = null;
    this.childNodes = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.removed = false;
    this.srcdoc = "";
    this.contentWindow = {
      stop() {},
      postMessage: (_data, _target, ports) => {
        if (_data?.schema === PROBE) {
          this.receivedProbe = _data;
          this.childPort = ports?.[0] ?? null;
          queueMicrotask(() => this.childPort?.postMessage({
            schema: PROBE, type: "validated",
            componentId: _data.componentId, version: _data.version,
          }));
          return;
        }
        this.receivedBootstrap = _data;
        this.childPort = ports?.[0] ?? null;
        this.childPort?.addEventListener("message", (event) => {
          if (event.data?.type === "shutdown") this.childPort.postMessage({
            schema: BRIDGE, type: "destroyed",
          });
        });
        queueMicrotask(() => this.childPort?.postMessage({
          schema: BRIDGE, type: "mounted", componentId: _data.componentId, version: _data.version,
        }));
      },
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  fire(type) { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
  append(child) {
    child.parentNode?.remove();
    child.parentNode = this;
    this.childNodes.push(child);
    if (child.tagName === "iframe") queueMicrotask(() => child.fire("load"));
  }
  remove() {
    this.parentNode?.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
    this.removed = true;
  }
}

function setup({ timeoutMs = 500, componentId = "notes", version = "0.4.2" } = {}) {
  let currentSlot = Object.freeze({ ...CURRENT_SLOT, componentId, version });
  const createdElements = [];
  const documentObject = {
    createElement(tag) {
      const element = new FakeElement(documentObject, tag);
      createdElements.push(element);
      return element;
    },
  };
  documentObject.documentElement = documentObject.createElement("html");
  const root = new FakeElement(documentObject);
  const subscribers = new Set();
  const localeSubscribers = new Set();
  const localization = Object.freeze({
    schema: "ordax.localization/2",
    getLocale: () => "pt-BR",
    getProfile: () => createLocaleProfile("pt-BR"),
    translate: (id) => id,
    subscribe(listener) { localeSubscribers.add(listener); return () => localeSubscribers.delete(listener); },
  });
  const lifecycle = Object.freeze({
    schema: SURFACE_RENDER_LIFECYCLE_SCHEMA,
    localization,
    getAppTarget: () => "draft",
    setAppTarget(appId, target) { assert.equal(appId, componentId); return target; },
    subscribeRender(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
  });
  const calls = [];
  let holdGet = false;
  let getStarted = null;
  let releaseGet = null;
  const appData = Object.freeze({
    schema: APP_DATA_SCHEMA, identity: Object.freeze({ ...IDENTITY, appId: componentId }),
    async get(identity, key) {
      calls.push({ operation: "get", identity, key });
      getStarted?.();
      if (holdGet) await new Promise((resolve) => { releaseGet = resolve; });
      return { revision: 3, found: true, key, value: new Uint8Array([1, 2]) };
    },
    async list(identity) { calls.push({ operation: "list", identity }); return { revision: 3, keys: [] }; },
    async put(identity, command) { calls.push({ operation: "put", identity, command }); return { revision: 4, stored: true }; },
    async delete(identity, command) { calls.push({ operation: "delete", identity, command }); return { revision: 4, deleted: true }; },
  });
  const windowRef = {
    location: { origin: ORIGIN, href: `${ORIGIN}/` },
    document: documentObject,
    crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } },
    MessageChannel: FakeMessageChannel,
    setTimeout, clearTimeout,
  };
  let currentSlotFailure = null;
  let currentSlotHanging = false;
  let abortedCurrentSlotSignal = null;
  let currentSlotReads = 0;
  const currentSlotSource = createNativeComponentSlotSource(windowRef);
  const importer = createNativeIsolatedComponentModuleImporter({
    windowRef,
    allowedComponentIds: [componentId],
    currentSlotSource,
    currentSlotTimeoutMs: timeoutMs,
    async fetchImpl(url, options) {
      currentSlotReads += 1;
      assert.equal(url, currentSlotSource.metadataUrl(componentId, "current"));
      assert.equal(options.method, "GET");
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.redirect, "error");
      assert.equal(typeof options.signal?.addEventListener, "function");
      if (currentSlotFailure) throw currentSlotFailure;
      if (currentSlotHanging) {
        abortedCurrentSlotSignal = options.signal;
        return new Promise((resolve, reject) => {
          if (options.signal.aborted) reject(new Error("aborted"));
          else options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return { ok: true, json: async () => currentSlot };
    },
    timeoutMs: 500,
  });
  return {
    importer, windowRef, documentObject, createdElements, root, lifecycle, appData, calls, subscribers, localeSubscribers,
    get currentSlot() { return currentSlot; },
    get currentSlotReads() { return currentSlotReads; },
    setCurrentSlot(value) { currentSlot = value; },
    failCurrentSlot(error = new Error("Native host unavailable")) { currentSlotFailure = error; },
    hangCurrentSlot() { currentSlotHanging = true; },
    get abortedCurrentSlotSignal() { return abortedCurrentSlotSignal; },
    holdGet() {
      holdGet = true;
      return new Promise((resolve) => { getStarted = resolve; });
    },
    releaseGet() { holdGet = false; releaseGet?.(); releaseGet = null; },
  };
}

function mountedMessage(frame) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fake child request timed out")), 500);
    frame.childPort.addEventListener("message", (event) => {
      if (event.data?.type === "reply") {
        clearTimeout(timer);
        resolve(event.data);
      }
    });
  });
}

test("Native external module execution is represented by an opaque-origin iframe", async () => {
  const env = setup();
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  assert.equal(imported.componentRuntime.componentId, "notes");
  assert.equal(imported.componentRuntime.version, "0.4.2");
  assert.equal(NATIVE_ISOLATED_COMPONENT_EXECUTOR_SCHEMA, "ordax.native-isolated-component-executor/1");
  const mounted = await imported.componentRuntime.mount({
    root: env.root,
    surfaceLifecycle: env.lifecycle,
    appData: env.appData,
  });
  const [frame] = env.root.childNodes;
  assert.equal(frame.attributes.get("sandbox"), "allow-scripts");
  assert.equal(frame.attributes.has("sandbox") && frame.attributes.get("sandbox").includes("allow-same-origin"), false);
  assert.match(frame.srcdoc, /default-src 'none'/);
  assert.match(frame.srcdoc, /connect-src 'none'/);
  assert.match(frame.srcdoc, /component-module\/notes\/current\/0\.4\.2\//);
  assert.match(frame.srcdoc, /component-module\/notes\/current\/0\.4\.2/);
  assert.match(frame.receivedBootstrap.moduleUrl, /component-module\/notes\/current\/0\.4\.2/);
  assert.equal(frame.receivedBootstrap.type, "initialize");
  assert.equal(frame.receivedBootstrap.appDataIdentity.appId, "notes");
  assert.equal(frame.receivedBootstrap.appTarget, "draft");
  await mounted.destroy();
  assert.equal(env.root.childNodes.length, 0);
});

test("the non-Files host broker binds App Data and exposes no File Space", async () => {
  const env = setup();
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  const mounted = await imported.componentRuntime.mount({ root: env.root, surfaceLifecycle: env.lifecycle, appData: env.appData });
  const frame = env.root.childNodes[0];
  const reply = mountedMessage(frame);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 1, operation: "appData.get", args: ["notes.key"] });
  const result = await reply;
  assert.equal(result.ok, true);
  assert.equal(result.value.found, true);
  assert.equal(env.currentSlotReads, 1);
  assert.deepEqual(env.calls[0], { operation: "get", identity: IDENTITY, key: "notes.key" });
  await mounted.destroy();
});

test("every host operation revalidates the exact slot revision and revokes a stale frame", async () => {
  const env = setup();
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  const mounted = await imported.componentRuntime.mount({ root: env.root, surfaceLifecycle: env.lifecycle, appData: env.appData });
  const frame = env.root.childNodes[0];

  const firstReply = mountedMessage(frame);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 1, operation: "appData.get", args: ["notes.key"] });
  assert.equal((await firstReply).ok, true);
  assert.equal(env.calls.length, 1);

  env.setCurrentSlot({ ...CURRENT_SLOT, revision: CURRENT_SLOT.revision + 1 });
  const reply = mountedMessage(frame);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 2, operation: "appData.put", args: [{ key: "notes.next", value: new Uint8Array([2]), expectedRevision: 3 }] });
  const result = await reply;
  assert.equal(result.ok, false);
  assert.match(result.error, /authority has been revoked|no longer current/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(env.currentSlotReads, 2);
  assert.equal(env.calls.length, 1);
  assert.equal(env.root.childNodes.length, 0);
  await mounted.destroy();
});

test("Native host unavailability fails closed before an external app operation", async () => {
  const env = setup();
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  const mounted = await imported.componentRuntime.mount({ root: env.root, surfaceLifecycle: env.lifecycle, appData: env.appData });
  const frame = env.root.childNodes[0];
  env.failCurrentSlot();
  const reply = mountedMessage(frame);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 1, operation: "appData.put", args: [{ key: "notes.key", value: new Uint8Array([1]), expectedRevision: 0 }] });
  const result = await reply;
  assert.equal(result.ok, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(env.calls.length, 0);
  assert.equal(env.root.childNodes.length, 0);
  await mounted.destroy();
});

test("a hung Native verifier is aborted, revokes the app, and lets teardown drain", async () => {
  const env = setup({ timeoutMs: 100 });
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  const mounted = await imported.componentRuntime.mount({ root: env.root, surfaceLifecycle: env.lifecycle, appData: env.appData });
  const frame = env.root.childNodes[0];
  env.hangCurrentSlot();

  const reply = mountedMessage(frame);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 1, operation: "appData.put", args: [{ key: "notes.key", value: new Uint8Array([1]), expectedRevision: 0 }] });
  const result = await reply;
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out|revoked/i);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(env.abortedCurrentSlotSignal?.aborted, true);
  assert.equal(env.calls.length, 0);
  assert.equal(env.root.childNodes.length, 0);
  await mounted.destroy();
});

test("revocation blocks new bridge calls and awaits in-flight App Data operations", async () => {
  const env = setup();
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  const mounted = await imported.componentRuntime.mount({ root: env.root, surfaceLifecycle: env.lifecycle, appData: env.appData });
  const frame = env.root.childNodes[0];
  const started = env.holdGet();
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 1, operation: "appData.get", args: ["notes.key"] });
  await started;
  let destroyed = false;
  const destroying = mounted.destroy().then(() => { destroyed = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(destroyed, false);
  assert.equal(env.root.childNodes.length, 1);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 2, operation: "appData.delete", args: [{ key: "notes.key", expectedRevision: 3 }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(env.calls.length, 1);
  env.releaseGet();
  await destroying;
  assert.equal(env.root.childNodes.length, 0);
  assert.equal(env.calls.length, 1);
});

test("module identity is exact and non-Files slots cannot receive device-local File Space", async () => {
  const env = setup();
  await assert.rejects(() => env.importer(MODULE.replace("notes/current", "studio/current"), CURRENT_SLOT), /slot namespace/);
  await assert.rejects(() => env.importer(MODULE.replace("current", "pending"), CURRENT_SLOT), /slot namespace/);
  const imported = await env.importer(MODULE, CURRENT_SLOT);
  await assert.rejects(() => imported.componentRuntime.mount({
    root: env.root,
    surfaceLifecycle: env.lifecycle,
    appData: env.appData,
    fileSpace: { list() {} },
  }), /available only to the verified Files slot/);
  assert.equal(env.root.childNodes.length, 0);
});

function deviceLocalFileSpace(calls = []) {
  const listing = (path) => ({ path, entries: [] });
  return Object.freeze({
    schema: FILE_SPACE_SCHEMA,
    scope: DEVICE_LOCAL_FILE_SPACE_SCOPE,
    async list(path) { calls.push(["list", path]); return listing(path); },
    async createDirectory(path, name) { calls.push(["createDirectory", path, name]); return listing(path); },
    async readTextFile(path) { return { path, size: 0, text: "" }; },
    async readImagePreview(path) { return { path, size: 0, mime: "image/png", bytes: new Uint8Array() }; },
    async readMediaPreview(path) { return { path, size: 0, mime: "audio/wav", bytes: new Uint8Array() }; },
    async readDocumentPreview(path) { return { path, size: 0, mime: "application/pdf", bytes: new Uint8Array() }; },
    async copyFile(_sourcePath, _name, destinationPath) { return listing(destinationPath); },
    async renameEntry(path) { return listing(path); },
    async moveEntry(_sourcePath, _name, destinationPath) { return listing(destinationPath); },
    async trashEntry(path) { return listing(path); },
    async listTrash() { return { entries: [] }; },
    async restoreTrashEntry() { return { entries: [] }; },
    async exportFile() {},
    async importFile(path) { return listing(path); },
  });
}

function filesHostPorts() {
  let recentSnapshot = { persistence: "device", entries: [] };
  let projectSnapshot = { persistence: "device", projects: [] };
  let projectOrdinal = 0;
  const recentListeners = new Set();
  const projectListeners = new Set();
  const updateRecent = (entries) => {
    recentSnapshot = { persistence: "device", entries };
    for (const listener of [...recentListeners]) listener(recentSnapshot);
    return recentSnapshot;
  };
  const updateProjects = (projects) => {
    projectSnapshot = { persistence: "device", projects };
    for (const listener of [...projectListeners]) listener(projectSnapshot);
    return projectSnapshot;
  };
  const recentFiles = Object.freeze({
    schema: RECENT_FILES_SCHEMA,
    getSnapshot: () => recentSnapshot,
    subscribe(listener) { recentListeners.add(listener); return () => recentListeners.delete(listener); },
    recordOpened(path) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      return updateRecent([{ path, name, openedAt: 10 }, ...recentSnapshot.entries.filter((entry) => entry.path !== path)]);
    },
    remove(path) { return updateRecent(recentSnapshot.entries.filter((entry) => entry.path !== path)); },
    clear() { return updateRecent([]); },
    relocate(from, to) {
      return updateRecent(recentSnapshot.entries.map((entry) => entry.path === from
        ? { path: to, name: to.slice(to.lastIndexOf("/") + 1), openedAt: entry.openedAt }
        : entry));
    },
  });
  const projects = Object.freeze({
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot: () => projectSnapshot,
    subscribe(listener) { projectListeners.add(listener); return () => projectListeners.delete(listener); },
    create({ name, path }) {
      const timestamp = 10;
      return updateProjects([{ id: `project-${++projectOrdinal}`, name, path,
        createdAt: timestamp, lastOpenedAt: timestamp, lastFilePath: null }, ...projectSnapshot.projects]);
    },
    rename() { return projectSnapshot; },
    recordOpened() { return projectSnapshot; },
    recordFileOpened() { return projectSnapshot; },
    clearLastFile() { return projectSnapshot; },
    relocateLastFilePath() { return projectSnapshot; },
    remove() { return projectSnapshot; },
  });
  return {
    context: { recentFiles, projects, appActivation: createAppActivationChannel() },
    emitProjectUpdate: updateProjects,
    recentSnapshot: () => recentSnapshot,
    projectSnapshot: () => projectSnapshot,
    projectListenerCount: () => projectListeners.size,
  };
}

function fileModuleUrl(version = "0.3.0") {
  return `${ORIGIN}/__ordax/native/component-module/files/current/${version}/`
    + `${"a".repeat(40)}/src/runtime.mjs`;
}

test("the verified Files slot receives the fixed device-local File Space broker", async () => {
  const env = setup({ componentId: "files", version: "0.3.0" });
  const imported = await env.importer(fileModuleUrl(), env.currentSlot);
  const calls = [];
  const hostPorts = filesHostPorts();
  const mounted = await imported.componentRuntime.mount({
    root: env.root,
    surfaceLifecycle: env.lifecycle,
    appData: env.appData,
    fileSpace: deviceLocalFileSpace(calls),
    ...hostPorts.context,
  });
  const frame = env.root.childNodes[0];
  assert.deepEqual(frame.receivedBootstrap.fileSpaceScope, DEVICE_LOCAL_FILE_SPACE_SCOPE);
  assert.deepEqual(frame.receivedBootstrap.recentFilesSnapshot, { persistence: "device", entries: [] });
  assert.deepEqual(frame.receivedBootstrap.projectCatalogSnapshot, { persistence: "device", projects: [] });
  const reply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 1, operation: "fileSpace.list", args: ["/Downloads"],
  });
  assert.deepEqual((await reply).value, { path: "/Downloads", entries: [] });
  assert.deepEqual(calls, [["list", "/Downloads"]]);

  const recentReply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 2, operation: "recentFiles.recordOpened", args: ["/Downloads/relatorio.txt"],
  });
  assert.deepEqual((await recentReply).value, {
    persistence: "device", entries: [{ path: "/Downloads/relatorio.txt", name: "relatorio.txt", openedAt: 10 }],
  });
  const projectReply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 3, operation: "projects.create", args: [{ name: "Projeto local", path: "/Documentos/Projeto" }],
  });
  assert.deepEqual((await projectReply).value.projects[0], {
    id: "project-1", name: "Projeto local", path: "/Documentos/Projeto",
    createdAt: 10, lastOpenedAt: 10, lastFilePath: null,
  });
  const activationReply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 4, operation: "appActivation.publish", args: [{ appId: "files", target: "/Downloads" }],
  });
  assert.deepEqual((await activationReply).value, { appId: "files", target: "/Downloads" });
  await mounted.destroy();
  assert.equal(env.root.childNodes.length, 0);
});

test("Files requires the exact local scope and cannot select an account Space", async () => {
  const env = setup({ componentId: "files", version: "0.3.0" });
  const imported = await env.importer(fileModuleUrl(), env.currentSlot);
  await assert.rejects(() => imported.componentRuntime.mount({
    root: env.root, surfaceLifecycle: env.lifecycle, appData: env.appData,
  }), /requires its complete device-local host context/);
  await assert.rejects(() => imported.componentRuntime.mount({
    root: env.root,
    surfaceLifecycle: env.lifecycle,
    appData: env.appData,
    fileSpace: Object.freeze({
      ...deviceLocalFileSpace(),
      scope: Object.freeze({ schema: "ordax.file-space-scope/1", kind: "account-space" }),
    }),
    ...filesHostPorts().context,
  }), /fixed device-local file-space scope/);
  assert.equal(env.root.childNodes.length, 0);
});

test("Files validates paths and rechecks exact slot identity before every operation", async () => {
  const env = setup({ componentId: "files", version: "0.3.0" });
  const imported = await env.importer(fileModuleUrl(), env.currentSlot);
  const calls = [];
  const hostPorts = filesHostPorts();
  const mounted = await imported.componentRuntime.mount({
    root: env.root,
    surfaceLifecycle: env.lifecycle,
    appData: env.appData,
    fileSpace: deviceLocalFileSpace(calls),
    ...hostPorts.context,
  });
  const frame = env.root.childNodes[0];

  const badPathReply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 1, operation: "fileSpace.list", args: ["/../other-account"],
  });
  assert.equal((await badPathReply).ok, false);
  assert.deepEqual(calls, []);

  const firstReply = mountedMessage(frame);
  frame.childPort.postMessage({ schema: BRIDGE, type: "call", id: 2, operation: "fileSpace.list", args: ["/"] });
  assert.equal((await firstReply).ok, true);
  env.setCurrentSlot({ ...env.currentSlot, revision: env.currentSlot.revision + 1 });
  const staleReply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 3, operation: "fileSpace.createDirectory", args: ["/", "Privado"],
  });
  assert.equal((await staleReply).ok, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, [["list", "/"]]);
  assert.equal(env.root.childNodes.length, 0);
  await mounted.destroy();
});

test("Files state subscriptions deliver only slot-authorized updates and drain on revocation", async () => {
  const env = setup({ componentId: "files", version: "0.3.0" });
  const imported = await env.importer(fileModuleUrl(), env.currentSlot);
  const hostPorts = filesHostPorts();
  const mounted = await imported.componentRuntime.mount({
    root: env.root,
    surfaceLifecycle: env.lifecycle,
    appData: env.appData,
    fileSpace: deviceLocalFileSpace(),
    ...hostPorts.context,
  });
  const frame = env.root.childNodes[0];
  const reply = mountedMessage(frame);
  frame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 1, operation: "projects.subscribe", args: [1],
  });
  assert.equal((await reply).value, true);
  assert.equal(hostPorts.projectListenerCount(), 1);

  const update = new Promise((resolve) => {
    frame.childPort.addEventListener("message", (event) => {
      if (event.data?.type === "service.update" && event.data.service === "projects") resolve(event.data);
    });
  });
  const project = {
    id: "project-1", name: "Local", path: "/Documentos/Local",
    createdAt: 10, lastOpenedAt: 10, lastFilePath: null,
  };
  hostPorts.emitProjectUpdate([project]);
  const notification = await update;
  assert.equal(notification.subscriptionId, 1);
  assert.deepEqual(notification.value.projects, [project]);
  await mounted.destroy();
  assert.equal(hostPorts.projectListenerCount(), 0);

  const staleEnv = setup({ componentId: "files", version: "0.3.0" });
  const staleImporter = await staleEnv.importer(fileModuleUrl(), staleEnv.currentSlot);
  const staleHostPorts = filesHostPorts();
  const staleMounted = await staleImporter.componentRuntime.mount({
    root: staleEnv.root,
    surfaceLifecycle: staleEnv.lifecycle,
    appData: staleEnv.appData,
    fileSpace: deviceLocalFileSpace(),
    ...staleHostPorts.context,
  });
  const staleFrame = staleEnv.root.childNodes[0];
  const staleSubscribe = mountedMessage(staleFrame);
  staleFrame.childPort.postMessage({
    schema: BRIDGE, type: "call", id: 1, operation: "projects.subscribe", args: [1],
  });
  assert.equal((await staleSubscribe).value, true);
  staleEnv.setCurrentSlot({ ...staleEnv.currentSlot, revision: staleEnv.currentSlot.revision + 1 });
  staleHostPorts.emitProjectUpdate([project]);
  for (let attempt = 0; attempt < 10 && staleEnv.root.childNodes.length !== 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(staleEnv.root.childNodes.length, 0);
  assert.equal(staleHostPorts.projectListenerCount(), 0);
  await staleMounted.destroy();
});

test("executor accepts only the canonical loopback Native origin and requires current metadata", async () => {
  const env = setup();
  assert.throws(() => createNativeIsolatedComponentModuleImporter({
    windowRef: { ...env.windowRef, location: { origin: "https://127.0.0.1:43121" } },
    allowedComponentIds: ["notes"],
  }), /configuration is invalid/);
  assert.throws(() => createNativeIsolatedComponentModuleImporter({
    windowRef: { ...env.windowRef, location: { origin: "http://localhost:43121" } },
    allowedComponentIds: ["notes"],
  }), /configuration is invalid/);
  await assert.rejects(() => env.importer(MODULE), /metadata/);
});

test("pending import probation runs in an opaque frame without host ports and pins exact revision", async () => {
  const env = setup();
  let reads = 0;
  const source = createNativeComponentSlotSource(env.windowRef);
  const importer = createNativeIsolatedPendingComponentModuleImporter({
    windowRef: env.windowRef,
    allowedComponentIds: ["notes"],
    componentSlotSource: source,
    timeoutMs: 300,
    fetchImpl: async (url, options) => {
      reads += 1;
      assert.equal(url, source.metadataUrl("notes", "pending"));
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.redirect, "error");
      return { ok: true, json: async () => PENDING_SLOT };
    },
  });

  const result = await importer(PENDING_MODULE, PENDING_SLOT);
  const frame = env.createdElements.find((element) => element.tagName === "iframe");
  assert.equal(NATIVE_ISOLATED_COMPONENT_PROBE_SCHEMA, PROBE);
  assert.equal(reads, 2, "pending identity is checked both before and after import");
  assert.equal(frame.removed, true);
  assert.equal(frame.attributes.get("sandbox"), "allow-scripts");
  assert.equal(frame.attributes.has("allow-same-origin"), false);
  assert.equal(frame.receivedProbe.schema, PROBE);
  assert.equal(frame.receivedProbe.componentId, "notes");
  assert.match(frame.receivedProbe.moduleUrl, /\/notes\/pending\/0\.4\.2\//);
  assert.match(frame.srcdoc, /connect-src &#39;none&#39;|connect-src 'none'/);
  assert.match(frame.srcdoc, /frame-src &#39;none&#39;|frame-src 'none'/);
  assert.match(frame.srcdoc, /componentId,entrypoint,moduleUrl,nonce,schema,sourceCommit,type,version/);
  assert.throws(() => result.componentRuntime.mount(), /cannot mount or activate/);
});

test("pending import probation tears down the frame when exact revision changes", async () => {
  const env = setup();
  let reads = 0;
  const source = createNativeComponentSlotSource(env.windowRef);
  const importer = createNativeIsolatedPendingComponentModuleImporter({
    windowRef: env.windowRef,
    allowedComponentIds: ["notes"],
    componentSlotSource: source,
    timeoutMs: 300,
    fetchImpl: async () => ({
      ok: true,
      json: async () => (++reads === 1 ? PENDING_SLOT : { ...PENDING_SLOT, revision: 20 }),
    }),
  });

  await assert.rejects(() => importer(PENDING_MODULE, PENDING_SLOT), /identity or revision changed/);
  const frame = env.createdElements.find((element) => element.tagName === "iframe");
  assert.equal(reads, 2);
  assert.equal(frame.removed, true);
  assert.equal(env.documentObject.documentElement.childNodes.length, 0);
});

test("Native composition defaults to isolated import-only probation", async () => {
  const env = setup();
  const reads = [];
  const result = await runNativePendingComponentProbation({
    componentId: "notes",
    windowRef: env.windowRef,
    fetchImpl: async (url, options) => {
      reads.push({ url, options });
      return { ok: true, json: async () => PENDING_SLOT };
    },
  });

  const frame = env.createdElements.find((element) => element.tagName === "iframe");
  assert.equal(result.componentId, "notes");
  assert.equal(result.revision, PENDING_SLOT.revision);
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "import-contract");
  assert.equal(reads.length, 3, "composition reads once, then verifies the exact pending slot before and after import");
  assert.ok(reads.every(({ url }) => url === `${ORIGIN}/__ordax/native/component-runtime?component=notes&state=pending`));
  assert.ok(reads.every(({ options }) => options.cache === "no-store" && options.credentials === "same-origin"));
  assert.equal(frame.removed, true);
  assert.equal(frame.attributes.get("sandbox"), "allow-scripts");
  assert.equal(frame.receivedProbe?.schema, PROBE);
  assert.equal(frame.receivedProbe?.nonce?.length, 36);
  assert.equal("componentRuntime" in result, false, "probation returns only a health receipt, never a launchable runtime");
});
