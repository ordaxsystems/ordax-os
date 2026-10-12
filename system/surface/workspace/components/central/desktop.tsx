import { FavoriteShortcutsPanel } from './favorite-shortcuts';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type Dispatch } from 'react';
import { Bell, Settings, Search, LayoutGrid, MoreHorizontal, ChevronLeft, ChevronRight, Sparkles, Send, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import dayWallpaper from '@/assets/alpine-day.jpg';
import nightWallpaper from '@/assets/alpine-night.jpg';
import { AccountCard, AccountPanel, AppIcon, Avatar, Brand, Panel, WindowAppIcon } from './primitives';
import { favorites, navigation, shortcuts, unavailableServices } from './config';
import { useWebAccount } from './account-context';
import { useWebPreferences } from './preferences-context';
import { COLOR_THEME_OPTIONS } from '../../../../services/preferences/color-palette.mjs';
import { accessibilityContrastPreference, accessibilityMotionPreference, accessibilityTextScalePreference } from '../../../../services/preferences/accessibility.mjs';
import { WindowResourceLoadError } from './window-resource-error.mjs';
import type { DesktopAction, DesktopState } from './desktop-state';

// One stable resource type; no fetch until the Store is actually mounted.
// Cached module-load failures are recovered by explicit page reload.
const Store = lazy(() => import('../store/store').then(module => ({ default: module.StoreExperience })).catch(error => { throw new WindowResourceLoadError(error); }));

export type PresentationProps = { onCentral: () => void };
type Props = PresentationProps & { theme: 'light' | 'dark'; dispatch: Dispatch<DesktopAction> };
export function Desktop({ theme, onCentral, dispatch }: Props) {

  const open = (title: string) => dispatch({ type: 'open', title });
  return <main className="classic-desktop" aria-label="Área de trabalho clássica">
    <img src={theme === 'dark' ? nightWallpaper : dayWallpaper} alt="Paisagem da área de trabalho" className="desktop-wallpaper" width={1920} height={768}/>
    <section className="desktop-shortcuts" aria-label="Atalhos da área de trabalho">{[{ name: 'Central', icon: LayoutGrid, tone: 'lime' as const }, ...shortcuts, { name: 'Aura', icon: Sparkles, tone: 'lime' as const }].map(item => <Button variant="ghost" className="desktop-shortcut" key={item.name} onClick={() => item.name === 'Central' ? onCentral() : open(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></Button>)}</section>
    <div className="desktop-watermark" aria-hidden="true"><span>Seu espaço.</span><span>Do seu jeito.</span><small>OrdaX OS Web</small></div>
  </main>;
}
export function DesktopContent({ title, open, onCentral, initialPrompt }: PresentationProps & { initialPrompt?: { text: string }; title: string; open: (title: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { if (initialPrompt !== undefined) { setPrompt(initialPrompt.text); setSent(true); } }, [initialPrompt]);
  if (title === 'Loja') return <Suspense fallback={<p className="service-state" role="status">Carregando Loja…</p>}><Store/></Suspense>;
  if (title === 'Minha conta') return <AccountPanel/>;
  if (title === 'Projetos' || title === 'Arquivos') return <Panel title={title}><p className="service-state">{title === 'Projetos' ? unavailableServices.projects : unavailableServices.files}</p></Panel>;
  if (title === 'Aplicativos') return <FavoriteShortcutsPanel onOpen={open} showHelp/>;
  if (title === 'Notificações' || title === 'Atividades') return <Panel title={title}><p className="service-state">{unavailableServices.activity}</p></Panel>;
  if (title === 'Dispositivos') return <Panel title="Dispositivos conectados"><p className="service-state">{unavailableServices.devices}</p></Panel>;
  if (title === 'Espaços') return <SpacesPanel/>;
  if (title === 'Configurações') return <AppearancePanel onCentral={onCentral}/>;
  if (title === 'Aura' || title === 'Inteligência') return <><div className="desktop-content-heading"><Sparkles/><h2>Aura</h2></div><form className="aura-search" onSubmit={e => { e.preventDefault(); if (prompt.trim()) setSent(true); }}><Sparkles className="aura-star"/><input aria-label="Pergunte ao Aura" placeholder="Pergunte ao Aura ou descreva uma tarefa..." value={prompt} onChange={e => { setPrompt(e.target.value); setSent(false); }}/><Button type="submit" className="send-button" aria-label="Enviar ao Aura"><Send/></Button></form>{sent && <p className="desktop-unconnected">{unavailableServices.intelligence}</p>}</>;
  return <div className="desktop-empty"><AppIcon icon={favorites.find(a => a.name === title)?.icon ?? LayoutGrid} tone={favorites.find(a => a.name === title)?.tone ?? 'green'}/><h2>{title}</h2><p>Este aplicativo ainda não está conectado.</p></div>;
}

type NavigationProps = { onSidebarChange: (mode: 'collapsed' | 'expanded') => void; state: DesktopState; dispatch: Dispatch<DesktopAction>; view: 'central' | 'desktop'; onToggleView: () => void; onCentral: () => void };

// The same mounted navigation owns the launcher, view toggle and all running apps.
export function WorkspaceNavigation({ state, dispatch, view, onToggleView, onCentral, onSidebarChange }: NavigationProps) {
  const { displayName } = useWebAccount();
  const [startOpen, setStartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const menuNavigation = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const navigationHost = useRef<HTMLElement>(null);
  const [menuContainer, setMenuContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setMenuContainer(navigationHost.current?.closest<HTMLElement>('.window-workspace') ?? null); }, []);
  const dockHost = useRef<HTMLDivElement>(null);
  const [dockLabelsVisible, setDockLabelsVisible] = useState(true);
  useLayoutEffect(() => {
    const host = dockHost.current;
    if (!host) return;
    const context = document.createElement('canvas').getContext('2d');
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const buttons = [...host.querySelectorAll<HTMLButtonElement>('.desktop-task')];
      const gap = parseFloat(getComputedStyle(host).columnGap) || 0;
      const required = buttons.reduce((total, button) => {
        const label = button.querySelector('span');
        if (!label) return total;
        const style = getComputedStyle(button);
        const textStyle = getComputedStyle(label);
        if (context) context.font = textStyle.font || textStyle.fontWeight + ' ' + textStyle.fontSize + ' ' + textStyle.fontFamily;
        const textWidth = context?.measureText(label.textContent ?? '').width ?? 110;
        const labelWidth = Math.min(textWidth, parseFloat(textStyle.maxWidth) || textWidth);
        const iconWidth = button.querySelector('svg')?.getBoundingClientRect().width ?? 16;
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
        const naturalWidth = padding + iconWidth + (parseFloat(style.columnGap) || 0) + labelWidth;
        const buttonWidth = Math.min(parseFloat(style.maxWidth) || Infinity, Math.max(parseFloat(style.minWidth) || 44, naturalWidth));
        return total + Math.ceil(buttonWidth);
      }, Math.max(0, buttons.length - 1) * gap);
      setDockLabelsVisible(required <= host.clientWidth);
    };
    measure();
    void document.fonts.ready.then(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener('resize', measure);
    return () => { disposed = true; observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [state.windows]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  useEffect(() => {
    const host = navigationHost.current;
    if (!host) return;
    const sidebar = host.closest<HTMLElement>('.workspace-sidebar');
    const measure = () => { setVisibleCount(Math.max(0, Math.floor(host.clientHeight / 48))); if (sidebar) setSidebarExpanded(getComputedStyle(sidebar).getPropertyValue('--sidebar-expanded').trim() === '1'); };
    measure();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (sidebar) observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);
  const activeWindow = state.windows.find(window => window.title === state.active && !window.minimized);
  const activeDestination = activeWindow ? (activeWindow.title === 'Inteligência' ? 'Aura' : activeWindow.title) : null;
  const homeActive = view === 'central' && activeWindow === undefined;
  const destinations = navigation.filter(item => item.name !== 'Início');
  const visibleNavigation = destinations.slice(0, visibleCount >= destinations.length ? destinations.length : Math.max(0, visibleCount - 1));
  const menuDestinations = [...navigation, { name: 'Notificações', icon: Bell }].filter(item => item.name !== 'Início' && item.name.toLowerCase().includes(search.toLowerCase().trim()));
  const centralMatch = 'central'.includes(search.toLowerCase().trim());
  const open = (title: string) => { menuNavigation.current = startOpen; dispatch({ type: 'open', title }); setStartOpen(false); };
  const returnToCentral = () => { menuNavigation.current = startOpen && state.active !== null; setStartOpen(false); onCentral(); };
  return <Dialog open={startOpen} onOpenChange={open => { if (open) menuNavigation.current = false; setStartOpen(open); }}>
    <DialogContent placement="custom" portalContainer={menuContainer} className="desktop-start-menu" onCloseAutoFocus={event => {
      if (menuNavigation.current) { event.preventDefault(); return; }
      if (!menuTrigger.current?.getClientRects().length) {
        event.preventDefault();
        navigationHost.current?.closest<HTMLElement>('.window-workspace')?.querySelector<HTMLButtonElement>('[data-window-home]')?.focus({ preventScroll: true });
      }
    }}><label className="desktop-menu-search"><Search className="size-4"/><input aria-label="Pesquisar destinos" placeholder="Pesquisar aplicativos e painéis" value={search} onChange={e => setSearch(e.target.value)}/></label><DialogTitle className="desktop-menu-heading">Aplicativos e painéis</DialogTitle><DialogDescription className="sr-only">Pesquise um destino e abra seu painel. Escape fecha este menu.</DialogDescription><div className="desktop-menu-apps">{menuDestinations.map(item => <Button variant="ghost" key={item.name} className="desktop-menu-item" data-active={item.name === activeDestination} aria-current={item.name === activeDestination ? 'page' : undefined} onClick={() => open(item.name)}><item.icon/>{item.name}<ChevronRight className="ml-auto"/></Button>)}{centralMatch && <Button variant="ghost" className="desktop-menu-item" onClick={() => { dispatch({ type: 'show-desktop' }); returnToCentral(); }}><LayoutGrid/>Central<ChevronRight className="ml-auto"/></Button>}</div><div role="status">{menuDestinations.length === 0 && !centralMatch ? <p className="service-state">Nenhum destino encontrado.</p> : null}</div><div className="desktop-menu-footer"><Avatar/><span>{displayName}<small>Minha conta OrdaX</small></span><Button variant="ghost" size="icon" className="ml-auto" aria-label="Configurações" title="Configurações" onClick={() => open('Configurações')}><Settings/></Button></div></DialogContent>
    <aside id="workspace-sidebar" className="os-sidebar workspace-sidebar" aria-label="Navegação principal">
      <div className="sidebar-header"><Brand/></div>
      <div className="sidebar-home-row">
        {navigation.filter(item => item.name === 'Início').map(item => <Button key={item.name} variant="ghost" className="os-nav-item" title={item.name} aria-label={item.name} data-window-home="true" data-active={homeActive} aria-current={homeActive ? 'page' : undefined} onClick={() => { dispatch({ type: 'show-desktop' }); returnToCentral(); }}><item.icon/><span>{item.name}</span></Button>)}
      </div>
      <nav className="os-nav" ref={navigationHost} aria-label="Destinos">
        {visibleNavigation.map(item => <Button key={item.name} variant="ghost" className="os-nav-item" title={item.name} aria-label={item.name} data-active={item.name === activeDestination} aria-current={item.name === activeDestination ? 'page' : undefined} onClick={() => open(item.name)}><item.icon/><span>{item.name}</span></Button>)}
        {visibleNavigation.length < destinations.length && <DialogTrigger asChild><Button ref={menuTrigger} variant="ghost" className="os-nav-item" aria-label="Mais destinos" title="Mais destinos" data-active={destinations.some(item => item.name === activeDestination) && !visibleNavigation.some(item => item.name === activeDestination)} onClick={() => setSearch('')}><MoreHorizontal/><span>Mais</span></Button></DialogTrigger>}
      </nav>
      <AccountCard onNotifications={() => open('Notificações')} onOpen={() => open('Minha conta')} onSettings={() => open('Configurações')}/>
    </aside>
    <Button variant="ghost" size="icon" className="sidebar-collapse" aria-controls="workspace-sidebar" aria-expanded={sidebarExpanded} aria-label={sidebarExpanded ? 'Recolher sidebar' : 'Expandir sidebar'} title={sidebarExpanded ? 'Recolher sidebar' : 'Expandir sidebar'} onClick={() => onSidebarChange(sidebarExpanded ? 'collapsed' : 'expanded')}>{sidebarExpanded ? <ChevronLeft/> : <ChevronRight/>}</Button>
    <footer className="desktop-taskbar workspace-navigation" aria-label="Navegação inferior"><div className="desktop-taskbar-left"><div className="desktop-running-apps" ref={dockHost} data-labels={dockLabelsVisible ? 'visible' : 'hidden'}>{state.windows.map(w => <Button variant="ghost" className="desktop-task" data-active={state.active === w.title && !w.minimized} data-minimized={w.minimized} aria-current={state.active === w.title && !w.minimized ? 'true' : undefined} title={w.title + (w.minimized ? ' — minimizado' : state.active === w.title ? ' — ativo' : ' — aberto')} key={w.title} data-window-restore={w.title} aria-label={`Restaurar janela ${w.title}`} onClick={() => dispatch({ type: w.minimized ? 'open' : 'focus', title: w.title })}><WindowAppIcon title={w.title}/><span>{w.title}</span></Button>)}</div></div><div className="desktop-tray"><Button variant="ghost" size="icon" className="workspace-view-toggle" data-workspace-switch="true" aria-label={view === 'central' ? 'Abrir área de trabalho' : 'Abrir Central'} title={view === 'central' ? 'Área de trabalho' : 'Central'} aria-pressed={view === 'desktop'} onClick={() => { setStartOpen(false); onToggleView(); }}><LayoutGrid/></Button></div></footer>
  </Dialog>;
}

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

const accessibilityPreferences = [accessibilityContrastPreference, accessibilityMotionPreference, accessibilityTextScalePreference];

function AppearancePanel({ onCentral }: { onCentral: () => void }) {
  const { colorTheme, setColorTheme, persistence, snapshot, setPreference } = useWebPreferences();
  return <Panel title="Aparência">
    <div className="desktop-settings-row preference-setting">
      <label htmlFor="web-color-theme">Tema<small id="web-color-theme-description">OrdaX USB usa as cores oficiais do sistema, mantendo este layout.</small></label>
      <select id="web-color-theme" aria-describedby="web-color-theme-description" value={colorTheme} onChange={event => setColorTheme(event.target.value)}>{COLOR_THEME_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    </div>
    {accessibilityPreferences.map(preference => <div className="desktop-settings-row preference-setting" key={preference.id}>
      <label htmlFor={preference.id}>{preference.title}<small id={preference.id + '-description'}>{preference.description}</small></label>
      <select id={preference.id} aria-describedby={preference.id + '-description'} value={String(snapshot[preference.id])} onChange={event => setPreference(preference.id, event.target.value)}>{preference.options.map((option: { value: string; label: string }) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    </div>)}
    <p className="service-state" role="status">{persistence === 'session-only' ? 'O navegador não permitiu salvar. Suas preferências serão mantidas apenas nesta sessão.' : 'Preferências deste navegador. Sincronização entre dispositivos ainda não está conectada.'}</p>
    <div className="desktop-settings-row"><span>Visualização</span><Button variant="secondary" onClick={onCentral}><LayoutGrid/>Voltar à central</Button></div>
  </Panel>;
}
