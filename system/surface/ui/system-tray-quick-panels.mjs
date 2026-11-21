const PANEL_SELECTOR = "[data-quick-panel]";

export function mountSystemTrayQuickPanels(root) {
  if (!(root instanceof Element)) {
    throw new TypeError("System tray quick panels require a Surface root Element");
  }

  const panels = Array.from(root.querySelectorAll(PANEL_SELECTOR));
  const triggers = Array.from(root.querySelectorAll("[data-quick-panel-toggle]"));
  if (panels.length === 0 || triggers.length === 0) {
    throw new Error("System tray quick panels require triggers and panels");
  }

  let activeId = null;
  let restoreFocus = null;

  const panelFor = (id) =>
    panels.find((panel) => panel.dataset.quickPanel === id) ?? null;

  const triggerFor = (id) =>
    triggers.find((trigger) => trigger.dataset.quickPanelToggle === id) ?? null;

  const usableTrigger = (trigger) =>
    trigger instanceof HTMLElement
    && trigger.isConnected
    && !trigger.hidden
    && !trigger.disabled
    && !trigger.closest("[hidden]");

  const close = ({ restore = true } = {}) => {
    if (activeId === null) return;
    const previousId = activeId;
    activeId = null;
    const panel = panelFor(previousId);
    const trigger = triggerFor(previousId);
    if (panel) {
      panel.dispatchEvent(new CustomEvent("ordax:quick-panel-close", { bubbles: false }));
      panel.hidden = true;
      panel.dataset.open = "false";
    }
    trigger?.setAttribute("aria-expanded", "false");
    if (restore) {
      if (usableTrigger(restoreFocus)) {
        restoreFocus.focus({ preventScroll: true });
      } else {
        // A tray item can disappear while its panel is open (e.g. battery
        // detection). Never move keyboard focus to a hidden or removed item.
        root.querySelector("[data-workspace]")?.focus({ preventScroll: true });
      }
    }
    restoreFocus = null;
  };

  const open = (id, trigger) => {
    const panel = panelFor(id);
    if (!panel || !usableTrigger(trigger)) return;
    if (activeId === id) {
      close();
      return;
    }
    close({ restore: false });
    activeId = id;
    restoreFocus = trigger instanceof HTMLElement ? trigger : null;
    panel.hidden = false;
    panel.dataset.open = "true";
    triggerFor(id)?.setAttribute("aria-expanded", "true");
    panel.dispatchEvent(new CustomEvent("ordax:quick-panel-open", { bubbles: false }));
    const focusTarget = panel.querySelector("[data-quick-panel-autofocus], button, input");
    focusTarget?.focus?.();
  };

  const onClick = (event) => {
    const trigger = event.target.closest("[data-quick-panel-toggle]");
    if (trigger && root.contains(trigger)) {
      event.preventDefault();
      event.stopPropagation();
      open(trigger.dataset.quickPanelToggle, trigger);
      return;
    }

    const closeButton = event.target.closest("[data-quick-panel-close]");
    if (closeButton && root.contains(closeButton)) {
      event.preventDefault();
      close();
      return;
    }

    if (
      activeId !== null
      && !event.target.closest(PANEL_SELECTOR)
      && !event.target.closest("[data-quick-panel-toggle]")
    ) {
      close({ restore: false });
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape" && activeId !== null) {
      const panel = panelFor(activeId);
      const trigger = triggerFor(activeId);
      // Another overlay (notably Ctrl+K or the launcher) may have keyboard
      // focus while a tray panel is still open. Do not close it or steal focus.
      if (!panel?.contains(event.target) && !trigger?.contains(event.target)) return;
      event.preventDefault();
      close();
    }
  };

  root.addEventListener("click", onClick, true);
  root.addEventListener("keydown", onKeyDown);

  return Object.freeze({
    close,
    destroy() {
      close({ restore: false });
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("keydown", onKeyDown);
    },
  });
}
