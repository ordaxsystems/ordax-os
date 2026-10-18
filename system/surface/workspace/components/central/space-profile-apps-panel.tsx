import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { projectSelectedSpaceProfileStoreApps } from '../../../../services/spaces/selected-profile-store-apps.mjs';
import { useWebAccount } from './account-context';
import { useProfileCatalogReader, type ProfileEntry } from './profile-catalog-context';
import { useStoreCatalog } from '../store/catalog-context';
import { ProfileStoreAppRows } from './profile-store-app-rows';
import './space-profile-apps-panel.css';

type CatalogRead = { key: string; entries: readonly ProfileEntry[] };

// Account selection is the only source of the active Space; no local Space/app registry.
export function SpaceProfileAppsPanel({ onOpen }: { onOpen: (title: string) => void }) {
  const { authorized, identity, offline } = useWebAccount();
  const readCatalog = useProfileCatalogReader();
  const storeSnapshot = useStoreCatalog();
  const space = authorized.activeSpace;
  // Scope the asynchronous read to the subject AND selected Space/profile identity.
  const key = space && identity.state === 'signed-in'
    ? `${identity.subjectId}:${space.id}:${space.profilePack ?? ''}` : null;
  const [read, setRead] = useState<CatalogRead | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRead(null);
    setFailedKey(null);
    if (!key || !space?.profilePack || offline) return () => controller.abort();
    if (!readCatalog) {
      setFailedKey(key);
      return () => controller.abort();
    }
    void readCatalog(controller.signal).then(result => {
      if (!controller.signal.aborted) setRead({ key, entries: result.entries });
    }).catch(() => {
      if (!controller.signal.aborted) setFailedKey(key);
    });
    return () => controller.abort();
  }, [key, readCatalog, attempt, offline]);

  if (!space) return null;

  let view: ReturnType<typeof projectSelectedSpaceProfileStoreApps> | null = null;
  let invalid = false;
  if (!offline && space.profilePack && read?.key === key && key !== null) {
    try {
      view = projectSelectedSpaceProfileStoreApps({
        space, profileEntries: read.entries, storeSnapshot,
      });
    } catch {
      // A corrupt catalog or Store snapshot cannot be used as a positive observation.
      invalid = true;
    }
  }
  const failed = key !== null && (failedKey === key || invalid);
  return <section className="meridian-space-profile-apps" aria-labelledby="space-profile-apps-title">
    <header><div><small>COMPOSIÇÃO DO SPACE EM USO</small><h3 id="space-profile-apps-title">Aplicativos de {space.name}</h3></div>
      <Button variant="outline" onClick={() => onOpen('Loja')}>Consultar Loja</Button>
    </header>
    <p>Referências do Profile vinculado ao Space. A Loja informa estados do dispositivo quando disponíveis; isso não comprova ativação, acesso ou instalação específica neste Space.</p>
    {space.profilePack === null ? <p role="status">Este Space não possui Profile Pack vinculado. Não há aplicativos de composição a apresentar.</p>
      : offline ? <p role="status">Sem conexão. Não é possível confirmar a composição e o estado dos aplicativos agora.</p>
      : failed ? <div role="alert"><p>Não foi possível confirmar a composição ou os estados da Loja. Nenhum aplicativo foi presumido instalado.</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button></div>
      : view === null ? <p role="status">Consultando o Profile vinculado a este Space…</p>
      : view.state === 'profile-unavailable' ? <p role="status">O Profile vinculado não está publicado nesta consulta. Nenhum aplicativo foi inferido.</p>
      : view.state !== 'ready' ? <p role="status">A composição deste Space está indisponível.</p>
      : <div>
        <p className="meridian-space-profile-title">Profile publicado: <strong>{view.profileTitle}</strong></p>
        {view.entries.length === 0 ? <p role="status">Esta composição não referencia aplicativos.</p>
          : <ProfileStoreAppRows entries={view.entries}/>}
        {view.storeState === 'unavailable' && <p role="status">O catálogo oficial da Loja está indisponível. Os estados dos aplicativos permanecem desconhecidos.</p>}
      </div>}
  </section>;
}
