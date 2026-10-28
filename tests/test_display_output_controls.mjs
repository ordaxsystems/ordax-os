import assert from "node:assert/strict";
import test from "node:test";
import { mountDisplayOutputControls } from "../system/surface/ui/display-output-controls.mjs";
import { DISPLAY_OUTPUTS_SCHEMA } from "../system/contracts/display-outputs.mjs";
import { SETTINGS_SOURCE_MESSAGES, SETTINGS_ENGLISH_MESSAGES } from "../system/services/i18n/catalog/settings.mjs";

class FakeElement {
  constructor(documentObject, tagName) {
    this.ownerDocument = documentObject;
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
  }

  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = [...elements]; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
  dispatch(name) { this.listeners.get(name)?.({ target: this }); }
  contains(candidate) { return this === candidate || this.children.some((child) => child.contains(candidate)); }
}

function createDocument() {
  const documentObject = {
    createElement(tagName) { return new FakeElement(documentObject, tagName); },
  };
  return documentObject;
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

function outputSnapshot({ currentModeId = "1920x1080@60", preview = null } = {}) {
  return {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    available: true,
    reason: null,
    outputs: [{
      id: "DP-1",
      name: "Monitor principal",
      enabled: true,
      modes: [
        { id: "1920x1080@60", width: 1920, height: 1080, refreshHz: 60, current: currentModeId === "1920x1080@60" },
        { id: "1280x720@60", width: 1280, height: 720, refreshHz: 60, preferred: true, current: currentModeId === "1280x720@60" },
      ],
    }],
    preview,
  };
}

const translate = (id, values = {}) => values.seconds === undefined ? id : `${id}:${values.seconds}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Native display controls preview, count down, and complete confirm/revert safely", async () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  let current = outputSnapshot();
  let now = 1000;
  const calls = [];
  const intervals = new Map();
  let nextIntervalId = 0;
  const port = {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    async read() { calls.push(["read"]); return current; },
    async preview(outputId, modeId) {
      calls.push(["preview", outputId, modeId]);
      current = outputSnapshot({
        currentModeId: modeId,
        preview: { id: "preview-token-123456", outputId, modeId, expiresAt: now + 12000 },
      });
      return current;
    },
    async confirm(previewId) {
      calls.push(["confirm", previewId]);
      current = outputSnapshot({ currentModeId: "1280x720@60" });
      return current;
    },
    async revert(previewId) {
      calls.push(["revert", previewId]);
      current = outputSnapshot();
      return current;
    },
  };

  const mounted = mountDisplayOutputControls(container, {
    documentObject,
    translate,
    port,
    now: () => now,
    setIntervalFn(callback) { const id = ++nextIntervalId; intervals.set(id, callback); return id; },
    clearIntervalFn(id) { intervals.delete(id); },
  });
  await settle();

  const modeSelect = find(mounted.element, (element) => element.dataset.displayMode === "true");
  const previewButton = find(mounted.element, (element) => element.textContent === "settings.display.host.preview");
  assert.ok(modeSelect);
  assert.ok(previewButton);
  assert.equal(previewButton.disabled, true, "the current mode cannot be previewed again");

  modeSelect.value = "1280x720@60";
  modeSelect.dispatch("change");
  assert.equal(previewButton.disabled, false);
  previewButton.dispatch("click");
  await settle();

  assert.deepEqual(calls.find(([name]) => name === "preview"), ["preview", "DP-1", "1280x720@60"]);
  const status = find(mounted.element, (element) => element.getAttribute?.("role") === "status"
    || element.attributes.get("role") === "status");
  const previewNote = find(mounted.element, (element) => element.className === "ordax-settings-display-preview-note");
  const keepButton = find(mounted.element, (element) => element.textContent === "settings.display.host.keep");
  const revertButton = find(mounted.element, (element) => element.textContent === "settings.display.host.revert");
  assert.equal(status.textContent, "settings.display.host.previewActive");
  assert.equal(previewNote.textContent, "settings.display.host.confirmCountdown:12");
  assert.equal(keepButton.hidden, false);
  assert.equal(revertButton.hidden, false);

  now += 5000;
  for (const tick of intervals.values()) tick();
  assert.equal(previewNote.textContent, "settings.display.host.confirmCountdown:7");
  revertButton.dispatch("click");
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "revert"), ["revert", "preview-token-123456"]);
  assert.equal(previewNote.hidden, true);

  modeSelect.value = "1280x720@60";
  modeSelect.dispatch("change");
  previewButton.dispatch("click");
  await settle();
  keepButton.dispatch("click");
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "confirm"), ["confirm", "preview-token-123456"]);
  mounted.destroy();
  assert.equal(container.children.length, 0);
});

test("expired display preview refreshes the host state and removes stale confirmation actions", async () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  let now = 1000;
  let current = outputSnapshot();
  let tick = null;
  const port = {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    async read() {
      if (current.preview && now >= current.preview.expiresAt) {
        current = outputSnapshot({ currentModeId: current.preview.modeId });
      }
      return current;
    },
    async preview(outputId, modeId) {
      current = outputSnapshot({
        currentModeId: modeId,
        preview: { id: "preview-token-abcdef", outputId, modeId, expiresAt: now + 5000 },
      });
      return current;
    },
    async confirm() { throw new Error("expired preview must not be confirmed"); },
    async revert() { throw new Error("expired preview must not be reverted"); },
  };
  const mounted = mountDisplayOutputControls(container, {
    documentObject,
    translate,
    port,
    now: () => now,
    setIntervalFn(callback) { tick = callback; return 1; },
    clearIntervalFn() { tick = null; },
  });
  await settle();

  const modeSelect = find(mounted.element, (element) => element.dataset.displayMode === "true");
  const previewButton = find(mounted.element, (element) => element.textContent === "settings.display.host.preview");
  const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
  const keepButton = find(mounted.element, (element) => element.textContent === "settings.display.host.keep");
  modeSelect.value = "1280x720@60";
  modeSelect.dispatch("change");
  previewButton.dispatch("click");
  await settle();
  assert.equal(keepButton.hidden, false);

  now += 5000;
  tick();
  await settle();
  assert.equal(keepButton.hidden, true);
  assert.equal(status.textContent, "settings.display.host.available");
  assert.equal(tick, null);
  mounted.destroy();
});

test("Native display controls keep host modes unavailable instead of inventing choices", () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  const mounted = mountDisplayOutputControls(container, { documentObject, translate });
  const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
  const controls = find(mounted.element, (element) => element.className === "ordax-settings-display-controls");
  assert.equal(status.textContent, "settings.display.host.nativeUnavailable");
  assert.equal(controls.hidden, true);
  const retry = find(mounted.element, (element) => element.dataset.settingsDisplayRetry === "true");
  assert.equal(retry.hidden, true, "without Native port no recovery is advertised");
  mounted.destroy();
});

test("Native display read failure offers explicit retry and recovers without remounting", async () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  let reads = 0;
  const port = {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    async read() {
      reads += 1;
      if (reads === 1) throw new Error("Transient Native 503");
      return outputSnapshot();
    },
    async preview() { throw new Error("No preview in read-only recovery"); },
    async confirm() { throw new Error("No confirmation in read-only recovery"); },
    async revert() { throw new Error("No revert in read-only recovery"); },
  };
  const mounted = mountDisplayOutputControls(container, { documentObject, translate, port });
  await settle();
  const retry = find(mounted.element, (element) => element.dataset.settingsDisplayRetry === "true");
  const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
  const controls = find(mounted.element, (element) => element.className === "ordax-settings-display-controls");
  assert.ok(retry, "the canonical Surface exposes an explicit retry control");
  assert.equal(reads, 1);
  assert.equal(retry.hidden, false);
  assert.equal(retry.disabled, false);
  assert.equal(status.textContent, "settings.display.host.readFailed");
  assert.equal(controls.hidden, true);
  retry.dispatch("click");
  assert.equal(retry.disabled, true, "a pending read cannot be retriggered");
  await settle();
  assert.equal(reads, 2, "one explicit retry uses the existing Native port");
  assert.equal(retry.hidden, true, "success hides the retry control");
  assert.equal(status.textContent, "settings.display.host.available");
  assert.equal(controls.hidden, false);
  const mode = find(mounted.element, (element) => element.dataset.displayMode === "true");
  assert.equal(mode.value, "1920x1080@60", "recovered mode comes from the real validated snapshot");
  mounted.destroy();
  assert.equal(retry.listeners.size, 0, "cleanup removes the retry handler");
});



test("read-only Windows display shows truthful observational copy in Portuguese and English", async () => {
  const physical = {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    available: true, reason: null,
    outputs: [{ id: "DISPLAY1", name: "Windows DISPLAY1", enabled: true,
      modes: [{ id: "3840x2160@60", width: 3840, height: 2160, refreshHz: 60, current: true }],
    }],
    preview: null,
  };
  for (const messages of [SETTINGS_SOURCE_MESSAGES, SETTINGS_ENGLISH_MESSAGES]) {
    const documentObject = createDocument();
    const container = documentObject.createElement("div");
    let reads = 0;
    const port = {
      schema: DISPLAY_OUTPUTS_SCHEMA,
      async read() { reads++; return physical; },
      async preview() { throw Error("Read-only provider cannot preview"); },
      async confirm() { throw Error("Read-only provider cannot confirm"); },
      async revert() { throw Error("Read-only provider cannot revert"); },
    };
    const mounted = mountDisplayOutputControls(container, {
      documentObject, port, translate: (id) => messages[id] ?? id,
    });
    await settle();
    const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
    const description = find(mounted.element, (element) =>
      element.className === "ordax-settings-section-copy");
    const mode = find(mounted.element, (element) => element.dataset.displayMode === "true");
    const preview = find(mounted.element, (element) => element.textContent === messages["settings.display.host.preview"]);
    const note = find(mounted.element, (element) => element.className === "ordax-settings-display-preview-note");
    assert.equal(reads, 1, "one canonical Native read, no background polling");
    assert.equal(status.textContent, messages["settings.display.host.available"]);
    assert.equal(description.textContent, messages["settings.display.host.description"]);
    assert.doesNotMatch(status.textContent, /15|confirm|confirme|restaur|restore|revert/i,
      "the read-only available state must not promise a pending rollback");
    assert.equal(mode.value, "3840x2160@60");
    assert.equal(preview.disabled, true, "no alternative mode must not mutate the monitor");
    assert.equal(note.hidden, true, "confirmation note remains exclusive to an active preview");
    mounted.destroy();
  }
});
