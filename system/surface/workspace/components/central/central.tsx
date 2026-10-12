import { FavoriteShortcutsPanel } from './favorite-shortcuts';
import { useEffect, useReducer, useState, type FormEvent } from 'react';
import { ChevronRight, ChevronDown, Mic, Send, Sparkles, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import dayWallpaper from '@/assets/alpine-day.jpg';
import nightWallpaper from '@/assets/alpine-night.jpg';
import { shortcuts, modes, unavailableServices } from './config';
import { useWebAccount } from './account-context';
import { useWebPreferences } from './preferences-context';
import { AppIcon, Panel } from './primitives';
import { Desktop, WorkspaceNavigation } from './desktop';
import { desktopReducer, initialDesktopState } from './desktop-state';
import { WindowLayer } from './window-layer';

export function Central() {
  const { identity, displayName, authorized } = useWebAccount();
  const [windows, dispatch] = useReducer(desktopReducer, initialDesktopState);
  const compact = windows.windows.some(window => !window.minimized && window.mode === 'compact');
  const regular = windows.windows.some(window => !window.minimized && window.mode !== 'compact');
  const [localTime, setLocalTime] = useState(() => new Date());
  const hour = localTime.getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const dateLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(localTime);
  useEffect(() => {
    const refresh = () => setLocalTime(new Date());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const { theme } = useWebPreferences();
  const [view, setView] = useState<'central' | 'desktop'>('central');
  const [sidebarMode, setSidebarMode] = useState<'auto' | 'collapsed' | 'expanded'>('auto');
  const [mode, setMode] = useState('Trabalhar');
  const [homePanel, setHomePanel] = useState<'projects' | 'favorites' | 'activity'>('projects');
  const [dialog, setDialog] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  // Central/Desktop is session presentation state, not an account preference.
  function changeView(next: 'central' | 'desktop') { setView(next); setDialog(null); }
  function openPanel(title: string) {
    if (['Adicionar dispositivo', 'Entrada por voz', 'Espaço Pessoal'].includes(title)) setDialog(title);
    else { setDialog(null); dispatch({ type: 'open', title }); }
  }
  function submitPrompt(event: FormEvent) { event.preventDefault(); if (prompt.trim()) { setDialog(null); dispatch({ type: 'open', title: 'Aura', prompt: prompt.trim() }); } }
  function openSection(name: string) { if (name === 'Início') dispatch({ type: 'show-desktop' }); else openPanel(name); }
  return <div className="window-workspace" data-view={view} data-sidebar={sidebarMode} data-compact={compact ? (windows.compactCollapsed ? 'collapsed' : 'expanded') : 'none'} data-running={windows.windows.length > 0}>
    <div className="workspace-stage">
    <div className="central-presentation" hidden={view !== 'central'}><div className="os-shell">
    <main className="os-main">
      <div className="central-content" inert={regular}>
      <section className="os-hero" aria-label="Sua central OrdaX OS">
        <img className="hero-wallpaper" src={theme === 'dark' ? nightWallpaper : dayWallpaper} alt={theme === 'dark' ? 'Lago alpino sob a luz da lua' : 'Lago alpino ao amanhecer'} width={1920} height={768}/>
        <div className="hero-content"><p className="hero-date"><time dateTime={localTime.toISOString()}>{dateLabel}</time></p><h1 className="hero-heading" title={displayName}>{greeting}{identity.state === 'signed-in' ? ', ' + displayName : ''}!</h1><p className="hero-subtitle">Organize suas ideias. Realize o que importa.</p>
          <form className="aura-search" onSubmit={submitPrompt}><Sparkles className="aura-star" fill="currentColor"/><input aria-label="Pergunte ao Aura" placeholder="Pergunte ao Aura ou descreva uma tarefa..." value={prompt} onChange={e => setPrompt(e.target.value)}/><Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Entrada por voz" aria-label="Entrada por voz" onClick={() => setDialog('Entrada por voz')}><Mic className="size-4"/></Button><Button type="submit" className="send-button" aria-label="Enviar ao Aura" title="Enviar ao Aura"><Send className="size-4" fill="currentColor"/></Button></form>
          <div className="aura-modes" aria-label="Modo da Aura">{modes.map(item => <Button variant="ghost" className="mode-chip" key={item.name} data-active={mode === item.name} aria-pressed={mode === item.name} onClick={() => setMode(item.name)}><item.icon/>{item.name}</Button>)}</div>
        </div>
      </section>
      <div className="mobile-section-title"><span>Acesso rápido</span><Button variant="ghost" className="panel-action" onClick={() => openPanel('Aplicativos')}>Ver todos</Button></div>
      <section className="quick-grid" aria-label="Acesso rápido">{shortcuts.map(item => <Button variant="ghost" className="quick-item" key={item.name} onClick={() => openSection(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><div className="quick-text"><div className="quick-title">{item.name}</div><div className="quick-caption">{item.caption}</div></div><ChevronRight className="size-3 shrink-0 text-muted-foreground"/></Button>)}</section>
      <div className="home-panel-tabs" role="group" aria-label="Painel da Central">{[{ id: 'projects' as const, label: 'Projetos' }, { id: 'favorites' as const, label: 'Apps' }, { id: 'activity' as const, label: 'Atividade' }].map(panel => <Button variant="ghost" key={panel.id} aria-pressed={homePanel === panel.id} onClick={() => setHomePanel(panel.id)}>{panel.label}</Button>)}</div>
      <div className="content-grid" data-home-panel={homePanel}>
        <Panel className="projects-panel" title="Projetos recentes" action="Ver todos" onAction={() => openPanel('Projetos')}><p className="service-state">{unavailableServices.projects}</p></Panel>
        <FavoriteShortcutsPanel className="favorites-panel" onOpen={openPanel}/>
        <Panel title="Atividades recentes" action="Ver todas" onAction={() => openPanel('Atividades')} className="activity-panel"><p className="service-state">{unavailableServices.activity}</p></Panel>
      </div>
      <div className="lower-grid">
        <Panel title={authorized.activeSpace ? "Space atual" : "Seus Spaces"}><Button variant="ghost" className="space-switch" onClick={() => openPanel(identity.state === 'signed-in' ? 'Espaços' : 'Minha conta')}><AppIcon icon={WalletCards} tone="lime"/><span>{authorized.activeSpace?.name ?? (authorized.ready ? 'Escolher um Space' : 'Consultar meus Spaces')}</span><ChevronDown className="ml-auto size-3"/></Button></Panel>
        <Panel title="Dispositivos conectados"><p className="service-state">{unavailableServices.devices}</p></Panel>
      </div>
      </div>
    </main>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialog}</DialogTitle><DialogDescription>{dialog === 'Entrada por voz' ? unavailableServices.intelligence : 'OrdaX OS Web'}</DialogDescription></DialogHeader>
      {dialog === 'Espaço Pessoal' && <Button variant="secondary" onClick={() => openPanel('Espaços')}>Consultar meus Spaces<ChevronRight/></Button>}
      {dialog === 'Adicionar dispositivo' && <p className="service-state">{unavailableServices.devices}</p>}
    </DialogContent></Dialog>
  </div></div>
    <div className="desktop-presentation" hidden={view !== 'desktop'}><Desktop theme={theme} onCentral={() => changeView('central')} dispatch={dispatch}/></div>
    </div>
    <div className="compact-reservation" aria-hidden="true"/>
    <WorkspaceNavigation onSidebarChange={setSidebarMode} state={windows} dispatch={dispatch} view={view} onToggleView={() => changeView(view === 'central' ? 'desktop' : 'central')} onCentral={() => changeView('central')}/>
    <WindowLayer state={windows} dispatch={dispatch} onCentral={() => { dispatch({ type: 'show-desktop' }); changeView('central'); }}/>
  </div>;
}
