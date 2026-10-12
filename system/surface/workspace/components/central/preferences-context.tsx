import { HOME_SHORTCUTS_PREFERENCE_ID, setFavoriteShortcutValue } from '../../../../services/preferences/home-shortcuts.mjs';
import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { createPreferenceRuntime } from '../../../../services/preferences/runtime.mjs';
import { ACCESSIBILITY_CONTRAST_PREFERENCE_ID, ACCESSIBILITY_MOTION_PREFERENCE_ID, ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID } from '../../../../services/preferences/accessibility.mjs';
import { resolveColorAppearance, selectColorTheme } from '../../../../services/preferences/color-palette.mjs';

type Preferences = ReturnType<typeof createPreferenceRuntime>;
const PreferencesContext = createContext<Preferences | null>(null);

export function WebPreferencesProvider({ port, children }: { port: Preferences; children: ReactNode }) {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const { colorTheme, scheme: theme } = resolveColorAppearance(snapshot);
  const contrast = String(snapshot[ACCESSIBILITY_CONTRAST_PREFERENCE_ID]);
  const motion = String(snapshot[ACCESSIBILITY_MOTION_PREFERENCE_ID]);
  const textScale = String(snapshot[ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const attributes = { 'data-theme': colorTheme, 'data-ordax-palette': colorTheme === 'native' ? 'native' : 'standard', 'data-ordax-theme': theme, 'data-ordax-contrast': contrast, 'data-ordax-motion': motion, 'data-ordax-text-scale': textScale };
    const previousAttributes = Object.keys(attributes).map(name => [name, root.getAttribute(name)] as const);
    const previousScheme = root.style.colorScheme;
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value);
    root.style.colorScheme = theme;
    return () => {
      for (const [name, value] of previousAttributes) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
      root.style.colorScheme = previousScheme;
    };
  }, [theme, colorTheme, contrast, motion, textScale]);
  return <PreferencesContext.Provider value={port}>{children}</PreferencesContext.Provider>;
}

export function useWebPreferences() {
  const port = useContext(PreferencesContext);
  if (port === null) throw new Error('Web preferences composition is missing');
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const persistence = useSyncExternalStore(port.subscribe, port.getPersistenceSnapshot, port.getPersistenceSnapshot);
  const appearance = resolveColorAppearance(snapshot);
  const theme: 'light' | 'dark' = appearance.scheme;
  const colorTheme = appearance.colorTheme;
  const preferences = port;
  function setColorTheme(value: string) {
    selectColorTheme(preferences, value);
  }
  function setFavoriteShortcut(id: string, included: boolean) {
    const value = preferences.getSnapshot()[HOME_SHORTCUTS_PREFERENCE_ID];
    preferences.set(HOME_SHORTCUTS_PREFERENCE_ID, setFavoriteShortcutValue(value, id, included));
  }
  return { theme, colorTheme, persistence, setColorTheme, snapshot, setPreference: port.set, setFavoriteShortcut };
}
