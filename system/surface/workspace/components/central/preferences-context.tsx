import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { createPreferenceRuntime } from '../../../../services/preferences/runtime.mjs';
import { APPEARANCE_PREFERENCE_ID } from '../../../../services/preferences/appearance.mjs';

type Preferences = ReturnType<typeof createPreferenceRuntime>;
const PreferencesContext = createContext<Preferences | null>(null);

export function WebPreferencesProvider({ port, children }: { port: Preferences; children: ReactNode }) {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const theme = snapshot[APPEARANCE_PREFERENCE_ID] === 'dark' ? 'dark' : 'light';
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    const previousScheme = root.style.colorScheme;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    return () => {
      if (previousTheme === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previousTheme);
      root.style.colorScheme = previousScheme;
    };
  }, [theme]);
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
  return { theme, persistence, toggleTheme };
}
