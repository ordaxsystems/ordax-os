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

// Managed window identity is derived from the same destination owner as labels.
// Auxiliary panels are not destinations and retain their independent titles.
const managedWindowTitles = new Map();
for (const entry of entries) {
  for (const alias of [entry.label, entry.windowTitle]) {
    const previous = managedWindowTitles.get(alias);
    if (previous !== undefined && previous !== entry.windowTitle) {
      throw new Error(`Conflicting Surface window alias: ${alias}`);
    }
    managedWindowTitles.set(alias, entry.windowTitle);
  }
}

// Historic windows/shortcuts focus the one Spaces destination; no alias appears
// as a second item in the rail or application catalog.
managedWindowTitles.set('Perfis profissionais', 'Espaços');
managedWindowTitles.set('Professional profiles', 'Espaços');

export const SURFACE_DESTINATIONS = Object.freeze(
  Object.fromEntries(entries.map(entry => [entry.id, Object.freeze({ ...entry })])),
);

export const SURFACE_DESTINATION_IDS = Object.freeze(entries.map(entry => entry.id));

export function getSurfaceDestination(id) {
  const destination = Object.hasOwn(SURFACE_DESTINATIONS, id) ? SURFACE_DESTINATIONS[id] : undefined;
  if (!destination) throw new TypeError(`Unknown Surface destination: ${id}`);
  return destination;
}

export function getSurfaceWindowTitle(id) {
  return getSurfaceDestination(id).windowTitle;
}

/** Resolve a canonical label or title without inventing auxiliary destinations. */
export function resolveSurfaceWindowTitle(title) {
  if (typeof title !== 'string') throw new TypeError('Invalid Surface window title');
  return managedWindowTitles.get(title) ?? title;
}
