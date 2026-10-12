import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { createPreferenceRuntime } from '../../../../services/preferences/runtime.mjs';
import { ACCESSIBILITY_CONTRAST_PREFERENCE_ID, ACCESSIBILITY_MOTION_PREFERENCE_ID, ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID } from '../../../../services/preferences/accessibility.mjs';
import { APPEARANCE_PREFERENCE_ID } from '../../../../services/preferences/appearance.mjs';

type Preferences = ReturnType<typeof createPreferenceRuntime>;
const PreferencesContext = createContext<Preferences | null>(null);

export function WebPreferencesProvider({ port, children }: { port: Preferences; children: ReactNode }) {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const theme = snapshot[APPEARANCE_PREFERENCE_ID] === 'dark' ? 'dark' : 'light';
  const contrast = String(snapshot[ACCESSIBILITY_CONTRAST_PREFERENCE_ID]);
  const motion = String(snapshot[ACCESSIBILITY_MOTION_PREFERENCE_ID]);
  const textScale = String(snapshot[ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const attributes = { 'data-theme': theme, 'data-ordax-theme': theme, 'data-ordax-contrast': contrast, 'data-ordax-motion': motion, 'data-ordax-text-scale': textScale };
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
  }, [theme, contrast, motion, textScale]);
  return <PreferencesContext.Provider value={port}>{children}</PreferencesContext.Provider>;
}

export function useWebPreferences() {
  const port = useContext(PreferencesContext);
  if (port === null) throw new Error('Web preferences composition is missing');
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const persistence = useSyncExternalStore(port.subscribe, port.getPersistenceSnapshot, port.getPersistenceSnapshot);
  const theme: 'light' | 'dark' = snapshot[APPEARANCE_PREFERENCE_ID] === 'dark' ? 'dark' : 'light';
  const preferences = port;
  function toggleTheme() {
    const next = preferences.getSnapshot()[APPEARANCE_PREFERENCE_ID] === 'dark' ? 'light' : 'dark';
    preferences.set(APPEARANCE_PREFERENCE_ID, next);
  }
  return { theme, persistence, toggleTheme, snapshot, setPreference: port.set };
}
