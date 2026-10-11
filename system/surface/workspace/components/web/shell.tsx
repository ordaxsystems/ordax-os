import { useEffect, useReducer, useState, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { House, Sparkles, Menu, Search, LayoutGrid, Bell, UserRound, ChevronDown, PanelLeftClose, PanelLeftOpen, Monitor, PanelsTopLeft, Layers3, Plus, X, ChevronLeft, ChevronRight, ChevronsDown, ChevronsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { getWebApp, type WebAppId, type WebView } from '@/lib/web/model';
import { initialWorkspace, workspaceReducer } from '@/lib/web/workspace';
import { WorkspacePages } from './pages';
import { WindowMenu } from './window-menu';
import { IntelligenceSurface } from '@/components/intelligence/surface';
import { IntelligenceSessionProvider } from '@/components/intelligence/session';
import { AppIcon } from './primitives';
import { AppWindow } from './window';
import { Launcher } from './launcher';
import { WorkspaceNavigation } from './navigation';
import type { Appearance } from './app-content';
import mark from '@ordax-brand/ordax-symbol.png';
import wallpaper from '@/assets/ordax-web-wallpaper.jpg';

function WorkspaceAccount({ onOpen }: { onOpen: (id: WebAppId) => void }) {
  return <div className="web-navigation-account"><Button variant="ghost" size="icon" title="Notificações" aria-label="Abrir notificações" onClick={() => onOpen('activity')}><Bell/></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="web-identity" title="Minha Conta" aria-label="Menu de identidade"><span className="web-user-symbol"><UserRound/></span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><a href="/conta/"><UserRound/>Minha Conta</a></DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem asChild><a href="/">Site OrdaX</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>;
}

function WorkspaceChrome({ children, onLauncher, onOpen }: { children: import('react').ReactNode; onLauncher: () => void; onOpen: (id: WebAppId) => void }) {
  return <div className="web-navigation-chrome"><div className="web-navigation-heading"><Link to="." search={{ view: 'home' }} className="web-brand"><img src={mark} alt="" width={34} height={34}/><span>OrdaX</span><small>Web</small></Link><Button variant="ghost" size="icon" title="Pesquisar aplicativos (Ctrl K)" aria-label="Abrir launcher" onClick={onLauncher}><Search/></Button></div><div className="web-navigation-scroll">{children}</div><WorkspaceAccount onOpen={onOpen}/></div>;
}

export function WebShell({ view }: { view: WebView }) { return <IntelligenceSessionProvider><WebShellInner view={view}/></IntelligenceSessionProvider>; }
function WebShellInner({ view }: { view: WebView }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const { windows, appearance } = state;
  const navigate = useNavigate();
  const stage = useRef<HTMLDivElement>(null);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const primaryPane = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(3);
  const setAppearance = (value: Appearance) => dispatch({ type: 'appearance', value });
  const [launcher, setLauncher] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [spaceMenu, setSpaceMenu] = useState(false);
  const floating = windows.filter(win => !['minimized', 'compact'].includes(win.mode));
  const active = [...floating].sort((a, b) => a.layer - b.layer).at(-1)?.appId;
  const compact = windows.filter(win => win.mode === 'compact');
  const compactLayout = compact.length === 0 ? 'none' : state.carouselCollapsed ? 'collapsed' : 'expanded';
  const offset = Math.min(state.carouselOffset, Math.max(0, compact.length - capacity));
  const immersive = windows.some(win => win.mode === 'immersive');
  const openApp = (appId: WebAppId) => { if (['projects', 'spaces', 'store', 'assistant'].includes(appId)) { void navigate({ to: '.', search: { view: appId as WebView } }); } else { dispatch({ type: 'open', appId }); } setMobileMenu(false); };
  const navigationProps = { onSelectSpace: () => { setMobileMenu(false); setSpaceMenu(true); }, onArrange: () => { setMobileMenu(false); dispatch({ type: 'arrange' }); }, page: state.page, intelligence: state.intelligence, active, onOpen: openApp, onNavigate: (view: WebView) => { dispatch({ type: 'navigate', view }); setMobileMenu(false); } };
  const goHome = () => { void navigate({ to: '.', search: { view: 'home' } }); dispatch({ type: 'desktop' }); };
  useEffect(() => { const node = stage.current; if (!node) return; const observer = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width ?? 1000; setCapacity(Math.max(1, Math.floor((width - 24) / 310))); if (mobileMenuButton.current && !mobileMenuButton.current.getClientRects().length) setMobileMenu(false); }); observer.observe(node); return () => observer.disconnect(); }, []);
  useEffect(() => {
    dispatch({ type: 'navigate', view });
    setMobileMenu(false);
  }, [view]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') windows.filter(win => win.mode === 'immersive').forEach(win => dispatch({ type: 'immersive', appId: win.appId }));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setLauncher(value => !value); }
    };
    globalThis.addEventListener('keydown', shortcut);
    return () => { globalThis.removeEventListener('keydown', shortcut); };
  }, [windows]);
  return <div className={`web-workspace ${appearance.compact ? 'web-compact' : ''} ${immersive ? 'web-immersive' : ''} ${compactLayout !== 'expanded' ? 'web-carousel-collapsed' : ''}`}>
    {appearance.wallpaper && <img className="web-wallpaper" src={wallpaper} alt="" width={1920} height={1088}/>}
    <div className="web-wallpaper-shade"/>
    <a className="web-skip" href="#web-desktop">Ir para a área de trabalho</a>
    <aside className="web-sidebar"><WorkspaceChrome onLauncher={() => setLauncher(true)} onOpen={openApp}><div className="web-sidebar-label"><span>WORKSPACE</span><Button variant="ghost" size="icon" title={appearance.compact ? 'Expandir navegação' : 'Recolher navegação'} aria-label={appearance.compact ? 'Expandir navegação' : 'Recolher navegação'} onClick={() => setAppearance({ ...appearance, compact: !appearance.compact })}>{appearance.compact ? <PanelLeftOpen/> : <PanelLeftClose/>}</Button></div><WorkspaceNavigation adaptive {...navigationProps}/></WorkspaceChrome></aside>
    <main id="web-desktop" tabIndex={-1} className="web-desktop" data-compact-layout={compactLayout} data-primary-full={state.page !== 'home' && state.carouselCollapsed}><div ref={primaryPane} className="web-primary-pane"><WorkspacePages favorites={state.favorites} page={state.page} onOpen={openApp} onLauncher={() => setLauncher(true)} appearance={appearance} onAppearance={setAppearance}/></div><div ref={stage} id="web-window-stage" className="web-window-stage" aria-label="Área de janelas" style={{ '--compact-capacity': capacity, '--compact-offset': offset } as import('react').CSSProperties}>{windows.map(win => { const compactIndex = compact.findIndex(item => item.id === win.id); return <AppWindow key={win.id} primaryPane={primaryPane} window={win} compactIndex={compactIndex} compactVisible={!state.carouselCollapsed && compactIndex >= offset && compactIndex < offset + capacity} active={active === win.appId} dispatch={dispatch} appearance={appearance} onAppearance={setAppearance}/>; })}</div>
    {compact.length > 0 && <div className="web-carousel-controls"><Button variant="ghost" aria-label={state.carouselCollapsed ? 'Expandir janelas compactas' : 'Recolher janelas compactas'} aria-expanded={!state.carouselCollapsed} aria-controls="web-window-stage" onClick={() => dispatch({ type: 'carousel-collapse' })}>{state.carouselCollapsed ? <ChevronsUp/> : <ChevronsDown/>}<span className="web-carousel-name">{capacity === 1 ? getWebApp(compact[offset].appId).name : 'Janelas compactas'}</span></Button><div><Button variant="ghost" size="icon" aria-label="Janelas compactas anteriores" disabled={offset === 0} onClick={() => dispatch({ type: 'carousel-offset', value: offset - 1 })}><ChevronLeft/></Button><span role="status" aria-label={`${getWebApp(compact[offset].appId).name}, janela ${offset + 1} de ${compact.length}`}>{capacity === 1 ? `${offset + 1} de ${compact.length}` : `${offset + 1}–${Math.min(offset + capacity, compact.length)} / ${compact.length}`}</span><Button variant="ghost" size="icon" aria-label="Próximas janelas compactas" disabled={offset + capacity >= compact.length} onClick={() => dispatch({ type: 'carousel-offset', value: offset + 1 })}><ChevronRight/></Button></div></div>}
    <aside className={`web-context-ai ${state.intelligence ? 'web-context-open' : ''}`} aria-label="Painel contextual Intelligence"><header><strong>OrdaX Intelligence</strong><Button variant="ghost" size="icon" aria-label="Fechar painel Intelligence" onClick={() => dispatch({ type: 'intelligence' })}><X/></Button></header><IntelligenceSurface presentation="panel" onOpenStudio={() => openApp('studio')} onExpand={() => openApp('assistant')}/></aside></main>
    <footer className="web-systembar"><nav className="web-dock" aria-label="Dock de aplicativos"><Button className="web-dock-launcher" variant="ghost" size="icon" aria-label="Abrir aplicativos" title="Aplicativos" onClick={() => setLauncher(true)}><img src={mark} alt="" width={40} height={40}/></Button><span className="web-dock-divider"/>{Array.from(new Set([...state.favorites, ...windows.map(win => win.appId)])).map(id => { const win = windows.find(win => win.appId === id); return <div key={id} className="web-dock-entry"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="web-dock-menu" aria-label={`Opções de ${getWebApp(id).name}`} title="Opções da janela"><ChevronDown/></Button></DropdownMenuTrigger><DropdownMenuContent className="web-window-menu">{win ? <WindowMenu win={win} dispatch={dispatch}/> : <DropdownMenuItem onSelect={() => openApp(id)}>Abrir protótipo</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu><Button variant="ghost" className={`web-dock-app ${win ? 'web-dock-running' : ''} ${win?.mode === 'minimized' ? 'web-dock-minimized' : ''} ${active === id ? 'web-dock-focused' : ''}`} title={`${getWebApp(id).name}${win ? ' · ' + win.mode : ''}`} aria-label={`Abrir ${getWebApp(id).name} pelo dock`} onClick={() => openApp(id)}><AppIcon id={id}/>{windows.some(win => win.appId === id) && <span className="web-dock-dot"/>}</Button></div>; })}<Button size="icon" variant="ghost" aria-label="Mostrar área de trabalho" title="Mostrar área de trabalho" onClick={goHome}><Monitor/></Button><Button variant="ghost" size="icon" aria-label="Visão geral das janelas" title="Visão geral" onClick={() => dispatch({ type: 'overview' })}><PanelsTopLeft/></Button><Button variant="ghost" size="icon" aria-label="Compactar todas as janelas" title="Compactar todas" onClick={() => dispatch({ type: 'compact-all' })}><ChevronsDown/></Button></nav></footer>
    <Dialog open={mobileMenu} onOpenChange={setMobileMenu}><nav className="web-mobile-bar" aria-label="Navegação móvel OrdaX Web">
      <Button variant="ghost" aria-label="Mostrar Início" aria-current={state.page === 'home' && !active && !mobileMenu && !launcher && !state.overview && !spaceMenu ? 'page' : undefined} data-selected={state.page === 'home' && !active && !mobileMenu && !launcher && !state.overview && !spaceMenu} onClick={() => { goHome(); setMobileMenu(false); }}><House/><small>Início</small></Button>
      <Button variant="ghost" aria-label="Abrir Aura" aria-current={state.page === 'assistant' && !active && !mobileMenu && !launcher && !state.overview && !spaceMenu ? 'page' : undefined} data-selected={state.page === 'assistant' && !active && !mobileMenu && !launcher && !state.overview && !spaceMenu} onClick={() => openApp('assistant')}><Sparkles/><small>Aura</small></Button>
      <Button variant="ghost" aria-label="Abrir aplicativos" aria-expanded={launcher} data-selected={launcher || state.page === 'apps' && !active && !mobileMenu && !state.overview && !spaceMenu} onClick={() => setLauncher(true)}><LayoutGrid/><small>Apps</small></Button>
      <Button variant="ghost" aria-label="Selecionar Space pela navegação" aria-expanded={spaceMenu} data-selected={spaceMenu || state.page === 'spaces' && !active && !mobileMenu && !launcher && !state.overview} onClick={() => setSpaceMenu(true)}><Layers3/><small>Space</small></Button>
      <DialogTrigger asChild><Button ref={mobileMenuButton} variant="ghost" aria-label="Menu do workspace" data-selected={mobileMenu || state.overview}><Menu/><small>Menu</small></Button></DialogTrigger>
    </nav><DialogContent placement="bottom" className="web-mobile-menu"><header><DialogTitle>Seu workspace</DialogTitle><DialogDescription>Aplicativos, projetos e ferramentas do OrdaX.</DialogDescription></header><WorkspaceChrome onLauncher={() => { setMobileMenu(false); setLauncher(true); }} onOpen={openApp}><WorkspaceNavigation {...navigationProps}/></WorkspaceChrome><Button variant="outline" className="web-mobile-windows" aria-label="Visão geral das janelas" onClick={() => { setMobileMenu(false); dispatch({ type: 'overview' }); }}><PanelsTopLeft/>Janelas abertas<span>{windows.length}</span></Button></DialogContent></Dialog>
    <Dialog open={state.overview} onOpenChange={() => dispatch({ type: 'overview' })}><DialogContent className="web-overview"><DialogTitle>Visão geral das janelas</DialogTitle><DialogDescription>Protótipos abertos nesta sessão</DialogDescription><div className="web-overview-grid">{windows.map(win => <article key={win.id}><AppIcon id={win.appId}/><h3>{getWebApp(win.appId).name}</h3><p>{win.mode === 'compact' ? 'Compacta' : win.mode === 'minimized' ? 'Minimizada' : win.mode === 'maximized' ? 'Maximizada' : 'Aberta'}</p><Button variant="outline" aria-label={`Abrir ${getWebApp(win.appId).name} pela visão geral`} onClick={() => { dispatch({ type: 'restore', appId: win.appId }); }}>Selecionar</Button></article>)}</div>{windows.length === 0 && <p>Nenhuma janela aberta</p>}</DialogContent></Dialog>
    <Launcher open={launcher} onOpenChange={setLauncher} onLaunch={openApp}/>
    <Dialog open={spaceMenu} onOpenChange={setSpaceMenu}><DialogContent className="web-space-dialog"><DialogTitle>Seus Spaces</DialogTitle><DialogDescription>Os contextos de trabalho e seus participantes dependem do serviço oficial OrdaX.</DialogDescription><div className="web-space-empty"><Layers3/><h3>Spaces não conectados</h3><p>Nenhum contexto ou participante foi carregado.</p><Button disabled><Plus/>Criar Space</Button><Button variant="outline" onClick={() => { openApp('spaces'); setSpaceMenu(false); }}>Abrir interface de Spaces</Button></div></DialogContent></Dialog>
  </div>;
}