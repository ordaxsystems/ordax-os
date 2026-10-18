import { useEffect, useState } from 'react';
import type { validateSpace } from '../../../../contracts/spaces.mjs';
import { projectSpaceProfileStoreStatus } from '../../../../services/spaces/profile-store-status.mjs';
import { useStoreCatalog } from '../store/catalog-context';
import { storeAppStatusLabel } from '../store/app-status-labels';
import { useProfileCatalogReader, type ProfileEntry } from './profile-catalog-context';
import { useWebAccount } from './account-context';
import { Panel } from './primitives';
import { Button } from '@/components/ui/button';
import './space-profile-apps.css';

type Space = ReturnType<typeof validateSpace>;
type AppRow = Readonly<{
  appId: string;
  status: string;
  installedVersion: string | null;
  availableVersion: string | null;
}>;
type Projection = Readonly<{
  state: string;
  profile: string | null;
  profileVersion?: number;
  entries: readonly AppRow[];
}>;
type CatalogRead =
  | Readonly<{ state: 'loading' | 'failed'; entries: null }>
  | Readonly<{ state: 'ready'; entries: readonly ProfileEntry[] }>;

const EMPTY_PROFILES: readonly ProfileEntry[] = Object.freeze([]);

const projectionMessages: Readonly<Record<string, string>> = Object.freeze({
  'no-profile': 'Este Space não possui Profile Pack vinculado.',
  'profile-unpinned': 'O vínculo deste Space não informa uma versão do Profile Pack. Não é seguro selecionar uma versão automaticamente.',
  'profile-invalid-binding': 'A referência de Profile Pack deste Space é inválida.',
  'profile-not-listed': 'A versão vinculada não está publicada no catálogo de perfis desta versão.',
  'profile-kind-mismatch': 'O tipo deste Space não corresponde ao Profile Pack vinculado.',
});

export function SpaceProfileAppsStatus({ projection }: { projection: Projection }) {
  if (projection.state !== 'ready' && projection.state !== 'store-unavailable') {
    return <p role="status" className="service-state">{projectionMessages[projection.state] ?? 'Não foi possível verificar o vínculo de aplicativos deste Space.'}</p>;
  }
  return <>
    <p className="service-state">Composição vinculada: <strong>{projection.profile}</strong>. A Loja é a única autoridade para instalação e atualização.</p>
    {projection.state === 'store-unavailable' && <p role="status" className="service-state">Estado da Loja indisponível nesta sessão. Os aplicativos abaixo são referências do perfil; a instalação não pode ser confirmada.</p>}
    {projection.entries.length === 0
      ? <p className="service-state">Este Profile Pack não referencia aplicativos.</p>
      : <ul className="meridian-space-app-list">{projection.entries.map(app =>
          <li key={app.appId}>
            <span className="meridian-space-app-details">
              <strong>{app.appId}</strong>
              {(app.installedVersion || app.availableVersion) && <small>
                {app.installedVersion ? `Instalada: ${app.installedVersion}` : ''}
                {app.installedVersion && app.availableVersion ? ' · ' : ''}
                {app.availableVersion ? `Loja: ${app.availableVersion}` : ''}
              </small>}
            </span>
            <span className="meridian-space-app-state" data-state={app.status}>{storeAppStatusLabel(app.status)}</span>
          </li>,
        )}</ul>}
  </>;
}

function ActiveSpaceApps({ space }: { space: Space }) {
  const readCatalog = useProfileCatalogReader();
  const storeSnapshot = useStoreCatalog();
  const [catalog, setCatalog] = useState<CatalogRead>({ state: 'loading', entries: null });
  const [attempt, setAttempt] = useState(0);
  const pinned = space.profilePack?.includes('@') ?? false;

  // No separate Profile cache or Store inventory. Abort reads on selection change,
  // session teardown and unmount; keyed mounting prevents stale Space rows.
  useEffect(() => {
    if (!pinned) return;
    const controller = new AbortController();
    setCatalog({ state: 'loading', entries: null });
    if (!readCatalog) {
      setCatalog({ state: 'failed', entries: null });
      return () => controller.abort();
    }
    void readCatalog(controller.signal).then(result => {
      if (!controller.signal.aborted) setCatalog({ state: 'ready', entries: result.entries });
    }).catch(() => {
      if (!controller.signal.aborted) setCatalog({ state: 'failed', entries: null });
    });
    return () => controller.abort();
  }, [readCatalog, pinned, space.profilePack, attempt]);

  let content;
  if (pinned && catalog.state === 'loading') {
    content = <p role="status" className="service-state">Consultando o Profile Pack publicado…</p>;
  } else if (pinned && catalog.state === 'failed') {
    content = <div role="alert"><p>Não foi possível verificar o catálogo publicado. Nenhum estado de aplicativo foi presumido.</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Tentar novamente</Button></div>;
  } else {
    try {
      const projection = projectSpaceProfileStoreStatus({
        space, profiles: catalog.state === 'ready' ? catalog.entries : EMPTY_PROFILES, storeSnapshot,
      });
      content = <SpaceProfileAppsStatus projection={projection} />;
    } catch {
      content = <p role="alert" className="service-state">Os dados do perfil ou da Loja não passaram na validação. Nenhuma instalação foi presumida.</p>;
    }
  }

  return <Panel title="Aplicativos do Space" className="meridian-account-spaces meridian-space-profile-apps">
    <p className="meridian-space-app-intro">Aplicativos referenciados pelo Profile Pack deste Space em uso: <strong>{space.name}</strong>.</p>
    {content}
    <p className="meridian-space-app-footnote">Consulta somente leitura. O vínculo ao Space não instala aplicativos, não concede permissões e não autoriza execução.</p>
  </Panel>;
}

export function SpaceProfileAppsPanel() {
  const { authorized, identity } = useWebAccount();
  const active = authorized.ready && identity.state === 'signed-in' ? authorized.activeSpace : null;
  if (!active) return null;
  return <ActiveSpaceApps key={`${identity.subjectId}:${active.id}:${active.profilePack ?? ''}`} space={active} />;
}
