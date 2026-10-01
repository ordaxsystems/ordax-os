const EXTENSION_SELECTOR = '[data-app-extension="studio-workspace"]';

function text(state) {
  if (state === "ready") return "Device Agent pronto";
  if (state === "degraded") return "Device Agent degradado";
  return "Runtime ainda não conectado";
}

export function mountStudioWorkspaceControls(
  root,
  status,
  surfaceLifecycle = null,
) {
  const extension = root?.querySelector?.(EXTENSION_SELECTOR);
  if (!extension) throw new TypeError("Studio workspace extension is missing");

  const existing = extension.querySelector('[data-studio-workspace="true"]');
  existing?.remove();

  const documentObject = extension.ownerDocument;
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

  extension.append(workspace);
  surfaceLifecycle?.requestLayout?.();

  let destroyed = false;
  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      workspace.remove();
      surfaceLifecycle?.requestLayout?.();
    },
  });
}
