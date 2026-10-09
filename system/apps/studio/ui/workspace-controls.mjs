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

  const header = documentObject.createElement("header");
  header.className = "ordax-studio-intro";
  const connection = documentObject.createElement("span");
  connection.className = "ordax-studio-connection";
  connection.dataset.state = status.state;
  connection.textContent = t(statusMessageId(status.state));
  header.append(connection);
  const title = documentObject.createElement("h3");
  title.textContent = t("studio.workspace.title");
  header.append(title);
  for (const id of ["studio.workspace.intro", "studio.workspace.availability"]) {
    const paragraph = documentObject.createElement("p");
    paragraph.className = "ordax-studio-availability";
    paragraph.textContent = t(id);
    header.append(paragraph);
  }
  workspace.append(header);
  const actions = documentObject.createElement("nav");
  actions.className = "ordax-studio-actions";
  actions.setAttribute("aria-label", t("studio.workspace.actions"));
  const projects = documentObject.createElement("button");
  projects.type = "button";
  projects.dataset.launchApp = "projects";
  projects.dataset.studioFocus = "projects";
  const chatgpt = documentObject.createElement("a");
  chatgpt.href = "https://chatgpt.com/";
  chatgpt.target = "_blank";
  chatgpt.rel = "noopener noreferrer";
  chatgpt.dataset.studioFocus = "chatgpt";
  for (const [action, name, pathData] of [
    [projects, "projects", "M3 7V5h6l2 2h10v12H3V7Z"],
    [chatgpt, "chatgpt", "M7 17 17 7M7 7h10v10"],
  ]) {
    const mark = documentObject.createElementNS("http://www.w3.org/2000/svg", "svg");
    mark.setAttribute("class", "ordax-studio-action-icon");
    mark.setAttribute("viewBox", "0 0 24 24");
    mark.setAttribute("fill", "none");
    mark.setAttribute("stroke", "currentColor");
    mark.setAttribute("stroke-width", "1.5");
    mark.setAttribute("stroke-linejoin", "round");
    mark.setAttribute("focusable", "false");
    mark.setAttribute("aria-hidden", "true");
    const path = documentObject.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    mark.append(path);
    const copy = documentObject.createElement("span");
    copy.className = "ordax-studio-action-copy";
    const label = documentObject.createElement("strong");
    label.textContent = t(`studio.workspace.${name}`);
    const caption = documentObject.createElement("span");
    caption.textContent = t(`studio.workspace.${name}.description`);
    copy.append(label, caption);
    action.append(mark, copy);
  }
  actions.append(projects, chatgpt);
  workspace.append(actions);

  const supporting = documentObject.createElement("section");
  supporting.className = "ordax-studio-supporting";
  const about = documentObject.createElement("details");
  about.dataset.studioDisclosure = "about";
  const aboutSummary = documentObject.createElement("summary");
  aboutSummary.dataset.studioFocus = "about";
  aboutSummary.textContent = t("studio.workspace.about");
  const guidance = documentObject.createElement("p");
  guidance.textContent = t("studio.workspace.web");
  about.append(aboutSummary, guidance);
  supporting.append(about);
  const diagnostics = documentObject.createElement("details");
  diagnostics.dataset.studioDisclosure = "diagnostics";
  const summary = documentObject.createElement("summary");
  summary.dataset.studioFocus = "diagnostics";
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
  supporting.append(diagnostics);
  workspace.append(supporting);
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

  const render = (localeChanged = false) => {
    if (destroyed) return;
    const extension = root.querySelector(EXTENSION_SELECTOR);
    if (!extension) {
      mountedWorkspace = null;
      return;
    }
    const existing = extension.querySelector(WORKSPACE_SELECTOR);
    // Unrelated Surface renders must not collapse disclosures or steal focus.
    if (existing === mountedWorkspace && existing && !localeChanged) return;
    const previous = existing || mountedWorkspace;
    const focus = previous?.contains(documentObject.activeElement)
      ? documentObject.activeElement.dataset.studioFocus : null;
    const next = buildWorkspace(documentObject, status, localization);
    for (const disclosure of previous?.querySelectorAll("[data-studio-disclosure]") || []) {
      const replacement = next.querySelector(`[data-studio-disclosure="${disclosure.dataset.studioDisclosure}"]`);
      if (replacement) replacement.open = disclosure.open;
    }
    if (existing) existing.replaceWith(next);
    else extension.append(next);
    mountedWorkspace = next;
    if (focus) next.querySelector(`[data-studio-focus="${focus}"]`)?.focus({ preventScroll: true });
  };

  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  const unsubscribeLocale = localization.subscribe(() => render(true));
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
