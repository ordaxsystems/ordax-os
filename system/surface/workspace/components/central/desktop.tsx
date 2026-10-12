import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Dispatch } from 'react';
import { Bell, Settings, Sun, Moon, Search, LayoutGrid, MoreHorizontal, ChevronLeft, ChevronRight, Sparkles, Send, WalletCards, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import dayWallpaper from '@/assets/alpine-day.jpg';
import nightWallpaper from '@/assets/alpine-night.jpg';
import { AccountCard, AppIcon, Avatar, Brand, Panel, WindowAppIcon } from './primitives';
import { activities, devices, favorites, navigation, presentationAccount, presentationStoragePercent, projects, shortcuts } from './config';
import type { DesktopAction, DesktopState } from './desktop-state';

export type PresentationProps = { theme: 'light' | 'dark'; onTheme: () => void; onCentral: () => void };
type Props = PresentationProps & { dispatch: Dispatch<DesktopAction> };
export function Desktop({ theme, onCentral, dispatch }: Props) {

  const open = (title: string) => dispatch({ type: 'open', title });
  return <main className="classic-desktop" aria-label="Área de trabalho clássica">
    <img src={theme === 'dark' ? nightWallpaper : dayWallpaper} alt="Paisagem da área de trabalho" className="desktop-wallpaper" width={1920} height={768}/>
    <section className="desktop-shortcuts" aria-label="Atalhos da área de trabalho">{[{ name: 'Central', icon: LayoutGrid, tone: 'lime' as const }, ...shortcuts, { name: 'Aura', icon: Sparkles, tone: 'lime' as const }].map(item => <Button variant="ghost" className="desktop-shortcut" key={item.name} onClick={() => item.name === 'Central' ? onCentral() : open(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></Button>)}</section>
    <div className="desktop-watermark" aria-hidden="true"><span>Seu espaço.</span><span>Do seu jeito.</span><small>OrdaX OS Web</small></div>
  </main>;
}
export function DesktopContent({ title, theme, onTheme, open, onCentral, initialPrompt }: PresentationProps & { initialPrompt?: { text: string }; title: string; open: (title: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { if (initialPrompt !== undefined) { setPrompt(initialPrompt.text); setSent(true); } }, [initialPrompt]);
  if (title === 'Projetos' || title === 'Arquivos' || projects.some(p => p.name === title)) return <><div className="desktop-content-heading"><Folder/><h2>{title}</h2><span>{title === 'Arquivos' ? 'Documentos recentes' : 'Espaço Pessoal'}</span></div><div className="project-list">{projects.filter(p => title === 'Projetos' || title === 'Arquivos' || p.name === title).map(p => <Button variant="ghost" className="project-row" key={p.name} onClick={() => open(p.name)}><span className="project-thumb" data-tone={p.tone}><p.icon className="size-6"/></span><span className="min-w-0"><span className="project-name block">{p.name}</span><span className="project-meta block">{p.detail}</span></span><ChevronRight/></Button>)}</div></>;
  if (title === 'Aplicativos') return <Panel title="Aplicativos favoritos"><div className="favorite-grid">{favorites.map(item => <Button variant="ghost" className="favorite-tile" key={item.name} onClick={() => open(item.name)}><AppIcon icon={item.icon} tone={item.tone}/>{item.name}</Button>)}</div></Panel>;
  if (title === 'Notificações' || title === 'Atividades') return <Panel title="Atividades recentes"><div className="activity-list">{activities.map(a => <div className="activity-row" key={a.title}><AppIcon icon={a.icon} tone={a.tone}/><div><div className="project-name">{a.title}</div><div className="project-meta">{a.detail}</div></div><time className="activity-time">{a.time}</time></div>)}</div></Panel>;
  if (title === 'Dispositivos') return <Panel title="Dispositivos conectados"><div className="modal-list">{devices.map(d => <div className="device-item" key={d.name}><d.icon/><div><div className="device-name">{d.name}</div><div className="device-status"><span className="online-dot"/>Online · {d.platform}</div></div></div>)}</div></Panel>;
  if (title === 'Espaços') return <Panel title="Espaço atual"><div className="space-switch"><AppIcon icon={WalletCards} tone="lime"/><span>{presentationAccount.spaceName}</span><span className="pro-badge">Pro</span></div><div className="storage-track" style={{ '--storage-progress': `${presentationStoragePercent}%` } as CSSProperties}/><p className="project-meta">{presentationAccount.storageUsedGb} GB de {presentationAccount.storageLimitGb} GB</p></Panel>;
  if (title === 'Configurações') return <Panel title="Aparência"><div className="desktop-settings-row"><span>Tema</span><Button variant="secondary" onClick={onTheme}>{theme === 'light' ? <Sun/> : <Moon/>}{theme === 'light' ? 'Claro' : 'Escuro'}</Button></div><div className="desktop-settings-row"><span>Visualização</span><Button variant="secondary" onClick={onCentral}><LayoutGrid/>Voltar à central</Button></div></Panel>;
  if (title === 'Aura' || title === 'Inteligência') return <><div className="desktop-content-heading"><Sparkles/><h2>Aura</h2></div><form className="aura-search" onSubmit={e => { e.preventDefault(); if (prompt.trim()) setSent(true); }}><Sparkles className="aura-star"/><input aria-label="Pergunte ao Aura" placeholder="Pergunte ao Aura ou descreva uma tarefa..." value={prompt} onChange={e => { setPrompt(e.target.value); setSent(false); }}/><Button type="submit" className="send-button" aria-label="Enviar ao Aura"><Send/></Button></form>{sent && <p className="desktop-unconnected">Aura ainda não está conectada a um serviço de inteligência artificial.</p>}</>;
  return <div className="desktop-empty"><AppIcon icon={favorites.find(a => a.name === title)?.icon ?? LayoutGrid} tone={favorites.find(a => a.name === title)?.tone ?? 'green'}/><h2>{title}</h2><p>Este aplicativo ainda não está conectado.</p></div>;
}

type NavigationProps = { onSidebarChange: (mode: 'collapsed' | 'expanded') => void; state: DesktopState; dispatch: Dispatch<DesktopAction>; view: 'central' | 'desktop'; onToggleView: () => void; onCentral: () => void };

// The same mounted navigation owns the launcher, view toggle and all running apps.
export function WorkspaceNavigation({ state, dispatch, view, onToggleView, onCentral, onSidebarChange }: NavigationProps) {
  const [startOpen, setStartOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigationHost = useRef<HTMLElement>(null);
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
  const activeDestination = activeWindow ? (projects.some(project => project.name === activeWindow.title) ? 'Projetos' : activeWindow.title === 'Inteligência' ? 'Aura' : activeWindow.title) : null;
  const homeActive = view === 'central' && activeWindow === undefined;
  const destinations = navigation.filter(item => item.name !== 'Início');
  const visibleNavigation = destinations.slice(0, visibleCount >= destinations.length ? destinations.length : Math.max(0, visibleCount - 1));
  const open = (title: string) => { dispatch({ type: 'open', title }); setStartOpen(false); };
  const returnToCentral = () => { setStartOpen(false); onCentral(); };
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') setStartOpen(false); }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler); }, []);
  return <>
    {startOpen && <><div className="desktop-menu-dismiss" onClick={() => setStartOpen(false)}/><section className="desktop-start-menu" aria-label="Menu de destinos"><div className="desktop-menu-search"><Search className="size-4"/><input autoFocus aria-label="Pesquisar destinos" placeholder="Pesquisar aplicativos e painéis" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="desktop-menu-heading">Aplicativos e painéis</div><div className="desktop-menu-apps">{[...navigation, { name: 'Notificações', icon: Bell }].filter(item => item.name !== 'Início' && item.name.toLowerCase().includes(search.toLowerCase())).map(item => <Button variant="ghost" key={item.name} className="desktop-menu-item" data-active={item.name === activeDestination} aria-current={item.name === activeDestination ? 'page' : undefined} onClick={() => open(item.name)}><item.icon/>{item.name}<ChevronRight className="ml-auto"/></Button>)}{'central'.includes(search.toLowerCase()) && <Button variant="ghost" className="desktop-menu-item" onClick={returnToCentral}><LayoutGrid/>Central<ChevronRight className="ml-auto"/></Button>}</div><div className="desktop-menu-footer"><Avatar/><span>João <small>Espaço Pessoal</small></span><Button variant="ghost" size="icon" className="ml-auto" aria-label="Configurações" title="Configurações" onClick={() => open('Configurações')}><Settings/></Button></div></section></>}
    <aside id="workspace-sidebar" className="os-sidebar workspace-sidebar" aria-label="Navegação principal">
      <div className="sidebar-header"><Brand/></div>
      <div className="sidebar-home-row">
        {navigation.filter(item => item.name === 'Início').map(item => <Button key={item.name} variant="ghost" className="os-nav-item" title={item.name} aria-label={item.name} data-window-home="true" data-active={homeActive} aria-current={homeActive ? 'page' : undefined} onClick={() => { dispatch({ type: 'show-desktop' }); returnToCentral(); }}><item.icon/><span>{item.name}</span></Button>)}
      </div>
      <nav className="os-nav" ref={navigationHost} aria-label="Destinos">
        {visibleNavigation.map(item => <Button key={item.name} variant="ghost" className="os-nav-item" title={item.name} aria-label={item.name} data-active={item.name === activeDestination} aria-current={item.name === activeDestination ? 'page' : undefined} onClick={() => open(item.name)}><item.icon/><span>{item.name}</span></Button>)}
        {visibleNavigation.length < destinations.length && <Button variant="ghost" className="os-nav-item" aria-label="Mais destinos" title="Mais destinos" data-active={destinations.some(item => item.name === activeDestination) && !visibleNavigation.some(item => item.name === activeDestination)} onClick={() => { setStartOpen(true); setSearch(''); }}><MoreHorizontal/><span>Mais</span></Button>}
      </nav>
      <AccountCard onNotifications={() => open('Notificações')} onOpen={() => open('Espaços')} onSettings={() => open('Configurações')}/>
    </aside>
    <Button variant="ghost" size="icon" className="sidebar-collapse" aria-controls="workspace-sidebar" aria-expanded={sidebarExpanded} aria-label={sidebarExpanded ? 'Recolher sidebar' : 'Expandir sidebar'} title={sidebarExpanded ? 'Recolher sidebar' : 'Expandir sidebar'} onClick={() => onSidebarChange(sidebarExpanded ? 'collapsed' : 'expanded')}>{sidebarExpanded ? <ChevronLeft/> : <ChevronRight/>}</Button>
    <footer className="desktop-taskbar workspace-navigation" aria-label="Navegação inferior"><div className="desktop-taskbar-left"><div className="desktop-running-apps" ref={dockHost} data-labels={dockLabelsVisible ? 'visible' : 'hidden'}>{state.windows.map(w => <Button variant="ghost" className="desktop-task" data-active={state.active === w.title && !w.minimized} data-minimized={w.minimized} aria-current={state.active === w.title && !w.minimized ? 'true' : undefined} title={w.title + (w.minimized ? ' — minimizado' : state.active === w.title ? ' — ativo' : ' — aberto')} key={w.title} data-window-restore={w.title} aria-label={`Restaurar janela ${w.title}`} onClick={() => dispatch({ type: 'focus', title: w.title })}><WindowAppIcon title={w.title}/><span>{w.title}</span></Button>)}</div></div><div className="desktop-tray"><Button variant="ghost" size="icon" className="workspace-view-toggle" data-workspace-switch="true" aria-label={view === 'central' ? 'Abrir área de trabalho' : 'Abrir Central'} title={view === 'central' ? 'Área de trabalho' : 'Central'} aria-pressed={view === 'desktop'} onClick={() => { setStartOpen(false); onToggleView(); }}><LayoutGrid/></Button></div></footer>
  </>;
}
