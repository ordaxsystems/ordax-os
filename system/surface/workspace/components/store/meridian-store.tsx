import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useWebPreferences } from '../central/preferences-context';
import { OfficialStoreExperience } from './store';
import { useStoreCatalog } from './catalog-context';
import { mountStorePresentation } from './presentation/app.js';
import template from './presentation/template.html?raw';
import styles from './presentation/styles.css?inline';
import tokens from '../../../ui/meridian.tokens.css?inline';

/** The same tested presentation as /store-preview; no iframe, hash or host authority. */
function StorePresentation() {
  const host = useRef<HTMLDivElement>(null);
  const presentation = useRef<ReturnType<typeof mountStorePresentation> | null>(null);
  const { theme } = useWebPreferences();
  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${tokens}\n${styles}</style>${template}`;
    const instance = mountStorePresentation(root, { embedded: true });
    presentation.current = instance;
    return () => { instance.destroy(); presentation.current = null; };
  }, []);
  useEffect(() => { presentation.current?.setMaterial(theme === 'dark' ? 'ink' : 'paper'); }, [theme]);
  return <div ref={host} className="meridian-store-presentation" aria-label="Demonstração da Loja OrdaX"/>;
}

export function StoreExperience({ onOpenApp }: { onOpenApp?: (id: string) => void }) {
  const snapshot = useStoreCatalog();
  const [mode, setMode] = useState<'planned' | 'official'>(() => snapshot.state === 'ready' ? 'official' : 'planned');
  const [visited, setVisited] = useState(() => snapshot.state !== 'ready');
  return <div className="meridian-store" data-store-mode={mode}>
    <div className="meridian-store-context"><span><strong>{mode === 'planned' ? 'Loja · visão planejada' : 'Loja · catálogo real'}</strong><small>{mode === 'planned' ? 'Exemplos preservados para evolução. Ações somente nesta demonstração.' : 'Disponibilidade recebida do serviço oficial.'}</small></span><Button variant="outline" onClick={() => { setVisited(true); setMode(mode === 'planned' ? 'official' : 'planned'); }}>{mode === 'planned' ? 'Consultar catálogo real' : 'Ver recursos planejados'}</Button></div>
    <div hidden={mode !== 'planned'} className="meridian-store-content">{visited && <StorePresentation/>}</div>
    {mode === 'official' && <OfficialStoreExperience onOpenApp={onOpenApp}/>}
  </div>;
}
