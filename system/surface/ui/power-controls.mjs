import {
  assertPowerActionsPort,
  isPowerActionSupported,
  validatePowerActionsSnapshot,
} from "../../contracts/power-actions.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { assertUpdateStatusPort } from "../../contracts/update-status.mjs";

const ACTIONS = Object.freeze([
  Object.freeze({
    id: "restart",
    labelMessageId: "power.controls.restart.label",
    confirmingMessageId: "power.controls.restart.confirm",
    pendingMessageId: "power.controls.restart.pending",
    descriptionMessageId: "power.controls.restart.description",
    confirmationMessageId: "power.controls.restart.confirmation",
    mark: "↻",
  }),
  Object.freeze({
    id: "shutdown",
    labelMessageId: "power.controls.shutdown.label",
    confirmingMessageId: "power.controls.shutdown.confirm",
    pendingMessageId: "power.controls.shutdown.pending",
    descriptionMessageId: "power.controls.shutdown.description",
    confirmationMessageId: "power.controls.shutdown.confirmation",
    mark: "⏻",
  }),
]);

const POWER_ACTION_SETTLE_MS = 30000;

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountPowerControls(root, powerActions = null, surfaceLifecycle = null, updateStatusPort = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("Power controls root must be a DOM Element");
  }
  if (powerActions === null) {
    return Object.freeze({ destroy() {} });
  }

  const port = assertPowerActionsPort(powerActions);
  const updatePort = updateStatusPort === null ? null : assertUpdateStatusPort(updateStatusPort);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  let snapshot = validatePowerActionsSnapshot(port.getSnapshot());
  const documentObject = root.ownerDocument;
  const shell = root.querySelector("[data-ordax-shell]");
  const slot = root.querySelector("[data-power-slot]");
  if (!shell || !slot) {
    throw new Error("Surface power controls require the shared shell power slot");
  }

  const availableActions = () => ACTIONS.filter((item) => isPowerActionSupported(snapshot, item.id));
  if (availableActions().length === 0) {
    return Object.freeze({ destroy() {} });
  }

  const toggle = node(documentObject, "button", "ordax-rail-button ordax-rail-power");
  toggle.type = "button";
  toggle.dataset.powerToggle = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", t("power.controls.open"));
  toggle.append(
    node(documentObject, "span", "ordax-rail-power-icon", "⏻"),
    node(documentObject, "span", "ordax-power-toggle-label", t("power.controls.toggle")),
  );
  slot.append(toggle);

  const overlay = node(documentObject, "div", "ordax-launcher ordax-power-menu");
  overlay.dataset.powerMenu = "";
  overlay.hidden = true;
  const panel = node(documentObject, "div", "ordax-launcher-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", t("power.controls.dialog"));
  const heading = node(documentObject, "div", "ordax-launcher-heading");
  const headingTitle = node(documentObject, "span", "", t("power.controls.heading"));
  const headingDetail = node(documentObject, "small", "", t("power.controls.hostAction"));
  heading.append(headingTitle, headingDetail);
  const grid = node(documentObject, "div", "ordax-launcher-grid");
  const status = node(documentObject, "p", "ordax-empty", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  panel.append(heading, grid, status);
  overlay.append(panel);
  shell.append(overlay);

  let open = false;
  let confirming = null;
  let pending = null;
  let messageId = updatePort?.getSnapshot()?.hostPower?.lastStatus === "failed"
    ? "power.controls.failed" : null;
  let lastPowerReceipt = updatePort?.getSnapshot()?.hostPower ?? null;
  let observedCurrentRequest = false;
  let resetTimer = null;
  let actionOrdinal = 0;
  let destroyed = false;

  const captureFocusedAction = () => {
    if (!open) return null;
    const activeElement = documentObject.activeElement;
    const button = activeElement?.closest?.("[data-power-action]");
    if (!button || !grid.contains(button)) return null;
    return button.dataset.powerAction ?? null;
  };

  const restoreFocusedAction = (actionId) => {
    if (!open || !actionId) return;
    const button = Array.from(grid.querySelectorAll("[data-power-action]"))
      .find((candidate) => candidate.dataset.powerAction === actionId) ?? null;
    if (button && !button.disabled) {
      button.focus({ preventScroll: true });
      return;
    }
    toggle.focus({ preventScroll: true });
  };

  const render = () => {
    const focusedAction = captureFocusedAction();
    overlay.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", t("power.controls.open"));
    toggle.querySelector(".ordax-power-toggle-label").textContent = t("power.controls.toggle");
    panel.setAttribute("aria-label", t("power.controls.dialog"));
    headingTitle.textContent = t("power.controls.heading");
    headingDetail.textContent = t("power.controls.hostAction");
    grid.replaceChildren();
    for (const item of availableActions()) {
      const button = node(documentObject, "button", "ordax-launcher-app");
      button.type = "button";
      button.dataset.powerAction = item.id;
      button.disabled = pending !== null;
      const copy = node(documentObject, "span", "ordax-launcher-app-copy");
      const labelMessageId = pending === item.id
        ? item.pendingMessageId
        : confirming === item.id
          ? item.confirmingMessageId
          : item.labelMessageId;
      copy.append(
        node(documentObject, "strong", "", t(labelMessageId)),
        node(documentObject, "small", "", t(item.descriptionMessageId)),
      );
      button.append(node(documentObject, "span", "ordax-app-mark", item.mark), copy);
      grid.append(button);
    }
    const renderedMessage = messageId ? t(messageId) : "";
    status.textContent = renderedMessage;
    status.hidden = renderedMessage.length === 0;
    restoreFocusedAction(focusedAction);
  };

  const clearResetTimer = () => {
    if (resetTimer !== null) {
      globalThis.clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  const invoke = (action) => {
    if (destroyed || pending !== null || !isPowerActionSupported(snapshot, action)) return;
    const descriptor = ACTIONS.find((item) => item.id === action);
    if (!descriptor) return;

    if (confirming !== action) {
      confirming = action;
      messageId = descriptor.confirmationMessageId;
      render();
      return;
    }

    const ordinal = ++actionOrdinal;
    confirming = null;
    pending = action;
    observedCurrentRequest = false;
    // A stale failure for the same action is not proof that this request failed.
    lastPowerReceipt = updatePort?.getSnapshot()?.hostPower ?? null;
    messageId = action === "restart" ? "power.controls.request.restart" : "power.controls.request.shutdown";
    render();
    Promise.resolve()
      .then(() => port.execute(action))
      .then(() => {
        if (destroyed || ordinal !== actionOrdinal) return;
        messageId = "power.controls.accepted";
        render();
        clearResetTimer();
        resetTimer = globalThis.setTimeout(() => {
          if (destroyed || ordinal !== actionOrdinal) return;
          pending = null;
          messageId = lastPowerReceipt?.lastAction === action && lastPowerReceipt?.lastStatus === "failed"
            ? "power.controls.failed" : "power.controls.accepted";
          render();
        }, POWER_ACTION_SETTLE_MS);
      })
      .catch(() => {
        if (destroyed || ordinal !== actionOrdinal) return;
        pending = null;
        messageId = "power.controls.failed";
        render();
      });
  };

  const onToggle = () => {
    if (pending !== null) return;
    open = !open;
    if (!open) {
      confirming = null;
      messageId = null;
    }
    render();
  };

  const onRootClick = (event) => {
    if (event.target.closest("[data-power-toggle]")) {
      onToggle();
      return;
    }
    const actionButton = event.target.closest("[data-power-action]");
    if (actionButton) {
      invoke(actionButton.dataset.powerAction);
      return;
    }
    if (open && !event.target.closest("[data-power-menu]")) {
      open = false;
      confirming = null;
      messageId = null;
      render();
    }
  };

  const onRootKeyDown = (event) => {
    if (event.key === "Escape" && open && pending === null) {
      open = false;
      confirming = null;
      messageId = null;
      render();
      toggle.focus();
    }
  };

  root.addEventListener("click", onRootClick);
  root.addEventListener("keydown", onRootKeyDown);
  const unsubscribe = port.subscribe((nextSnapshot) => {
    if (destroyed) return;
    snapshot = validatePowerActionsSnapshot(nextSnapshot);
    if (availableActions().length === 0) {
      open = false;
    }
    render();
  });
  const unsubscribePowerStatus = updatePort?.subscribe((nextSnapshot) => {
    if (destroyed) return;
    lastPowerReceipt = nextSnapshot?.hostPower ?? null;
    if (pending !== null && lastPowerReceipt?.lastAction === pending) {
      if (["pending", "stopping", "syncing", "rebooting", "powering-off"].includes(lastPowerReceipt.lastStatus)) {
        observedCurrentRequest = true;
      } else if (lastPowerReceipt.lastStatus === "failed" && observedCurrentRequest) {
        clearResetTimer();
        pending = null;
        observedCurrentRequest = false;
        messageId = "power.controls.failed";
        render();
      }
    } else if (pending === null && lastPowerReceipt?.lastStatus === "failed") {
      // The Surface can have restarted after Guardian aborted a power request.
      // Reflect its durable failure instead of claiming the host is still busy.
      messageId = "power.controls.failed";
      render();
    }
  });
  const unsubscribeLocalization = localization.subscribe(() => render());
  render();

  return Object.freeze({
    destroy() {
      destroyed = true;
      actionOrdinal += 1;
      clearResetTimer();
      unsubscribeLocalization?.();
      unsubscribePowerStatus?.();
      unsubscribe?.();
      root.removeEventListener("click", onRootClick);
      root.removeEventListener("keydown", onRootKeyDown);
      overlay.remove();
      toggle.remove();
    },
  });
}
