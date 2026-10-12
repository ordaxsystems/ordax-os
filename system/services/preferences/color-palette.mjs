import { APPEARANCE_PREFERENCE_ID, appearancePreference } from './appearance.mjs';

export const COLOR_PALETTE_PREFERENCE_ID = 'surface.color-palette';
export const COLOR_THEME_OPTIONS = Object.freeze([
  ...appearancePreference.options,
  Object.freeze({ value: 'native', label: 'OrdaX USB' }),
]);

// One presentation palette for Web and Native, independent of portable light/dark.
export const colorPalettePreference = Object.freeze({
  id: COLOR_PALETTE_PREFERENCE_ID,
  sectionId: 'workspace',
  label: 'Cores da Surface',
  title: 'Paleta de cores da Surface',
  description: 'Escolha Claro, Escuro ou as cores oficiais OrdaX USB.',
  defaultValue: 'standard',
  validate(value) {
    if (value !== 'standard' && value !== 'native') {
      throw new TypeError('Unsupported Surface color palette: ' + String(value));
    }
    return value;
  },
});

export function resolveColorAppearance(snapshot) {
  if (snapshot[COLOR_PALETTE_PREFERENCE_ID] === 'native') {
    return Object.freeze({ colorTheme: 'native', scheme: 'dark' });
  }
  const scheme = snapshot[APPEARANCE_PREFERENCE_ID] === 'dark' ? 'dark' : 'light';
  return Object.freeze({ colorTheme: scheme, scheme });
}

export function selectColorTheme(preferences, value) {
  if (!COLOR_THEME_OPTIONS.some(option => option.value === value)) {
    throw new TypeError('Unsupported Surface color theme: ' + String(value));
  }
  if (value !== 'native') preferences.set(APPEARANCE_PREFERENCE_ID, value);
  preferences.set(COLOR_PALETTE_PREFERENCE_ID, value === 'native' ? 'native' : 'standard');
}
