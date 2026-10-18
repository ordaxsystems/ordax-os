import { useEffect, useRef } from 'react';
import { useWebPreferences } from '../central/preferences-context';
import { useStoreCatalogPort } from './catalog-context';
import { mountStoreExperience } from '../../../ui/store-experience.mjs';
import { createStoreViewLifecycle } from '../../../ui/store-view-lifecycle.mjs';
import { createSurfaceLocalization } from '../../../../services/i18n/surface.mjs';
import template from './presentation/template.html?raw';
import styles from './presentation/styles.css?inline';
import tokens from '../../../ui/meridian.tokens.css?inline';
import '../../../ui/store.css';
import '../../../ui/store-experience.css';
import { ACCESSIBILITY_CONTRAST_PREFERENCE_ID, ACCESSIBILITY_MOTION_PREFERENCE_ID } from '../../../../services/preferences/accessibility.mjs';

const presentationAssets = { template, styles, tokens };

/** Web composes the same Store as Native; availability comes only from its port. */
export function StoreExperience({ onOpenApp: _onOpenApp }: { onOpenApp?: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<ReturnType<typeof mountStoreExperience> | null>(null);
  const catalogPort = useStoreCatalogPort();
  const { preferences, theme, snapshot } = useWebPreferences();
  useEffect(() => {
    if (!host.current) return;
    const localization = createSurfaceLocalization(preferences);
    const surfaceLifecycle = createStoreViewLifecycle(localization);
    const store = mountStoreExperience(host.current, { catalogPort, surfaceLifecycle, presentationAssets });
    instance.current = store;
    return () => { store.destroy(); instance.current = null; localization.dispose(); };
  }, [catalogPort, preferences]);
  useEffect(() => { instance.current?.setMaterial(theme === 'dark' ? 'ink' : 'paper'); }, [theme, catalogPort, preferences]);
  return <div ref={host} data-store-shared="true" data-ordax-contrast={String(snapshot[ACCESSIBILITY_CONTRAST_PREFERENCE_ID])} data-ordax-motion={String(snapshot[ACCESSIBILITY_MOTION_PREFERENCE_ID])} aria-label="Loja OrdaX"/>;
}
