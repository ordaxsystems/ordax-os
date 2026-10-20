import {
  assertDisplayOutputsPort,
  validateDisplayOutputsSnapshot,
} from "../../contracts/display-outputs.mjs";

function make(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatMode(mode, t) {
  const hz = Number.isInteger(mode.refreshHz) ? String(mode.refreshHz) : mode.refreshHz.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const recommended = mode.preferred ? ` · ${t("settings.display.host.preferred")}` : "";
  const current = mode.current ? ` · ${t("settings.display.host.current")}` : "";
  return `${mode.width} × ${mode.height} · ${hz} Hz${current}${recommended}`;
}

/**
 * Shared Native/Web display control. Public options are explicitly typed
 * at the JS→TS boundary; callbacks do not grant host authority.
 * @param {HTMLElement} container
 * @param {object} options
 * @param {Document} [options.documentObject]
 * @param {(id: string) => string} options.translate
 * @param {ReturnType<typeof assertDisplayOutputsPort> | null} [options.port]
 * @param {"native" | "web"} [options.mode]
 * @param {(() => void) | null} [options.onExamples]
 * @param {() => number} [options.now]
 * @param {typeof globalThis.setInterval} [options.setIntervalFn]
 * @param {typeof globalThis.clearInterval} [options.clearIntervalFn]
 */
export function mountDisplayOutputControls(container, {
  documentObject = container?.ownerDocument,
  translate = /** @type {((messageId: string, params?: Record<string, unknown>) => string) | undefined} */ (undefined),
  port = null,
  mode = "native",
  onExamples = /** @type {null | (() => void)} */ (null),
  now = () => Date.now(),
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
} = {}) {
  if (!container || !documentObject || typeof translate !== "function") {
    throw new TypeError("Display output controls require a container, document, and translator");
  }
  const outputPort = port === null ? null : assertDisplayOutputsPort(port);
  let snapshot = null;
  let pending = false;
  let destroyed = false;
  let statusMessageId = null;
  let previewCountdown = null;

  const section = make(documentObject, "section", "ordax-settings-section ordax-settings-display-capability");
  section.append(
    make(documentObject, "span", "ordax-settings-section-kicker", translate("settings.display.host.kicker")),
    make(documentObject, "h4", "ordax-settings-section-title", translate("settings.display.host.title")),
    make(documentObject, "p", "ordax-settings-section-copy", translate("settings.display.host.description")),
  );
  const status = make(documentObject, "p", "ordax-settings-display-status");
  status.setAttribute("role", "status");
  const controls = make(documentObject, "div", "ordax-settings-display-controls");
  const outputLabel = make(documentObject, "label", "ordax-settings-display-field");
  const outputCaption = make(documentObject, "span", "ordax-settings-display-label", translate("settings.display.host.output"));
  const outputSelect = documentObject.createElement("select");
  outputSelect.dataset.displayOutput = "true";
  outputLabel.append(outputCaption, outputSelect);
  const modeLabel = make(documentObject, "label", "ordax-settings-display-field");
  const modeCaption = make(documentObject, "span", "ordax-settings-display-label", translate("settings.display.host.mode"));
  const modeSelect = documentObject.createElement("select");
  modeSelect.dataset.displayMode = "true";
  modeLabel.append(modeCaption, modeSelect);
  const actionRow = make(documentObject, "div", "ordax-settings-display-actions");
  const previewButton = make(documentObject, "button", "ordax-settings-action", translate("settings.display.host.preview"));
  previewButton.type = "button";
  const keepButton = make(documentObject, "button", "ordax-settings-action ordax-settings-action-primary", translate("settings.display.host.keep"));
  keepButton.type = "button";
  const revertButton = make(documentObject, "button", "ordax-settings-action", translate("settings.display.host.revert"));
  revertButton.type = "button";
  actionRow.append(previewButton, keepButton, revertButton);
  const previewNote = make(documentObject, "p", "ordax-settings-display-preview-note", translate("settings.display.host.confirmNote"));
  const examplesButton = make(documentObject, "button", "ordax-settings-display-examples", translate("settings.display.host.examples"));
  examplesButton.type = "button";
  examplesButton.dataset.settingsDisplayExamples = "true";
  controls.append(outputLabel, modeLabel, actionRow, previewNote);
  section.append(status, controls, examplesButton);
  container.replaceChildren(section);

  const selectedOutput = () => snapshot?.outputs.find((output) => output.id === outputSelect.value) ?? null;
  const selectedMode = (output) => output?.modes.find((item) => item.id === modeSelect.value) ?? null;

  const stopPreviewCountdown = () => {
    if (previewCountdown !== null) {
      clearIntervalFn(previewCountdown);
      previewCountdown = null;
    }
  };

  const updatePreviewCountdown = () => {
    if (!snapshot?.preview || destroyed) return;
    const seconds = Math.max(0, Math.ceil((snapshot.preview.expiresAt - now()) / 1000));
    previewNote.textContent = translate("settings.display.host.confirmCountdown", { seconds });
    if (seconds === 0) {
      stopPreviewCountdown();
      if (!pending) void refresh();
    }
  };

  const render = () => {
    if (destroyed) return;
    const unavailableText = mode === "web"
      ? translate("settings.display.host.webUnavailable")
      : translate("settings.display.host.nativeUnavailable");
    const available = snapshot?.available === true;
    status.textContent = statusMessageId
      ? translate(statusMessageId)
      : available ? translate("settings.display.host.available") : unavailableText;
    status.dataset.capabilityState = available ? "available" : "unavailable";
    controls.hidden = !available;
    outputLabel.hidden = !available;
    modeLabel.hidden = !available;
    actionRow.hidden = !available;
    previewNote.hidden = !snapshot?.preview;
    keepButton.hidden = !snapshot?.preview;
    revertButton.hidden = !snapshot?.preview;
    previewButton.hidden = !available || !!snapshot?.preview;
    if (available) {
      const enabledOutputs = snapshot.outputs.filter((output) => output.enabled);
      const previousOutput = outputSelect.value;
      outputSelect.replaceChildren(...enabledOutputs.map((output) => {
        const option = make(documentObject, "option", "", output.name);
        option.value = output.id;
        return option;
      }));
      outputSelect.value = enabledOutputs.some((output) => output.id === previousOutput)
        ? previousOutput
        : enabledOutputs[0]?.id ?? "";
      const output = selectedOutput();
      const previousMode = modeSelect.value;
      modeSelect.replaceChildren(...(output?.modes ?? []).map((item) => {
        const option = make(documentObject, "option", "", formatMode(item, translate));
        option.value = item.id;
        return option;
      }));
      const currentMode = output?.currentModeId;
      modeSelect.value = output?.modes.some((item) => item.id === previousMode) ? previousMode : currentMode ?? "";
    }
    if (snapshot?.preview) {
      status.textContent = translate("settings.display.host.previewActive");
      updatePreviewCountdown();
      if (previewCountdown === null && snapshot.preview.expiresAt > now()) {
        previewCountdown = setIntervalFn(updatePreviewCountdown, 1000);
      }
      outputSelect.disabled = true;
      modeSelect.disabled = true;
      keepButton.disabled = pending;
      revertButton.disabled = pending;
      return;
    }
    stopPreviewCountdown();
    previewNote.textContent = translate("settings.display.host.confirmNote");
    outputSelect.disabled = pending;
    modeSelect.disabled = pending;
    previewButton.disabled = pending;
    if (!available) return;
    const output = selectedOutput();
    const currentMode = output?.currentModeId;
    previewButton.disabled = pending || !selectedMode(output) || selectedMode(output)?.id === currentMode;
  };

  const refresh = async () => {
    if (!outputPort || pending || destroyed) return;
    pending = true;
    render();
    try {
      snapshot = validateDisplayOutputsSnapshot(await outputPort.read());
      statusMessageId = null;
    } catch {
      snapshot = null;
      statusMessageId = "settings.display.host.readFailed";
    } finally {
      pending = false;
      render();
    }
  };

  const run = async (operation, ...args) => {
    if (!outputPort || pending || destroyed) return;
    pending = true;
    render();
    try {
      snapshot = validateDisplayOutputsSnapshot(await operation(...args));
      statusMessageId = null;
    } catch {
      statusMessageId = "settings.display.host.applyFailed";
      try { snapshot = validateDisplayOutputsSnapshot(await outputPort.read()); } catch { snapshot = null; }
    } finally {
      pending = false;
      render();
    }
  };

  const handleOutputChange = () => render();
  const handleModeChange = () => render();
  const handlePreview = () => {
    const output = selectedOutput();
    const selected = selectedMode(output);
    if (output && selected) void run(outputPort.preview.bind(outputPort), output.id, selected.id);
  };
  const handleKeep = () => {
    if (snapshot?.preview) void run(outputPort.confirm.bind(outputPort), snapshot.preview.id);
  };
  const handleRevert = () => {
    if (snapshot?.preview) void run(outputPort.revert.bind(outputPort), snapshot.preview.id);
  };
  const handleExamples = () => onExamples?.();

  outputSelect.addEventListener("change", handleOutputChange);
  modeSelect.addEventListener("change", handleModeChange);
  previewButton.addEventListener("click", handlePreview);
  keepButton.addEventListener("click", handleKeep);
  revertButton.addEventListener("click", handleRevert);
  examplesButton.addEventListener("click", handleExamples);
  render();
  if (outputPort) void refresh();

  return Object.freeze({
    element: section,
    destroy() {
      destroyed = true;
      stopPreviewCountdown();
      outputSelect.removeEventListener("change", handleOutputChange);
      modeSelect.removeEventListener("change", handleModeChange);
      previewButton.removeEventListener("click", handlePreview);
      keepButton.removeEventListener("click", handleKeep);
      revertButton.removeEventListener("click", handleRevert);
      examplesButton.removeEventListener("click", handleExamples);
      if (container.contains(section)) container.replaceChildren();
    },
  });
}
