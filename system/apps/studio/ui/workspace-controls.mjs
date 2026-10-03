import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { translateStudioWorkspaceMessage } from "../../../services/i18n/studio-workspace.mjs";

const EXTENSION_SELECTOR = '[data-app-extension="studio-workspace"]';
const WORKSPACE_SELECTOR = '[data-studio-workspace="true"]';

function statusMessageId(state) {
  if (state === "ready") return "studio.workspace.status.ready";
  if (state === "degraded") return "studio.workspace.status.degraded";
  return "studio.workspace.status.unavailable";
}

function buildWorkspace(documentObject, status, localization) {
  const t = (messageId) => translateStudioWorkspaceMessage(localization, messageId);
  const workspace = documentObject.createElement("div");
  workspace.dataset.studioWorkspace = "true";
  workspace.className = "ordax-studio-workspace";

  const heading = documentObject.createElement("div");
  heading.className = "ordax-studio-runtime-state";
  heading.textContent = t(statusMessageId(status.state));
  heading.dataset.state = status.state;
  workspace.append(heading);

  const metrics = documentObject.createElement("div");
  metrics.className = "ordax-studio-metrics";
  metrics.innerHTML = [
    [t("studio.workspace.metric.capabilities"), status.capabilityCount],
    [t("studio.workspace.metric.read"), status.readCount],
    [t("studio.workspace.metric.write"), status.writeCount],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  workspace.append(metrics);

  const security = documentObject.createElement("p");
  security.className = "ordax-studio-security-note";
  security.textContent = t("studio.workspace.security.readOnly");
  workspace.append(security);
  return workspace;
}

export function mountStudioWorkspaceControls(
  root,
  status,
  surfaceLifecycle,
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Studio workspace requires a Surface root");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const documentObject = root.ownerDocument;
  let mountedWorkspace = null;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    const extension = root.querySelector(EXTENSION_SELECTOR);
    if (!extension) {
      mountedWorkspace = null;
      return;
    }
    const next = buildWorkspace(documentObject, status, localization);
    const existing = extension.querySelector(WORKSPACE_SELECTOR);
    if (existing) existing.replaceWith(next);
    else extension.append(next);
    mountedWorkspace = next;
  };

  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  const unsubscribeLocale = localization.subscribe(() => render());
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeLocale();
      unsubscribeRender();
      mountedWorkspace?.remove();
      mountedWorkspace = null;
    },
  });
}
