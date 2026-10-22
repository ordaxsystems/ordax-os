import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { updateIsAlerting } from "../../services/update/presentation.mjs";

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountUpdateControls(root, updatePort, appActivation, surfaceLifecycle) {
  if (!(root instanceof Element)) {
    throw new TypeError("Update controls root must be a DOM Element");
  }
  if (!updatePort || typeof updatePort.subscribe !== "function" || typeof updatePort.getSnapshot !== "function") {
    throw new TypeError("Update controls require a native update watcher port");
  }
  const activationPort = assertAppActivationPort(appActivation);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;

  const documentObject = root.ownerDocument;
  const slot = root.querySelector("[data-update-slot]");
  if (!slot) {
    throw new Error("Surface update controls require the shared shell update slot");
  }

  const button = node(documentObject, "button", "meridian-rail-update-button");
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4"/><path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>';
  button.type = "button";
  button.dataset.updateOpenSystem = "";
  button.setAttribute("aria-label", t("system.updateShortcut.aria"));
  slot.append(button);

  let snapshot = updatePort.getSnapshot();

  const render = () => {
    const alerting = updateIsAlerting(snapshot);
    button.setAttribute("aria-label", t("system.updateShortcut.aria"));
    button.dataset.alerting = String(alerting);
    button.title = t(
      snapshot?.bootRefreshRequired
        ? "system.updateShortcut.title.basePending"
        : alerting
          ? "system.updateShortcut.title.attention"
          : "system.updateShortcut.title.normal",
    );
  };

  const onClick = (event) => {
    const target = event.target.closest("[data-update-open-system]");
    if (!target || !root.contains(target)) return;
    activationPort.publish({ appId: "system", target: "updates" });
  };

  root.addEventListener("click", onClick);
  const unsubscribe = updatePort.subscribe((nextSnapshot) => {
    snapshot = nextSnapshot;
    render();
  });
  const unsubscribeLocalization = localization.subscribe(() => render());
  render();

  return Object.freeze({
    destroy() {
      unsubscribeLocalization?.();
      unsubscribe?.();
      root.removeEventListener("click", onClick);
      button.remove();
    },
  });
}
