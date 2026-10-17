// Canonical data-only destination identities for Surface consumers.
// Presentation layers own icons/layout; preference and navigation layers reuse these ids/labels.
const entries = [
  { id: 'projects', label: 'Projetos', windowTitle: 'Projetos' },
  { id: 'files', label: 'Arquivos', windowTitle: 'Arquivos' },
  { id: 'internet', label: 'Internet', windowTitle: 'Internet' },
  { id: 'store', label: 'Loja', windowTitle: 'Loja' },
  { id: 'intelligence', label: 'Inteligência', windowTitle: 'Aura' },
  { id: 'editor-3d', label: 'Editor 3D', windowTitle: 'Editor 3D' },
  { id: 'terminal', label: 'Terminal', windowTitle: 'Terminal' },
];

export const SURFACE_DESTINATIONS = Object.freeze(
  Object.fromEntries(entries.map(entry => [entry.id, Object.freeze({ ...entry })])),
);

export const SURFACE_DESTINATION_IDS = Object.freeze(entries.map(entry => entry.id));

export function getSurfaceDestination(id) {
  const destination = SURFACE_DESTINATIONS[id];
  if (!destination) throw new TypeError(`Unknown Surface destination: ${id}`);
  return destination;
}

export function getSurfaceWindowTitle(id) {
  return getSurfaceDestination(id).windowTitle;
}
