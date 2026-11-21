import {
  assertNetworkManagementPort,
  validateNetworkManagementSnapshot,
} from "../../contracts/network-management.mjs";
import {
  assertNetworkStatusPort,
  validateNetworkStatusSnapshot,
} from "../../contracts/network-status.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import {
  networkManagementActionMessageId,
  networkManagementFailureMessageId,
  runNetworkManagementAction,
} from "../../services/network/management-runtime.mjs";
import {
  formatNetworkReceivedAt,
  summarizeNetworkStatus,
} from "./network-tray-controls.mjs";

const MAX_QUICK_NETWORKS = 8;

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function signalMessageId(signalDbm) {
  if (signalDbm >= -50) return "network.signal.strong";
  if (signalDbm >= -60) return "network.signal.good";
  if (signalDbm >= -70) return "network.signal.fair";
  return "network.signal.weak";
}

function localizeSummary(summary, translate) {
  const titleValues = summary.qualityMessageId
    ? { quality: translate(summary.qualityMessageId) }
    : {};
  return Object.freeze({
    ...summary,
    label: translate(summary.labelMessageId),
    title: translate(summary.titleMessageId, titleValues),
  });
}

export function mountNetworkQuickPanel(
  root,
  networkStatus,
  networkManagement = null,
  surfaceLifecycle,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Network quick panel requires a Surface root Element");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const statusPort = networkStatus === null ? null : assertNetworkStatusPort(networkStatus);
  const managementPort =
    networkManagement === null ? null : assertNetworkManagementPort(networkManagement);
  const panel = root.querySelector('[data-quick-panel="network"]');
  const content = root.querySelector("[data-quick-network-content]");
  if (!panel || !content) {
    throw new Error("Network quick panel requires shared shell slots");
  }

  const documentObject = root.ownerDocument;
  let statusSnapshot = null;
  let statusReadFailed = false;
  let statusLastSuccessAt = null;
  let managementSnapshot = null;
  let managementReadFailed = false;
  let managementLastSuccessAt = null;
  let selectedSsid = null;
  let pending = false;
  let messageId = null;
  let statusOrdinal = 0;
  let managementOrdinal = 0;
  let actionOrdinal = 0;
  let passwordDraft = "";
  let passwordDraftSsid = null;
  let focusPasswordRequested = false;
  let destroyed = false;

  const receivedAt = (value) =>
    formatNetworkReceivedAt(value, localization.getLocale())
    ?? t("network.time.unknown");

  const clearPasswordDraft = () => {
    passwordDraft = "";
    passwordDraftSsid = null;
    focusPasswordRequested = false;
  };

  const focusIdentity = (element) => {
    if (!element || !element.dataset) return null;
    if (element.dataset.quickWifiPasswordFor) {
      return Object.freeze({
        kind: "password",
        value: element.dataset.quickWifiPasswordFor,
      });
    }
    if (element.dataset.quickWifiSsid && !element.dataset.quickNetworkAction) {
      return Object.freeze({ kind: "network", value: element.dataset.quickWifiSsid });
    }
    if (element.dataset.quickNetworkAction) {
      return Object.freeze({
        kind: "action",
        value: element.dataset.quickNetworkAction,
        ssid: element.dataset.quickWifiSsid ?? null,
      });
    }
    if (element.dataset.appTarget === "network") {
      return Object.freeze({ kind: "settings", value: "network" });
    }
    return null;
  };

  const findFocusTarget = (identity) => {
    if (!identity) return null;
    return Array.from(content.querySelectorAll("button, input")).find((element) => {
      const candidate = focusIdentity(element);
      return candidate
        && candidate.kind === identity.kind
        && candidate.value === identity.value
        && (candidate.ssid ?? null) === (identity.ssid ?? null);
    }) ?? null;
  };

  const captureInteraction = () => {
    const activeElement = documentObject.activeElement;
    const activeInside = activeElement && content.contains(activeElement);
    const passwordInput = content.querySelector("[data-quick-wifi-password]");
    const list = content.querySelector(".ordax-quick-network-list");
    return Object.freeze({
      panelScrollTop: panel.scrollTop,
      listScrollTop: list?.scrollTop ?? 0,
      focus: activeInside ? focusIdentity(activeElement) : null,
      passwordSelection:
        passwordInput instanceof HTMLInputElement && activeElement === passwordInput
          ? Object.freeze({
              start: passwordInput.selectionStart,
              end: passwordInput.selectionEnd,
            })
          : null,
    });
  };

  const restoreInteraction = (snapshot) => {
    if (!snapshot) return;
    const list = content.querySelector(".ordax-quick-network-list");
    if (list) list.scrollTop = snapshot.listScrollTop;

    let focusTarget = findFocusTarget(snapshot.focus);
    if (focusPasswordRequested) {
      focusTarget = content.querySelector("[data-quick-wifi-password]") ?? focusTarget;
      focusPasswordRequested = false;
    }
    focusTarget?.focus?.({ preventScroll: true });

    if (
      focusTarget instanceof HTMLInputElement
      && snapshot.passwordSelection
      && focusTarget.dataset.quickWifiPasswordFor === passwordDraftSsid
    ) {
      const length = focusTarget.value.length;
      const start = Math.min(snapshot.passwordSelection.start ?? length, length);
      const end = Math.min(snapshot.passwordSelection.end ?? start, length);
      focusTarget.setSelectionRange(start, end);
    }
    panel.scrollTop = snapshot.panelScrollTop;
  };

  const render = () => {
    const interaction = captureInteraction();
    content.replaceChildren();

    const summary = node(documentObject, "div", "ordax-quick-network-summary");
    if (statusSnapshot) {
      const state = localizeSummary(summarizeNetworkStatus(statusSnapshot), t);
      summary.dataset.observation = statusReadFailed ? "stale" : "current";
      summary.append(
        node(
          documentObject,
          "strong",
          "",
          statusReadFailed
            ? t("network.quick.summary.staleLabel", { label: state.label })
            : state.label,
        ),
        node(
          documentObject,
          "span",
          "",
          statusReadFailed
            ? t("network.quick.summary.staleTitle", {
                title: state.title,
                time: receivedAt(statusLastSuccessAt),
              })
            : state.title,
        ),
      );
    } else {
      summary.dataset.observation = statusReadFailed ? "unavailable" : "loading";
      summary.append(
        node(documentObject, "strong", "", t("network.quick.summary.label")),
        node(
          documentObject,
          "span",
          "",
          statusPort
            ? statusReadFailed
              ? t("network.quick.statusUnavailable")
              : t("network.quick.statusReading")
            : t("network.quick.statusUnsupported"),
        ),
      );
    }
    content.append(summary);

    if (!managementPort) {
      content.append(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          t("network.quick.managementUnsupported"),
        ),
      );
      restoreInteraction(interaction);
      return;
    }

    const actions = node(documentObject, "div", "ordax-quick-actions");
    const addAction = (action, label, primary = false) => {
      const button = node(
        documentObject,
        "button",
        primary ? "ordax-quick-action ordax-quick-action-primary" : "ordax-quick-action",
        label,
      );
      button.type = "button";
      button.dataset.quickNetworkAction = action;
      button.disabled = pending || (managementReadFailed && action !== "scan");
      actions.append(button);
    };
    addAction(
      "scan",
      pending ? t("network.quick.action.wait") : t("network.quick.action.scan"),
      true,
    );
    if (managementSnapshot?.currentSsid) {
      addAction("disconnect", t("network.quick.action.disconnect"));
    }
    if (managementSnapshot?.savedSsid && !managementSnapshot.currentSsid) {
      addAction("reconnect", t("network.quick.action.reconnect"));
    }
    content.append(actions);

    if (messageId) {
      const status = node(documentObject, "p", "ordax-quick-message", t(messageId));
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      content.append(status);
    }

    if (managementReadFailed && managementSnapshot !== null) {
      const stale = node(
        documentObject,
        "p",
        "ordax-quick-message",
        t("network.quick.networksStale", {
          time: receivedAt(managementLastSuccessAt),
        }),
      );
      stale.dataset.observation = "stale";
      content.append(stale);
    }

    if (managementSnapshot === null) {
      content.append(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          managementReadFailed
            ? t("network.quick.managementUnavailable")
            : t("network.quick.managementReading"),
        ),
      );
      restoreInteraction(interaction);
      return;
    }

    if (managementSnapshot.currentSsid) {
      const current = node(documentObject, "div", "ordax-quick-current");
      current.append(
        node(documentObject, "span", "ordax-quick-kicker", t("network.quick.current")),
        node(documentObject, "strong", "", managementSnapshot.currentSsid),
      );
      content.append(current);
    }

    const list = node(documentObject, "div", "ordax-quick-network-list");
    const networks = [...managementSnapshot.networks]
      .sort((left, right) => right.signalDbm - left.signalDbm)
      .slice(0, MAX_QUICK_NETWORKS);
    if (networks.length === 0) {
      list.append(
        node(
          documentObject,
          "p",
          "ordax-quick-empty",
          t("network.quick.empty"),
        ),
      );
    } else {
      for (const entry of networks) {
        const button = node(documentObject, "button", "ordax-quick-network");
        button.type = "button";
        button.dataset.quickWifiSsid = entry.ssid;
        button.dataset.selected = String(selectedSsid === entry.ssid);
        button.dataset.connected = String(entry.connected);
        button.disabled = pending || managementReadFailed || entry.connected;
        button.setAttribute("aria-pressed", String(selectedSsid === entry.ssid));
        const copy = node(documentObject, "span", "ordax-quick-network-copy");
        const stateMessageId = entry.connected
          ? "network.quick.state.connected"
          : entry.saved
            ? "network.quick.state.saved"
            : "network.quick.state.available";
        copy.append(
          node(documentObject, "strong", "", entry.ssid),
          node(
            documentObject,
            "small",
            "",
            `${t(stateMessageId)} · ${t(signalMessageId(entry.signalDbm))}`,
          ),
        );
        button.append(
          node(documentObject, "span", "ordax-quick-network-dot"),
          copy,
        );
        list.append(button);
      }
    }
    content.append(list);

    const selected = managementSnapshot.networks.find(
      (entry) => entry.ssid === selectedSsid,
    );
    if (selected && !selected.connected) {
      const form = node(documentObject, "div", "ordax-quick-network-form");
      const label = node(documentObject, "label", "ordax-quick-network-password");
      label.append(
        node(
          documentObject,
          "span",
          "",
          t("network.quick.passwordLabel", { ssid: selected.ssid }),
        ),
      );
      const input = documentObject.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.dataset.quickWifiPassword = "";
      input.dataset.quickWifiPasswordFor = selected.ssid;
      input.value = passwordDraftSsid === selected.ssid ? passwordDraft : "";
      input.disabled = pending;
      label.append(input);
      const connect = node(
        documentObject,
        "button",
        "ordax-quick-action ordax-quick-action-primary",
        t("network.quick.action.connect"),
      );
      connect.type = "button";
      connect.dataset.quickNetworkAction = "connect";
      connect.dataset.quickWifiSsid = selected.ssid;
      connect.disabled = pending || managementReadFailed;
      form.append(label, connect);
      content.append(form);
    }

    const settings = node(
      documentObject,
      "button",
      "ordax-quick-settings-link",
      t("network.quick.settings"),
    );
    settings.type = "button";
    settings.dataset.launchApp = "settings";
    settings.dataset.appTarget = "network";
    settings.dataset.quickPanelClose = "";
    content.append(settings);
    restoreInteraction(interaction);
  };

  const refreshStatus = async () => {
    if (!statusPort || destroyed) return;
    const ordinal = ++statusOrdinal;
    try {
      const nextSnapshot = validateNetworkStatusSnapshot(await statusPort.read());
      if (destroyed || ordinal !== statusOrdinal) return;
      statusSnapshot = nextSnapshot;
      statusReadFailed = false;
      statusLastSuccessAt = Date.now();
    } catch {
      if (destroyed || ordinal !== statusOrdinal) return;
      statusReadFailed = true;
    }
  };

  const refreshManagement = async () => {
    if (!managementPort || destroyed) return;
    const ordinal = ++managementOrdinal;
    try {
      const nextSnapshot = validateNetworkManagementSnapshot(await managementPort.status());
      if (destroyed || ordinal !== managementOrdinal) return;
      managementSnapshot = nextSnapshot;
      managementReadFailed = false;
      managementLastSuccessAt = Date.now();
      if (messageId === "network.quick.managementTemporaryUnavailable") {
        messageId = null;
      }
      if (
        selectedSsid !== null
        && !nextSnapshot.networks.some((entry) => entry.ssid === selectedSsid)
      ) {
        selectedSsid = null;
        clearPasswordDraft();
      }
    } catch {
      if (destroyed || ordinal !== managementOrdinal) return;
      managementReadFailed = true;
      // Revoke any saved credential draft once the authoritative network list
      // becomes unavailable. Stale scan results remain informational only.
      selectedSsid = null;
      clearPasswordDraft();
      if (managementSnapshot === null) {
        messageId = "network.quick.managementTemporaryUnavailable";
      }
    }
  };

  const refresh = async () => {
    await Promise.all([refreshStatus(), refreshManagement()]);
    if (!destroyed) render();
  };

  const runAction = async (action, credentials = null) => {
    // Stale management snapshots are read-only. Scan is the explicit recovery
    // operation; connect, reconnect and disconnect need a current observation.
    if (!managementPort || pending || destroyed || (managementReadFailed && action !== "scan")) return;
    const ordinal = ++actionOrdinal;
    managementOrdinal += 1;
    pending = true;
    messageId = networkManagementActionMessageId(action, 0);
    render();

    try {
      const nextSnapshot = validateNetworkManagementSnapshot(
        await runNetworkManagementAction(managementPort, action, credentials),
      );
      if (destroyed || ordinal !== actionOrdinal) return;
      managementSnapshot = nextSnapshot;
      managementReadFailed = false;
      managementLastSuccessAt = Date.now();
      selectedSsid = null;
      clearPasswordDraft();
      messageId = networkManagementActionMessageId(action, 1);
      await refreshStatus();
    } catch (error) {
      if (destroyed || ordinal !== actionOrdinal) return;
      messageId = networkManagementFailureMessageId(action, error);
    } finally {
      if (!destroyed && ordinal === actionOrdinal) {
        pending = false;
        render();
      }
    }
  };

  const onOpen = () => {
    messageId = null;
    selectedSsid = null;
    clearPasswordDraft();
    panel.scrollTop = 0;
    void refresh();
  };

  const onClose = () => {
    selectedSsid = null;
    clearPasswordDraft();
    messageId = null;
  };

  const onClick = (event) => {
    // Connect also carries an SSID: only the network option may change selection.
    // Otherwise a Connect click is consumed here before reaching runAction.
    const network = event.target.closest(".ordax-quick-network[data-quick-wifi-ssid]");
    if (network && panel.contains(network) && !managementReadFailed) {
      const nextSsid = network.dataset.quickWifiSsid ?? null;
      if (nextSsid !== selectedSsid) clearPasswordDraft();
      selectedSsid = nextSsid;
      passwordDraftSsid = selectedSsid;
      focusPasswordRequested = selectedSsid !== null;
      messageId = null;
      render();
      return;
    }

    const action = event.target.closest("[data-quick-network-action]");
    if (!action || !panel.contains(action)) return;
    const kind = action.dataset.quickNetworkAction;
    if (kind === "connect") {
      const ssid = action.dataset.quickWifiSsid;
      const input = panel.querySelector("[data-quick-wifi-password]");
      if (!(input instanceof HTMLInputElement) || input.dataset.quickWifiPasswordFor !== ssid) {
        return;
      }
      const password = input.value;
      input.value = "";
      clearPasswordDraft();
      if (!password) {
        messageId = "network.quick.passwordRequired";
        render();
        return;
      }
      void runAction("connect", { ssid, password });
      return;
    }
    void runAction(kind);
  };

  const onInput = (event) => {
    const input = event.target.closest("[data-quick-wifi-password]");
    if (!(input instanceof HTMLInputElement) || !panel.contains(input)) return;
    if (input.dataset.quickWifiPasswordFor !== selectedSsid) return;
    passwordDraftSsid = selectedSsid;
    passwordDraft = input.value;
  };

  const onKeyDown = (event) => {
    const input = event.target.closest("[data-quick-wifi-password]");
    if (!input || !panel.contains(input)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      panel.querySelector('[data-quick-network-action="connect"]')?.click();
    }
  };

  panel.addEventListener("ordax:quick-panel-open", onOpen);
  panel.addEventListener("ordax:quick-panel-close", onClose);
  panel.addEventListener("click", onClick);
  panel.addEventListener("input", onInput);
  panel.addEventListener("keydown", onKeyDown);

  const unsubscribeLocalization = localization.subscribe(() => {
    if (!destroyed) render();
  });

  return Object.freeze({
    refresh,
    destroy() {
      destroyed = true;
      statusOrdinal += 1;
      managementOrdinal += 1;
      actionOrdinal += 1;
      unsubscribeLocalization();
      clearPasswordDraft();
      statusSnapshot = null;
      statusLastSuccessAt = null;
      managementSnapshot = null;
      managementLastSuccessAt = null;
      panel.removeEventListener("ordax:quick-panel-open", onOpen);
      panel.removeEventListener("ordax:quick-panel-close", onClose);
      panel.removeEventListener("click", onClick);
      panel.removeEventListener("input", onInput);
      panel.removeEventListener("keydown", onKeyDown);
    },
  });
}
