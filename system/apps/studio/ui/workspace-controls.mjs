import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { createStudioLocalization } from "../i18n.mjs";

const EXTENSION_SELECTOR = '[data-app-extension="studio-workspace"]';
const WORKSPACE_SELECTOR = '[data-studio-workspace="true"]';

function runtimeStateMessageId(state) {
  if (state === "ready") return "studio.runtime.ready";
  if (state === "degraded") return "studio.runtime.degraded";
  return "studio.runtime.disconnected";
}

function metric(documentObject, label, value) {
  const item = documentObject.createElement("div");
  const strong = documentObject.createElement("strong");
  strong.textContent = String(value);
  const span = documentObject.createElement("span");
  span.textContent = label;
  item.append(strong, span);
  return item;
}

function buildWorkspace(documentObject, status, localization) {
  const t = localization.translate;
  const workspace = documentObject.createElement("div");
  workspace.dataset.studioWorkspace = "true";
  workspace.dataset.studioLocale = localization.getLocale();
  workspace.className = "ordax-studio-workspace";

  const heading = documentObject.createElement("div");
  heading.className = "ordax-studio-runtime-state";
  heading.textContent = t(runtimeStateMessageId(status.state));
  heading.dataset.state = status.state;
  workspace.append(heading);

  const metrics = documentObject.createElement("div");
  metrics.className = "ordax-studio-metrics";
  metrics.append(
    metric(documentObject, t("studio.metrics.capabilities"), status.capabilityCount),
    metric(documentObject, t("studio.metrics.read"), status.readCount),
    metric(documentObject, t("studio.metrics.write"), status.writeCount),
  );
  workspace.append(metrics);

  const security = documentObject.createElement("p");
  security.className = "ordax-studio-security-note";
  security.textContent = t("studio.security.readOnly");
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
  const localization = createStudioLocalization(lifecycle.localization);
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
    const existing = extension.querySelector(WORKSPACE_SELECTOR);
    const locale = localization.getLocale();
    if (existing?.dataset.studioLocale === locale) {
      mountedWorkspace = existing;
      return;
    }
    existing?.remove();
    mountedWorkspace = buildWorkspace(documentObject, status, localization);
    extension.append(mountedWorkspace);
  };

  const unsubscribeLocalization = localization.subscribe(() => render());
  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeLocalization();
      mountedWorkspace?.remove();
      mountedWorkspace = null;
    },
  });
}
