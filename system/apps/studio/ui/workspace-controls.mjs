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

  const title = documentObject.createElement("h3");
  title.textContent = t("studio.workspace.title");
  workspace.append(title);
  for (const id of ["studio.workspace.availability", "studio.workspace.web"]) {
    const paragraph = documentObject.createElement("p");
    paragraph.className = "ordax-studio-availability";
    paragraph.textContent = t(id);
    workspace.append(paragraph);
  }
  const actions = documentObject.createElement("nav");
  actions.className = "ordax-studio-actions";
  const projects = documentObject.createElement("button");
  projects.type = "button";
  projects.dataset.launchApp = "projects";
  projects.textContent = t("studio.workspace.projects");
  const chatgpt = documentObject.createElement("a");
  chatgpt.href = "https://chatgpt.com/";
  chatgpt.target = "_blank";
  chatgpt.rel = "noopener noreferrer";
  chatgpt.textContent = t("studio.workspace.chatgpt");
  actions.append(projects, chatgpt);
  workspace.append(actions);

  const diagnostics = documentObject.createElement("details");
  const summary = documentObject.createElement("summary");
  summary.textContent = t("studio.workspace.diagnostics");
  diagnostics.append(summary);

  const heading = documentObject.createElement("div");
  heading.className = "ordax-studio-runtime-state";
  heading.textContent = t(statusMessageId(status.state));
  heading.dataset.state = status.state;
  diagnostics.append(heading);

  const metrics = documentObject.createElement("div");
  metrics.className = "ordax-studio-metrics";
  metrics.innerHTML = [
    [t("studio.workspace.metric.capabilities"), status.capabilityCount],
    [t("studio.workspace.metric.read"), status.readCount],
    [t("studio.workspace.metric.write"), status.writeCount],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  if (status.state !== "unavailable") diagnostics.append(metrics);
  else {
    const unavailable = documentObject.createElement("p");
    unavailable.textContent = t("studio.workspace.noReader");
    diagnostics.append(unavailable);
  }

  const security = documentObject.createElement("p");
  security.className = "ordax-studio-security-note";
  security.textContent = t("studio.workspace.security.readOnly");
  diagnostics.append(security);
  workspace.append(diagnostics);
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
