import { useEffect, useReducer, useState, type FormEvent } from 'react';
import { ChevronRight, ChevronDown, Mic, Send, Plus, Pencil, CheckCircle2, Sparkles, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import dayWallpaper from '@/assets/alpine-day.jpg';
import nightWallpaper from '@/assets/alpine-night.jpg';
import { shortcuts, modes, favorites, projects, activities, devices } from './config';
import { AppIcon, Panel } from './primitives';
import { Desktop, WorkspaceNavigation } from './desktop';
import { desktopReducer, initialDesktopState } from './desktop-state';
import { WindowLayer } from './window-layer';

export function Central() {
  const [windows, dispatch] = useReducer(desktopReducer, initialDesktopState);
  const compact = windows.windows.some(window => !window.minimized && window.mode === 'compact');
  const regular = windows.windows.some(window => !window.minimized && window.mode !== 'compact');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [view, setView] = useState<'central' | 'desktop'>('central');
  const [sidebarMode, setSidebarMode] = useState<'auto' | 'collapsed' | 'expanded'>('auto');
  const [mode, setMode] = useState('Trabalhar');
  const [homePanel, setHomePanel] = useState<'projects' | 'favorites' | 'activity'>('projects');
  const [dialog, setDialog] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [editing, setEditing] = useState(false);
  const [addedApps, setAddedApps] = useState<string[]>([]);
  useEffect(() => {
    const saved = localStorage.getItem('ordax-theme');
    if (saved === 'dark') setTheme('dark');
    if (localStorage.getItem('ordax-view') === 'desktop') setView('desktop');
  }, []);
  useEffect(() => { document.documentElement.dataset['theme'] = theme; }, [theme]);
  function toggleTheme() { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); localStorage.setItem('ordax-theme', next); }
  function changeView(next: 'central' | 'desktop') { setView(next); localStorage.setItem('ordax-view', next); setDialog(null); }
  function openPanel(title: string) {
    if (['Adicionar aplicativo', 'Adicionar dispositivo', 'Entrada por voz', 'Espaço Pessoal'].includes(title)) setDialog(title);
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
        <img className="hero-wallpaper hero-wallpaper-day" src={dayWallpaper} alt="Lago alpino ao amanhecer" width={1920} height={768}/>
        <img className="hero-wallpaper hero-wallpaper-night" src={nightWallpaper} alt="Lago alpino sob a luz da lua" width={1920} height={768}/>
        <div className="hero-content"><p className="hero-date">Ter, 27 de maio de 2025</p><h1 className="hero-heading">{theme === 'dark' ? 'Boa noite, João!' : 'Bom dia, João!'}</h1><p className="hero-subtitle">{theme === 'dark' ? 'Grandes ideias também acontecem à noite.' : 'Organize suas ideias. Realize o que importa.'}</p>
          <form className="aura-search" onSubmit={submitPrompt}><Sparkles className="aura-star" fill="currentColor"/><input aria-label="Pergunte ao Aura" placeholder="Pergunte ao Aura ou descreva uma tarefa..." value={prompt} onChange={e => setPrompt(e.target.value)}/><Button type="button" variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Entrada por voz" aria-label="Entrada por voz" onClick={() => setDialog('Entrada por voz')}><Mic className="size-4"/></Button><Button type="submit" className="send-button" aria-label="Enviar ao Aura" title="Enviar ao Aura"><Send className="size-4" fill="currentColor"/></Button></form>
          <div className="aura-modes" aria-label="Modo da Aura">{modes.map(item => <Button variant="ghost" className="mode-chip" key={item.name} data-active={mode === item.name} aria-pressed={mode === item.name} onClick={() => setMode(item.name)}><item.icon/>{item.name}</Button>)}</div>
        </div>
      </section>
      <div className="mobile-section-title"><span>Acesso rápido</span><Button variant="ghost" className="panel-action" onClick={() => openPanel('Aplicativos')}>Ver todos</Button></div>
      <section className="quick-grid" aria-label="Acesso rápido">{shortcuts.map(item => <Button variant="ghost" className="quick-item" key={item.name} onClick={() => openSection(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><div className="quick-text"><div className="quick-title">{item.name}</div><div className="quick-caption">{item.caption}</div></div><ChevronRight className="size-3 shrink-0 text-muted-foreground"/></Button>)}</section>
      <div className="home-panel-tabs" role="group" aria-label="Painel da Central">{[{ id: 'projects' as const, label: 'Projetos' }, { id: 'favorites' as const, label: 'Apps' }, { id: 'activity' as const, label: 'Atividade' }].map(panel => <Button variant="ghost" key={panel.id} aria-pressed={homePanel === panel.id} onClick={() => setHomePanel(panel.id)}>{panel.label}</Button>)}</div>
      <div className="content-grid" data-home-panel={homePanel}>
        <Panel className="projects-panel" title="Projetos recentes" action="Ver todos" onAction={() => openPanel('Projetos')}><div className="project-list">{projects.map(project => <Button variant="ghost" key={project.name} className="project-row" onClick={() => openPanel(project.name)}><span className="project-thumb" data-tone={project.tone}>{project.image ? <img src={dayWallpaper} alt="Bay of All Saints" loading="lazy"/> : <project.icon className="size-6"/>}</span><span className="min-w-0"><span className="project-name block truncate">{project.name}</span><span className="project-meta block truncate">{project.detail}</span></span><ChevronRight className="size-3 text-muted-foreground"/></Button>)}</div></Panel>
        <Panel className="favorites-panel" title="Aplicativos favoritos" action={<><Pencil/>{editing ? 'Concluir' : 'Editar'}</>} onAction={() => setEditing(!editing)}><div className="favorite-grid">{favorites.filter(item => !addedApps.includes(`hidden:${item.name}`)).map(item => <Button variant="ghost" className="favorite-tile" key={item.name} aria-label={editing ? `Remover ${item.name} dos favoritos` : item.name} onClick={() => editing ? setAddedApps(previous => [...previous, `hidden:${item.name}`]) : openPanel(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></Button>)}<Button variant="ghost" className="favorite-tile" onClick={() => setDialog('Adicionar aplicativo')}><Plus className="size-6 text-muted-foreground"/><span>Adicionar</span></Button></div></Panel>
        <Panel title="Atividades recentes" action="Ver todas" onAction={() => openPanel('Atividades')} className="activity-panel"><div className="activity-list">{activities.map((item,index) => <div className="activity-row" key={item.title}>{index === 0 ? <CheckCircle2 className="size-6 activity-success"/> : <AppIcon icon={item.icon} tone={item.tone}/>}<div className="min-w-0"><div className="project-name truncate">{item.title}</div><div className="project-meta truncate">{item.detail}</div></div><time className="activity-time">{item.time}</time></div>)}</div></Panel>
      </div>
      <div className="lower-grid">
        <Panel title="Espaço atual"><Button variant="ghost" className="space-switch" onClick={() => openPanel('Espaços')}><AppIcon icon={WalletCards} tone="lime"/><span>Espaço Pessoal</span><span className="pro-badge">Pro</span><ChevronDown className="ml-auto size-3"/></Button></Panel>
        <Panel title="Dispositivos conectados"><div className="device-grid">{devices.map(item => <div className="device-item" key={item.name}><item.icon/><div className="min-w-0"><div className="device-name truncate">{item.name}</div><div className="device-status"><span className="online-dot"/>Online · {item.platform}</div></div></div>)}<Button variant="outline" className="add-device" onClick={() => setDialog('Adicionar dispositivo')}><Plus/>Adicionar</Button></div></Panel>
      </div>
      <footer className="os-footer home-footer"><select className="home-mode-select" aria-label="Modo da Aura" value={mode} onChange={event => setMode(event.target.value)}>{modes.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></footer>
      </div>
    </main>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialog}</DialogTitle><DialogDescription>{dialog === 'Entrada por voz' ? 'Aura ainda não está conectada a um serviço de inteligência artificial.' : 'Espaço de apresentação · OrdaX OS Web'}</DialogDescription></DialogHeader>
      {dialog === 'Adicionar aplicativo' && <div className="favorite-grid">{favorites.map(item => <Button variant="ghost" className="favorite-tile" key={item.name} onClick={() => { if (dialog === 'Adicionar aplicativo') { setAddedApps(previous => previous.filter(a => a !== `hidden:${item.name}`)); setDialog(null); } else openPanel(item.name); }}><AppIcon icon={item.icon} tone={item.tone}/>{item.name}</Button>)}</div>}
      {dialog === 'Espaço Pessoal' && <div className="modal-list"><Button variant="secondary" className="justify-between" onClick={() => openPanel('Espaços')}>Espaço Pessoal<ChevronRight/></Button></div>}
      {dialog === 'Adicionar dispositivo' && <div className="modal-list">{devices.map(item => <div className="device-item" key={item.name}><item.icon/><span>{item.name}</span></div>)}</div>}
    </DialogContent></Dialog>
  </div></div>
    <div className="desktop-presentation" hidden={view !== 'desktop'}><Desktop theme={theme} onTheme={toggleTheme} onCentral={() => changeView('central')} dispatch={dispatch}/></div>
    </div>
    <div className="compact-reservation" aria-hidden="true"/>
    <WorkspaceNavigation onSidebarChange={setSidebarMode} state={windows} dispatch={dispatch} view={view} onToggleView={() => changeView(view === 'central' ? 'desktop' : 'central')} onCentral={() => changeView('central')}/>
    <WindowLayer state={windows} dispatch={dispatch} theme={theme} onTheme={toggleTheme} onCentral={() => { dispatch({ type: 'show-desktop' }); changeView('central'); }}/>
  </div>;
}
