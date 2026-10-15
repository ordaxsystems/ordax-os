import { SpacesExperience } from './spaces-experience';
import { IntegrationNote } from './integration-note';
import { ProfileCatalogPanel } from './profile-catalog';
import { FavoriteShortcutsPanel } from './favorite-shortcuts';
import { WebNotificationCenter } from './notifications';
import { lazy, Suspense, useState, type Dispatch } from 'react';
import { LayoutGrid, ChevronRight, Sparkles, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import meridianWallpaper from '../../../ui/brand/meridian-field.svg';
import { AccountPanel, AppIcon, Panel } from './primitives';
import { favorites, shortcuts, unavailableServices } from './config';
import { useWebAccount } from './account-context';
import { WindowResourceLoadError } from './window-resource-error.mjs';
import type { DesktopAction, DesktopState } from './desktop-state';

// One stable resource type; no fetch until the Store is actually mounted.
// Cached module-load failures are recovered by explicit page reload.
const Store = lazy(() => import('../store/meridian-store').then(module => ({ default: module.StoreExperience })).catch(error => { throw new WindowResourceLoadError(error); }));
const SettingsExperience = lazy(() => import('./settings').then(module => ({ default: module.WebSettings })).catch(error => { throw new WindowResourceLoadError(error); }));

export type PresentationProps = { onCentral: () => void };
type Props = PresentationProps & { dispatch: Dispatch<DesktopAction> };
export function Desktop({ onCentral, dispatch }: Props) {

  const open = (title: string) => dispatch({ type: 'open', title });
  return <main className="classic-desktop" aria-label="Área de trabalho OrdaX">
    <img src={meridianWallpaper} alt="Paisagem da área de trabalho" className="desktop-wallpaper" width={1920} height={768}/>
    <section className="desktop-shortcuts" aria-label="Atalhos da área de trabalho">{[{ name: 'Central', icon: LayoutGrid, tone: 'lime' as const }, ...shortcuts, { name: 'Aura', icon: Sparkles, tone: 'lime' as const }].map(item => <Button variant="ghost" className="desktop-shortcut" key={item.name} onClick={() => item.name === 'Central' ? onCentral() : open(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></Button>)}</section>
    <div className="desktop-watermark" aria-hidden="true"><span>Seu espaço.</span><span>Seu ritmo.</span><small>OrdaX OS Web</small></div>
  </main>;
}
export function DesktopContent({ title, open }: PresentationProps & { initialPrompt?: { text: string }; title: string; open: (title: string) => void }) {
  if (title === 'Loja') return <Suspense fallback={<p className="service-state" role="status">Carregando Loja…</p>}><Store/></Suspense>;
  if (title === 'Perfis profissionais') return <ProfileCatalogPanel/>;
  if (title === 'Minha conta') return <AccountPanel/>;
  if (title === 'Projetos' || title === 'Arquivos') return <Panel title={title}><p className="service-state">{title === 'Projetos' ? unavailableServices.projects : unavailableServices.files}</p><IntegrationNote area={title === 'Projetos' ? 'projects' : 'files'}/></Panel>;
  if (title === 'Aplicativos') return <FavoriteShortcutsPanel onOpen={open} showHelp/>;
  if (title === 'Notificações') return <WebNotificationCenter/>;
  if (title === 'Atividades') return <Panel title={title}><p className="service-state">{unavailableServices.activity}</p><IntegrationNote area="activity"/></Panel>;
  if (title === 'Dispositivos') return <Panel title="Dispositivos conectados"><p className="service-state">{unavailableServices.devices}</p><IntegrationNote area="devices"/></Panel>;
  if (title === 'Continuidade') return <Panel title={title}><p className="service-state">Este aplicativo ainda não está conectado.</p><IntegrationNote area="continuity"/></Panel>;
  if (title === 'Espaços') return <SpacesExperience onOpen={open}><SpacesPanel/></SpacesExperience>;
  if (title === 'Configurações') return <Suspense fallback={<p className="service-state" role="status">Carregando Ajustes…</p>}><SettingsExperience/></Suspense>;
  return <div className="desktop-empty"><AppIcon icon={favorites.find(a => a.name === title)?.icon ?? LayoutGrid} tone={favorites.find(a => a.name === title)?.tone ?? 'green'}/><h2>{title}</h2><p>Este aplicativo ainda não está conectado.</p></div>;
}

export { WorkspaceNavigation } from './meridian-navigation';

function SpacesPanel() {
  const { session, identity, catalog, selection, authorized, offline } = useWebAccount();
  const [error, setError] = useState<string | null>(null);
  const message = offline ? 'Sem conexão. Seus Spaces serão consultados quando a conexão voltar.' : catalog.state === 'loading' ? 'Carregando seus Spaces…'
    : identity.state !== 'signed-in' ? 'Entre na conta para consultar seus Spaces.'
    : catalog.state === 'error' ? 'Não foi possível consultar seus Spaces. Tente atualizar a conexão.'
    : authorized.ready ? 'Nenhum Space está disponível para esta conta.' : 'A consulta de Spaces não está disponível.';
  function selectSpace(id: string) {
    setError(null);
    if (session.surface.getSnapshot().connectivity === 'offline') {
      setError('Reconecte antes de escolher um Space.');
      return;
    }
    try { session.selection.select(id); }
    catch { setError('Este Space não está disponível. Atualize a conexão e escolha novamente.'); }
  }
  return <Panel title="Seus Spaces" action="Atualizar" onAction={() => { setError(null); void session.refresh().catch(() => {}); }}>
    {authorized.ready && authorized.visibleSpaces.length > 0
      ? <div className="modal-list">{authorized.visibleSpaces.map(space => <Button variant="ghost" className="space-switch space-choice" key={space.id} disabled={offline || space.state !== 'active'} aria-pressed={authorized.activeSpace?.id === space.id} title={space.name} onClick={() => selectSpace(space.id)}><AppIcon icon={WalletCards} tone="lime"/><span className="space-choice-name">{space.name}</span><span className="project-meta">{space.state !== 'active' ? 'Arquivado' : authorized.activeSpace?.id === space.id ? 'Selecionado' : 'Escolher'}</span></Button>)}</div>
      : <p className="service-state" role="status">{message}</p>}
    {selection.state === 'selected' && <div className="account-service-actions"><Button variant="outline" onClick={() => { session.selection.clear(); setError(null); }}>Limpar seleção</Button></div>}
    {error && <p className="service-state" role="alert">{error}</p>}
    <p className="service-state" role="status">{authorized.activeSpace ? 'Space atual: ' + authorized.activeSpace.name : authorized.ready ? 'Escolha um Space para definir o contexto desta sessão.' : 'Nenhum contexto de Space está disponível.'}</p>
    <p className="service-state">A escolha vale nesta sessão e não concede acesso a arquivos, dispositivos ou IA.</p>
  </Panel>;
}
