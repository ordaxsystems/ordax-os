import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_OUTPUTS_SCHEMA } from "../system/contracts/audio-outputs.mjs";
import { mountAudioOutputControls } from "../system/surface/ui/audio-output-controls.mjs";

class FakeElement {
  constructor(documentObject, tagName) {
    this.ownerDocument = documentObject;
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
  }

  append(...elements) {
    for (const element of elements) {
      element.parentNode = this;
      this.children.push(element);
    }
  }
  replaceChildren(...elements) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...elements);
  }
  removeChild(element) {
    const index = this.children.indexOf(element);
    if (index < 0) throw new Error("child not found");
    this.children.splice(index, 1);
    element.parentNode = null;
    return element;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
  dispatch(name) { this.listeners.get(name)?.({ target: this }); }
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

function audioSnapshot({ defaultOutputId = "alsa_output.speakers", outputs = null } = {}) {
  const entries = outputs ?? [
    { id: "alsa_output.speakers", name: "Speakers", muted: false, volumePercent: 62 },
    { id: "alsa_output.headset", name: "USB headset", muted: true, volumePercent: 25 },
  ];
  return {
    schema: AUDIO_OUTPUTS_SCHEMA,
    available: true,
    reason: null,
    defaultOutputId,
    outputs: entries,
  };
}

const settle = async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

test("native audio controls route outputs and apply volume/mute with verified host readback", async () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  let current = audioSnapshot();
  const calls = [];
  const port = {
    schema: AUDIO_OUTPUTS_SCHEMA,
    async read() { calls.push(["read"]); return current; },
    async setDefaultOutput(outputId) {
      calls.push(["route", outputId]);
      current = audioSnapshot({ defaultOutputId: outputId });
      return current;
    },
    async setVolume(outputId, volumePercent) {
      calls.push(["volume", outputId, volumePercent]);
      current.outputs.find((output) => output.id === outputId).volumePercent = volumePercent;
      return current;
    },
    async setMuted(outputId, muted) {
      calls.push(["mute", outputId, muted]);
      current.outputs.find((output) => output.id === outputId).muted = muted;
      return current;
    },
  };
  const mounted = mountAudioOutputControls(container, { documentObject, translate: (id) => id, port });
  await settle();

  const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
  const controls = find(mounted.element, (element) => element.className === "ordax-settings-audio-controls");
  const outputSelect = find(mounted.element, (element) => element.dataset.audioOutput === "true");
  const volume = find(mounted.element, (element) => element.dataset.audioVolume === "true");
  const mute = find(mounted.element, (element) => element.dataset.audioMute === "true");
  assert.equal(status.textContent, "settings.audio.host.available");
  assert.equal(controls.hidden, false);
  assert.equal(outputSelect.children.length, 2);
  assert.equal(outputSelect.value, "alsa_output.speakers");

  outputSelect.value = "alsa_output.headset";
  outputSelect.dispatch("change");
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "route"), ["route", "alsa_output.headset"]);
  assert.equal(outputSelect.value, "alsa_output.headset");

  volume.value = "44";
  volume.dispatch("input");
  volume.dispatch("change");
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "volume"), ["volume", "alsa_output.headset", 44]);
  const readout = find(mounted.element, (element) => element.tagName === "output");
  assert.equal(readout.textContent, "44%");

  const refresh = find(mounted.element, (element) => element.dataset.audioRefresh === "true");
  refresh.dispatch("click");
  await settle();
  assert.equal(calls.filter(([name]) => name === "read").length, 2);

  mute.dispatch("click");
  await settle();
  assert.deepEqual(calls.find(([name]) => name === "mute"), ["mute", "alsa_output.headset", false]);
  assert.equal(mute.getAttribute("aria-pressed"), "false");
  mounted.destroy();
  assert.equal(container.children.length, 0);
});

test("audio settings report no detected output and never invent a device", async () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  const port = {
    schema: AUDIO_OUTPUTS_SCHEMA,
    async read() {
      return { schema: AUDIO_OUTPUTS_SCHEMA, available: false, reason: "no-output-device", defaultOutputId: null, outputs: [] };
    },
    async setDefaultOutput() { throw new Error("unavailable"); },
    async setVolume() { throw new Error("unavailable"); },
    async setMuted() { throw new Error("unavailable"); },
  };
  const mounted = mountAudioOutputControls(container, { documentObject, translate: (id) => id, port });
  await settle();
  const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
  const controls = find(mounted.element, (element) => element.className === "ordax-settings-audio-controls");
  assert.equal(status.textContent, "settings.audio.host.noOutput");
  assert.equal(controls.hidden, true);
  mounted.destroy();
});

test("web mode explains the host boundary without exposing native output controls", () => {
  const documentObject = createDocument();
  const container = documentObject.createElement("div");
  const mounted = mountAudioOutputControls(container, { documentObject, translate: (id) => id, mode: "web" });
  const status = find(mounted.element, (element) => element.attributes.get("role") === "status");
  const controls = find(mounted.element, (element) => element.className === "ordax-settings-audio-controls");
  assert.equal(status.textContent, "settings.audio.host.webUnavailable");
  assert.equal(controls.hidden, true);
  mounted.destroy();
});
