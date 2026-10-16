import { IntegrationNote } from '../central/integration-note';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useWebPreferences } from '../central/preferences-context';
import { OfficialStoreExperience } from './store';
import { useStoreCatalog } from './catalog-context';
import { mountStorePresentation } from './presentation/app.js';
import template from './presentation/template.html?raw';
import styles from './presentation/styles.css?inline';
import tokens from '../../../ui/meridian.tokens.css?inline';
import { ACCESSIBILITY_CONTRAST_PREFERENCE_ID, ACCESSIBILITY_MOTION_PREFERENCE_ID } from '../../../../services/preferences/accessibility.mjs';

/** The same tested presentation as /store-preview; no iframe, hash or host authority. */
function StorePresentation() {
  const host = useRef<HTMLDivElement>(null);
  const presentation = useRef<ReturnType<typeof mountStorePresentation> | null>(null);
  const { theme, snapshot } = useWebPreferences();
  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    // CSS comes exclusively from the bundled presentation owners. Constructed
    // sheets scope it to this root without injecting CSP-blocked style elements.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${tokens}\n${styles}`);
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = template;
    const instance = mountStorePresentation(root, { embedded: true });
    presentation.current = instance;
    return () => { instance.destroy(); presentation.current = null; };
  }, []);
  useEffect(() => { presentation.current?.setMaterial(theme === 'dark' ? 'ink' : 'paper'); }, [theme]);
  return <div ref={host} className="meridian-store-presentation" data-ordax-contrast={String(snapshot[ACCESSIBILITY_CONTRAST_PREFERENCE_ID])} data-ordax-motion={String(snapshot[ACCESSIBILITY_MOTION_PREFERENCE_ID])} aria-label="Demonstração da Loja OrdaX"/>;
}

export function StoreExperience({ onOpenApp }: { onOpenApp?: (id: string) => void }) {
  const snapshot = useStoreCatalog();
  const [mode, setMode] = useState<'planned' | 'official'>(() => snapshot.state === 'ready' ? 'official' : 'planned');
  const [visited, setVisited] = useState(() => snapshot.state !== 'ready');
  return <div className="meridian-store" data-store-mode={mode}>
    <div className="meridian-store-context"><span><strong>{mode === 'planned' ? 'Loja · visão planejada' : 'Loja · catálogo real'}</strong><small>{mode === 'planned' ? 'Exemplos preservados para evolução. Ações somente nesta demonstração.' : 'Disponibilidade recebida do serviço oficial.'}</small></span><Button variant="outline" onClick={() => { setVisited(true); setMode(mode === 'planned' ? 'official' : 'planned'); }}>{mode === 'planned' ? 'Consultar catálogo real' : 'Ver recursos planejados'}</Button></div>
    {mode === 'planned' && <IntegrationNote area="store"/>}
    <div hidden={mode !== 'planned'} className="meridian-store-content">{visited && <StorePresentation/>}</div>
    {mode === 'official' && <OfficialStoreExperience onOpenApp={onOpenApp}/>}
  </div>;
}
