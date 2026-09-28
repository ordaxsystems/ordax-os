import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { assertIntelligenceContextSharePort } from "../../contracts/intelligence-context-share.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { assertWorkspaceStore } from "../../contracts/workspace-store.mjs";
import { getDefaultIntelligenceContextSharingRuntime } from "../../services/intelligence/context-sharing-runtime.mjs";
import {
  createWorkspaceSelectionIntelligenceHandoff,
  offerWorkspaceSelectionToIntelligence,
} from "../../services/intelligence/workspace-selection-share.mjs";

const SYSTEM_WINDOW_SELECTOR = '[data-window-id="system"]';
const SYSTEM_INTELLIGENCE_ACTION_SELECTOR = "[data-system-intelligence-explain]";
const ACTION_SELECTOR = "[data-system-intelligence-workspace-action]";

export function mountWorkspaceIntelligenceHandoffControls(
  root,
  workspaceStoreValue,
  appActivationValue,
  surfaceLifecycleValue,
  { intelligenceContextShare = null } = {},
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Workspace Intelligence handoff controls require a Surface root");
  }

  const workspaceStore = assertWorkspaceStore(workspaceStoreValue);
  const activation = assertAppActivationPort(appActivationValue);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycleValue);
  const contextShare = assertIntelligenceContextSharePort(
    intelligenceContextShare ?? getDefaultIntelligenceContextSharingRuntime().share,
  );
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;

  let destroyed = false;
  let pending = false;
  let renderQueued = false;

  const systemWindow = () => root.querySelector(SYSTEM_WINDOW_SELECTOR);

  const revokeShared = (shared) => {
    if (!shared) return;
    try {
      const authorization = contextShare.take({
        sourceAppId: "system",
        target: shared.target,
      });
      if (authorization) contextShare.revoke(authorization);
    } catch {
      // The grant is short-lived and one-shot; cleanup must not mask the original failure.
    }
  };

  const scheduleRender = () => {
    if (destroyed || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      render();
    });
  };

  const render = () => {
    if (destroyed) return;
    const windowNode = systemWindow();
    const intelligenceAction = windowNode?.querySelector(SYSTEM_INTELLIGENCE_ACTION_SELECTOR) ?? null;
    let action = windowNode?.querySelector(ACTION_SELECTOR) ?? null;

    if (!windowNode || !intelligenceAction) {
      action?.remove();
      return;
    }

    if (!action) {
      action = documentObject.createElement("button");
      action.type = "button";
      action.className = "ordax-system-button ordax-system-intelligence-action";
      action.dataset.systemIntelligenceWorkspaceAction = "";
      intelligenceAction.insertAdjacentElement("afterend", action);
    }

    const label = `↗  ${t("intelligence.chat.modePlan")} · ${t("app.intelligence.title")}`;
    if (action.textContent !== label) action.textContent = label;
    action.title = t("intelligence.plan.nonExecutableShort");
    action.disabled = pending;
    action.setAttribute("aria-busy", String(pending));
  };

  const openWorkspacePlan = () => {
    if (pending || destroyed) return;
    let shared = null;
    pending = true;
    render();

    try {
      const workspace = workspaceStore.load();
      shared = offerWorkspaceSelectionToIntelligence(contextShare, workspace);
      activation.publish({
        appId: "intelligence",
        target: createWorkspaceSelectionIntelligenceHandoff(shared),
      });
      shared = null;
    } catch (error) {
      revokeShared(shared);
      shared = null;
      console.warn("OrdaX workspace Intelligence handoff failed", error);
    } finally {
      pending = false;
      render();
    }
  };

  const onClick = (event) => {
    const action = event.target?.closest?.(ACTION_SELECTOR);
    if (!action || !root.contains(action)) return;
    openWorkspacePlan();
  };

  const observer = new MutationObserver(scheduleRender);
  observer.observe(root, { childList: true, subtree: true });
  const unsubscribeRender = lifecycle.subscribeRender(scheduleRender);
  const unsubscribeLocalization = localization.subscribe(scheduleRender);
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      unsubscribeLocalization();
      unsubscribeRender();
      root.removeEventListener("click", onClick);
      systemWindow()?.querySelector(ACTION_SELECTOR)?.remove();
    },
  });
}
