import { APPEARANCE_PREFERENCE_ID, appearancePreference } from './appearance.mjs';

export const WEB_PALETTE_PREFERENCE_ID = 'surface.web-palette';
export const WEB_COLOR_THEME_OPTIONS = Object.freeze([
  ...appearancePreference.options,
  Object.freeze({ value: 'native', label: 'OrdaX USB' }),
]);

// A presentation palette, independent of the existing portable light/dark mode.
// Native already consumes its own tokens and ignores this Web presentation choice.
export const webPalettePreference = Object.freeze({
  id: WEB_PALETTE_PREFERENCE_ID,
  sectionId: 'workspace',
  label: 'Cores do Web',
  title: 'Paleta de cores do Web',
  description: 'Use a aparência atual ou as cores oficiais da interface USB.',
  defaultValue: 'standard',
  validate(value) {
    if (value !== 'standard' && value !== 'native') {
      throw new TypeError('Unsupported Web color palette: ' + String(value));
    }
    return value;
  },
});

export function resolveWebAppearance(snapshot) {
  if (snapshot[WEB_PALETTE_PREFERENCE_ID] === 'native') {
    return Object.freeze({ colorTheme: 'native', scheme: 'dark' });
  }
  const scheme = snapshot[APPEARANCE_PREFERENCE_ID] === 'dark' ? 'dark' : 'light';
  return Object.freeze({ colorTheme: scheme, scheme });
}

export function selectWebColorTheme(preferences, value) {
  if (!WEB_COLOR_THEME_OPTIONS.some(option => option.value === value)) {
    throw new TypeError('Unsupported Web color theme: ' + String(value));
  }
  if (value !== 'native') preferences.set(APPEARANCE_PREFERENCE_ID, value);
  preferences.set(WEB_PALETTE_PREFERENCE_ID, value === 'native' ? 'native' : 'standard');
}
