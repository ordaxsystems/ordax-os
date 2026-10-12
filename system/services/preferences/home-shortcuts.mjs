// Surface presentation targets only: these IDs never assert installed apps or grants.
export const HOME_SHORTCUTS_PREFERENCE_ID = 'surface.favorite-shortcuts';
export const HOME_SHORTCUTS = Object.freeze([
  ['projects', 'Projetos'], ['files', 'Arquivos'], ['internet', 'Internet'],
  ['store', 'Loja'], ['intelligence', 'Inteligência'], ['editor-3d', 'Editor 3D'], ['terminal', 'Terminal'],
].map(([id, name]) => Object.freeze({ id, name })));
const ids = HOME_SHORTCUTS.map(shortcut => shortcut.id);
const allowed = new Set(ids);
const defaultValue = ids.join(',');

/** @param {unknown} value */
function validate(value) {
  if (typeof value !== 'string' || value.length > defaultValue.length) throw new TypeError('Invalid favorite shortcut selection');
  const selected = value === '' ? [] : value.split(',');
  if (new Set(selected).size !== selected.length || selected.some(id => !allowed.has(id))) throw new TypeError('Invalid favorite shortcut selection');
  // One canonical ordering, independent of removal/re-addition sequence.
  return ids.filter(id => selected.includes(id)).join(',');
}

export const homeShortcutsPreference = Object.freeze({
  id: HOME_SHORTCUTS_PREFERENCE_ID, sectionId: 'workspace', label: 'Central',
  title: 'Atalhos favoritos', description: 'Escolha atalhos da interface; isso não instala aplicativos.',
  defaultValue, validate,
});

/** @param {unknown} [value] */
export function readFavoriteShortcutIds(value = defaultValue) {
  const valid = validate(value);
  return Object.freeze(valid === '' ? [] : valid.split(','));
}

export function setFavoriteShortcutValue(value, id, included) {
  if (!allowed.has(id) || typeof included !== 'boolean') throw new TypeError('Invalid favorite shortcut change');
  const selected = new Set(readFavoriteShortcutIds(value));
  if (included) selected.add(id); else selected.delete(id);
  return ids.filter(id => selected.has(id)).join(',');
}
