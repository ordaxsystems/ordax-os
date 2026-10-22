import {
  AUDIO_OUTPUTS_SCHEMA,
  assertAudioOutputsPort,
  validateAudioOutputsSnapshot,
} from "../../contracts/audio-outputs.mjs";

function make(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const UNAVAILABLE_MESSAGES = Object.freeze({
  "no-output-device": "settings.audio.host.noOutput",
  "provider-missing": "settings.audio.host.nativeUnavailable",
  "service-unavailable": "settings.audio.host.serviceUnavailable",
  "output-route-changing": "settings.audio.host.routeChanging",
  "host-unsupported": "settings.audio.host.readFailed",
});

export function mountAudioOutputControls(root, {
  documentObject = root?.ownerDocument ?? globalThis.document,
  translate = (id) => id,
  port = null,
  mode = "native",
  onExamples = /** @type {null | (() => void)} */ (null),
} = {}) {
  if (!root || typeof root.append !== "function") {
    throw new TypeError("Audio output controls require a mount element");
  }
  if (mode !== "native" && mode !== "web") {
    throw new TypeError("Audio output controls require a supported product mode");
  }
  const audioPort = port === null ? null : assertAudioOutputsPort(port);
  const section = make(documentObject, "section", "ordax-settings-section ordax-settings-audio-capability");
  section.dataset.audioOutputCapability = "";
  section.append(
    make(documentObject, "span", "ordax-settings-section-kicker", translate("settings.audio.host.kicker")),
    make(documentObject, "h4", "ordax-settings-section-title", translate("settings.audio.host.title")),
    make(documentObject, "p", "ordax-settings-section-copy", translate("settings.audio.host.description")),
  );

  const status = make(documentObject, "p", "ordax-settings-audio-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const refreshButton = make(
    documentObject,
    "button",
    "ordax-settings-audio-refresh",
    translate("settings.audio.host.refresh"),
  );
  refreshButton.type = "button";
  refreshButton.dataset.audioRefresh = "true";
  const controls = make(documentObject, "div", "ordax-settings-audio-controls");
  controls.hidden = true;
  const outputLabel = make(documentObject, "label", "ordax-settings-audio-field");
  outputLabel.append(make(documentObject, "span", "ordax-settings-audio-label", translate("settings.audio.host.output")));
  const outputSelect = make(documentObject, "select", "ordax-settings-audio-select");
  outputSelect.dataset.audioOutput = "true";
  outputLabel.append(outputSelect);

  const volumeLabel = make(documentObject, "label", "ordax-settings-audio-field");
  volumeLabel.append(make(documentObject, "span", "ordax-settings-audio-label", translate("settings.audio.host.volume")));
  const volumeRow = make(documentObject, "span", "ordax-settings-audio-volume-row");
  const volumeInput = make(documentObject, "input", "ordax-settings-audio-volume");
  volumeInput.type = "range";
  volumeInput.min = "0";
  volumeInput.max = "100";
  volumeInput.step = "1";
  volumeInput.dataset.audioVolume = "true";
  const volumeReadout = make(documentObject, "output", "ordax-settings-audio-volume-value", "0%");
  volumeRow.append(volumeInput, volumeReadout);
  volumeLabel.append(volumeRow);

  const muteButton = make(documentObject, "button", "ordax-settings-audio-mute");
  muteButton.type = "button";
  muteButton.dataset.audioMute = "true";
  const actionRow = make(documentObject, "div", "ordax-settings-audio-actions");
  actionRow.append(muteButton);
  controls.append(outputLabel, volumeLabel, actionRow);

  const examplesButton = make(
    documentObject,
    "button",
    "ordax-settings-audio-examples",
    translate("settings.audio.host.examples"),
  );
  examplesButton.type = "button";
  examplesButton.hidden = typeof onExamples !== "function";
  section.append(status, refreshButton, controls, examplesButton);
  root.append(section);

  let snapshot = null;
  let selectedOutputId = null;
  let destroyed = false;
  let pending = false;
  let operation = 0;

  const selectedOutput = () => snapshot?.outputs.find((output) => output.id === selectedOutputId) ?? null;
  const render = () => {
    if (destroyed) return;
    if (mode === "web") {
      status.textContent = translate("settings.audio.host.webUnavailable");
      status.dataset.capabilityState = "unavailable";
      refreshButton.hidden = true;
      controls.hidden = true;
      return;
    }
    if (audioPort === null) {
      status.textContent = translate("settings.audio.host.nativeUnavailable");
      status.dataset.capabilityState = "unavailable";
      refreshButton.hidden = true;
      controls.hidden = true;
      return;
    }
    refreshButton.hidden = false;
    refreshButton.disabled = pending;
    if (!snapshot) {
      status.textContent = translate("settings.audio.host.reading");
      status.dataset.capabilityState = "reading";
      controls.hidden = true;
      return;
    }
    if (!snapshot.available) {
      status.textContent = translate(UNAVAILABLE_MESSAGES[snapshot.reason] ?? "settings.audio.host.readFailed");
      status.dataset.capabilityState = "unavailable";
      controls.hidden = true;
      return;
    }
    status.textContent = translate("settings.audio.host.available");
    status.dataset.capabilityState = "available";
    controls.hidden = false;
    const preferred = snapshot.outputs.find((output) => output.id === snapshot.defaultOutputId)
      ?? snapshot.outputs[0];
    selectedOutputId = snapshot.outputs.some((output) => output.id === selectedOutputId)
      ? selectedOutputId
      : preferred.id;
    outputSelect.replaceChildren();
    for (const output of snapshot.outputs) {
      const option = make(documentObject, "option", "", output.name);
      option.value = output.id;
      outputSelect.append(option);
    }
    outputSelect.value = selectedOutputId;
    const current = selectedOutput();
    volumeInput.value = String(current.volumePercent);
    volumeReadout.value = `${current.volumePercent}%`;
    volumeReadout.textContent = `${current.volumePercent}%`;
    volumeInput.disabled = pending;
    outputSelect.disabled = pending || snapshot.outputs.length < 2;
    muteButton.disabled = pending;
    muteButton.textContent = translate(current.muted ? "settings.audio.host.unmute" : "settings.audio.host.mute");
    muteButton.setAttribute("aria-pressed", String(current.muted));
  };

  const refresh = async () => {
    if (destroyed || audioPort === null) return;
    const currentOperation = ++operation;
    try {
      const next = validateAudioOutputsSnapshot(await audioPort.read());
      if (destroyed || currentOperation !== operation) return;
      snapshot = next;
      selectedOutputId = next.defaultOutputId;
      render();
    } catch {
      if (destroyed || currentOperation !== operation) return;
      snapshot = null;
      status.textContent = translate("settings.audio.host.readFailed");
      status.dataset.capabilityState = "unavailable";
      controls.hidden = true;
    }
  };

  const apply = async (action) => {
    if (destroyed || pending || audioPort === null || !selectedOutputId) return;
    const currentOperation = ++operation;
    pending = true;
    render();
    try {
      snapshot = validateAudioOutputsSnapshot(await action(audioPort, selectedOutputId));
      if (destroyed || currentOperation !== operation) return;
      selectedOutputId = snapshot.defaultOutputId;
    } catch {
      if (destroyed || currentOperation !== operation) return;
      snapshot = null;
      status.textContent = translate("settings.audio.host.applyFailed");
      status.dataset.capabilityState = "unavailable";
      controls.hidden = true;
      pending = false;
      await refresh();
      return;
    }
    pending = false;
    render();
  };

  const handleOutputChange = () => {
    const nextOutputId = outputSelect.value;
    if (!snapshot?.outputs.some((output) => output.id === nextOutputId)) return;
    selectedOutputId = nextOutputId;
    void apply((activePort, outputId) => activePort.setDefaultOutput(outputId));
  };
  const handleRefresh = () => { void refresh(); };
  const handleVolumeInput = () => {
    volumeReadout.value = `${volumeInput.value}%`;
    volumeReadout.textContent = `${volumeInput.value}%`;
  };
  const handleVolumeChange = () => {
    const value = Number(volumeInput.value);
    if (Number.isInteger(value) && value >= 0 && value <= 100) {
      void apply((activePort, outputId) => activePort.setVolume(outputId, value));
    }
  };
  const handleMute = () => {
    const current = selectedOutput();
    if (current) void apply((activePort, outputId) => activePort.setMuted(outputId, !current.muted));
  };
  const handleExamples = () => onExamples?.();

  outputSelect.addEventListener("change", handleOutputChange);
  refreshButton.addEventListener("click", handleRefresh);
  volumeInput.addEventListener("input", handleVolumeInput);
  volumeInput.addEventListener("change", handleVolumeChange);
  muteButton.addEventListener("click", handleMute);
  examplesButton.addEventListener("click", handleExamples);
  render();
  void refresh();

  return Object.freeze({
    element: section,
    refresh,
    destroy() {
      destroyed = true;
      operation += 1;
      outputSelect.removeEventListener("change", handleOutputChange);
      refreshButton.removeEventListener("click", handleRefresh);
      volumeInput.removeEventListener("input", handleVolumeInput);
      volumeInput.removeEventListener("change", handleVolumeChange);
      muteButton.removeEventListener("click", handleMute);
      examplesButton.removeEventListener("click", handleExamples);
      if (section.parentNode === root) root.removeChild(section);
    },
  });
}
