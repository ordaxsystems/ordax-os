import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";

const EXTENSION_SELECTOR = '[data-app-extension="studio-workspace"]';
const WORKSPACE_SELECTOR = '[data-studio-workspace="true"]';

function text(state) {
  if (state === "ready") return "Device Agent pronto";
  if (state === "degraded") return "Device Agent degradado";
  return "Runtime ainda não conectado";
}

function buildWorkspace(documentObject, status) {
  const workspace = documentObject.createElement("div");
  workspace.dataset.studioWorkspace = "true";
  workspace.className = "ordax-studio-workspace";

  const heading = documentObject.createElement("div");
  heading.className = "ordax-studio-runtime-state";
  heading.textContent = text(status.state);
  heading.dataset.state = status.state;
  workspace.append(heading);

  const metrics = documentObject.createElement("div");
  metrics.className = "ordax-studio-metrics";
  metrics.innerHTML = [
    ["Capabilities", status.capabilityCount],
    ["Leitura", status.readCount],
    ["Escrita", status.writeCount],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");
  workspace.append(metrics);

  const security = documentObject.createElement("p");
  security.className = "ordax-studio-security-note";
  security.textContent = "Descoberta somente-leitura. Autoridade de mutação: nenhuma.";
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
    if (existing) {
      mountedWorkspace = existing;
      return;
    }
    mountedWorkspace = buildWorkspace(documentObject, status);
    extension.append(mountedWorkspace);
  };

  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      mountedWorkspace?.remove();
      mountedWorkspace = null;
    },
  });
}
