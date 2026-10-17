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
  if (title === 'Minha conta') return <AccountPanel onOpen={open}/>;
  if (title === 'Projetos' || title === 'Arquivos') return <Panel title={title}><p className="service-state">{title === 'Projetos' ? unavailableServices.projects : unavailableServices.files}</p><IntegrationNote area={title === 'Projetos' ? 'projects' : 'files'}/></Panel>;
  if (title === 'Aplicativos') return <FavoriteShortcutsPanel onOpen={open} showHelp/>;
  if (title === 'Notificações') return <WebNotificationCenter/>;
  if (title === 'Atividades') return <Panel title={title}><p className="service-state">{unavailableServices.activity}</p><IntegrationNote area="activity"/></Panel>;
  if (title === 'Dispositivos') return <Panel title="Dispositivos conectados"><p className="service-state">{unavailableServices.devices}</p><IntegrationNote area="devices"/></Panel>;
  if (title === 'Continuidade') return <Panel title={title}><p className="service-state">Este aplicativo ainda não está conectado.</p><IntegrationNote area="continuity"/></Panel>;
  if (title === 'Espaços') return <SpacesExperience onOpen={open}><SpacesPanel/></SpacesExperience>;
  if (title === 'Configurações') return <Suspense fallback={<p className="service-state" role="status">Carregando Ajustes…</p>}><SettingsExperience onOpen={open}/></Suspense>;
  return <div className="desktop-empty"><AppIcon icon={favorites.find(a => a.name === title)?.icon ?? LayoutGrid} tone={favorites.find(a => a.name === title)?.tone ?? 'green'}/><h2>{title}</h2><p>Este aplicativo ainda não está conectado.</p></div>;
}

export { WorkspaceNavigation } from './meridian-navigation';

export function SpacesPanel() {
  const { session, identity, catalog, selection, authorized, offline } = useWebAccount();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const loading = catalog.state === 'loading';
  const kinds = { personal: 'Pessoal', work: 'Trabalho', professional: 'Profissional' };
  const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const visible = authorized.ready ? authorized.visibleSpaces.filter(space => space.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').includes(normalized)) : [];
  const message = offline ? 'Sem conexão. Seus Spaces serão consultados quando a conexão voltar.' : loading ? 'Carregando seus Spaces…'
    : identity.state !== 'signed-in' ? identity.state === 'signed-out' ? 'Entre na conta para consultar seus Spaces.' : 'O serviço de conta não está disponível neste ambiente.'
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
  return <Panel title="Seus Spaces" className="meridian-account-spaces" actionControl={<Button variant="outline" disabled={offline || loading} onClick={() => { setError(null); void session.refresh().catch(() => setError('Não foi possível atualizar a conexão. Tente novamente.')); }}>{loading ? 'Consultando…' : 'Atualizar conexão'}</Button>}>
    <p className="meridian-account-spaces-scope">Dados consultados pelo serviço da sua conta. Os exemplos completos continuam disponíveis acima.</p>
    {authorized.activeSpace && <section className="meridian-account-space-active" aria-label="Espaço em uso"><span className="meridian-space-symbol"><WalletCards aria-hidden="true"/></span><div><small>ESPAÇO EM USO</small><h3>{authorized.activeSpace.name}</h3><p>{kinds[authorized.activeSpace.kind as keyof typeof kinds]} · Contexto selecionado nesta sessão</p></div><Button variant="outline" onClick={() => { session.selection.clear(); setError(null); }}>Limpar seleção</Button></section>}
    {authorized.ready && authorized.visibleSpaces.length > 0 ? <>
      <div className="meridian-account-spaces-tools"><label>Buscar nos meus espaços<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome do espaço"/></label><span>{visible.length} de {authorized.visibleSpaces.length} espaços</span></div>
      {visible.length ? <div className="meridian-account-space-grid">{visible.map(space => <article key={space.id} className="meridian-account-space-card" data-selected={authorized.activeSpace?.id === space.id}>
        <span className="meridian-space-symbol"><WalletCards aria-hidden="true"/></span><span className="meridian-space-kind">{kinds[space.kind as keyof typeof kinds]}</span>
        <h3>{space.name}</h3><p>{space.state === 'archived' ? 'Espaço arquivado' : authorized.activeSpace?.id === space.id ? 'Selecionado nesta sessão' : 'Disponível na sua conta'}</p>
        <dl><div><dt>Perfil vinculado</dt><dd>{space.profilePack ?? 'Nenhum perfil vinculado'}</dd></div></dl>
        <Button variant={authorized.activeSpace?.id === space.id ? 'outline' : 'default'} disabled={offline || space.state !== 'active'} aria-pressed={authorized.activeSpace?.id === space.id} onClick={() => selectSpace(space.id)}>{space.state === 'archived' ? 'Arquivado' : authorized.activeSpace?.id === space.id ? 'Selecionado' : 'Usar este espaço'}</Button>
      </article>)}</div> : <div className="meridian-account-spaces-empty" role="status"><h3>Nenhum espaço corresponde à busca.</h3><Button variant="outline" onClick={() => setQuery('')}>Limpar busca</Button></div>}
    </> : <div className="meridian-account-spaces-empty" role="status" data-integration={!authorized.ready && !loading && (offline || identity.state !== 'signed-out') ? 'pending' : undefined}><WalletCards aria-hidden="true"/><h3>{offline ? 'Sem conexão com a conta' : loading ? 'Consultando sua conta' : authorized.ready ? 'Seus espaços aparecerão aqui' : identity.state === 'signed-out' ? 'Entre para ver seus espaços' : identity.state === 'signed-in' ? 'Não foi possível carregar seus espaços' : 'Conexão com a conta pendente'}</h3><p>{message}</p></div>}
    {error && <p className="service-state" role="alert">{error}</p>}
    <p className="service-state" role="status">{authorized.activeSpace ? 'Space atual: ' + authorized.activeSpace.name : authorized.ready ? 'Escolha um Space para definir o contexto desta sessão.' : 'Nenhum contexto de Space está disponível.'}</p>
    <p className="service-state">A escolha vale nesta sessão e não concede acesso a arquivos, dispositivos ou IA.</p>
  </Panel>;
}
