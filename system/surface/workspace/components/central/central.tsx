import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Settings, ChevronRight, ChevronDown, Sun, Moon, Mic, Send, Plus, Pencil, CheckCircle2, Menu, House, Sparkles, LayoutGrid, WalletCards, MonitorSmartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import dayWallpaper from '@/assets/alpine-day.jpg';
import nightWallpaper from '@/assets/alpine-night.jpg';
import { navigation, shortcuts, modes, favorites, projects, activities, devices } from './config';
import { AppIcon, Avatar, Brand, Panel } from './primitives';
import { Desktop } from './desktop';

export function Central() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [view, setView] = useState<'central' | 'desktop'>('central');
  const [mode, setMode] = useState('Trabalhar');
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
  function submitPrompt(event: FormEvent) { event.preventDefault(); if (prompt.trim()) setDialog('Aura'); }
  function openSection(name: string) { if (name !== 'Início') setDialog(name); }
  const themeControl = <Button variant="ghost" size="icon" className="hero-tool" onClick={toggleTheme} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} title={theme === 'light' ? 'Tema escuro' : 'Tema claro'}>{theme === 'light' ? <Sun/> : <Moon/>}</Button>;
  const notificationControl = <Button variant="ghost" size="icon" className="hero-tool bell-wrap" aria-label="Notificações" title="Notificações" onClick={() => setDialog('Notificações')}><Bell/></Button>;
  const profileControl = <Button variant="ghost" size="icon" className="hero-tool" aria-label="Perfil de João" onClick={() => setDialog('Espaço Pessoal')}><Avatar/></Button>;
  if (view === 'desktop') return <Desktop theme={theme} onTheme={toggleTheme} onCentral={() => changeView('central')}/>;
  return <div className="os-shell">
    <aside className="os-sidebar" aria-label="Navegação principal">
      <Brand/>
      <nav className="os-nav">{navigation.map(item => <Button key={item.name} variant="ghost" className="os-nav-item" data-active={item.name === 'Início'} onClick={() => openSection(item.name)}><item.icon/><span>{item.name}</span></Button>)}</nav>
      <div className="os-sidebar-bottom"><div className="sidebar-divider"/>
        <Button variant="ghost" className="os-nav-item" onClick={() => setDialog('Notificações')}><Bell/>Notificações<span className="notification-count">3</span></Button>
        <Button variant="ghost" className="os-nav-item" onClick={() => setDialog('Configurações')}><Settings/>Configurações</Button>
        <div className="account"><Button variant="ghost" className="h-auto w-full justify-start gap-2 p-0" onClick={() => setDialog('Espaço Pessoal')}><Avatar/><span className="min-w-0 flex-1 text-left"><span className="block text-[10px] font-semibold">Espaço Pessoal</span><span className="block text-[9px] text-muted-foreground">Plano Pro</span></span><ChevronRight className="size-3"/></Button><div className="storage-track"/><div className="flex items-center justify-between text-[9px]"><span><strong>128 GB</strong> de 500 GB</span><Settings className="size-3 text-muted-foreground"/></div></div>
      </div>
    </aside>
    <main className="os-main">
      <div className="central-view-toolbar"><div className="view-switch" aria-label="Visualização"><Button variant="ghost" data-active="true" aria-pressed="true"><LayoutGrid/>Central</Button><Button variant="ghost" aria-pressed="false" onClick={() => changeView('desktop')}><MonitorSmartphone/>Área de trabalho</Button></div></div>
      <header className="mobile-header"><Brand/><div className="mobile-tools">{notificationControl}{themeControl}{profileControl}</div></header>
      <section className="os-hero" aria-label="Sua central OrdaX OS">
        <img className="hero-wallpaper hero-wallpaper-day" src={dayWallpaper} alt="Lago alpino ao amanhecer" width={1920} height={768}/>
        <img className="hero-wallpaper hero-wallpaper-night" src={nightWallpaper} alt="Lago alpino sob a luz da lua" width={1920} height={768}/>
        <div className="hero-tools">{notificationControl}{themeControl}{profileControl}</div>
        <div className="hero-content"><p className="hero-date">Ter, 27 de maio de 2025</p><h1 className="hero-heading">{theme === 'dark' ? 'Boa noite, João!' : 'Bom dia, João!'}</h1><p className="hero-subtitle">{theme === 'dark' ? 'Grandes ideias também acontecem à noite.' : 'Organize suas ideias. Realize o que importa.'}</p>
          <form className="aura-search" onSubmit={submitPrompt}><Sparkles className="aura-star" fill="currentColor"/><input aria-label="Pergunte ao Aura" placeholder="Pergunte ao Aura ou descreva uma tarefa..." value={prompt} onChange={e => setPrompt(e.target.value)}/><Button variant="ghost" size="icon" className="size-7 text-muted-foreground" title="Entrada por voz" aria-label="Entrada por voz" onClick={() => setDialog('Entrada por voz')}><Mic className="size-4"/></Button><Button type="submit" className="send-button" aria-label="Enviar ao Aura" title="Enviar ao Aura"><Send className="size-4" fill="currentColor"/></Button></form>
          <div className="aura-modes" aria-label="Modo da Aura">{modes.map(item => <Button variant="ghost" className="mode-chip" key={item.name} data-active={mode === item.name} aria-pressed={mode === item.name} onClick={() => setMode(item.name)}><item.icon/>{item.name}</Button>)}</div>
        </div>
      </section>
      <div className="mobile-section-title"><span>Acesso rápido</span><Button variant="ghost" className="panel-action" onClick={() => setDialog('Aplicativos')}>Ver todos</Button></div>
      <section className="quick-grid" aria-label="Acesso rápido">{shortcuts.map(item => <Button variant="ghost" className="quick-item" key={item.name} onClick={() => openSection(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><div className="quick-text"><div className="quick-title">{item.name}</div><div className="quick-caption">{item.caption}</div></div><ChevronRight className="size-3 shrink-0 text-muted-foreground"/></Button>)}</section>
      <div className="content-grid">
        <Panel title="Projetos recentes" action="Ver todos" onAction={() => setDialog('Projetos')}><div className="project-list">{projects.map(project => <Button variant="ghost" key={project.name} className="project-row" onClick={() => setDialog(project.name)}><span className="project-thumb" data-tone={project.tone}>{project.image ? <img src={dayWallpaper} alt="Bay of All Saints" loading="lazy"/> : <project.icon className="size-6"/>}</span><span className="min-w-0"><span className="project-name block truncate">{project.name}</span><span className="project-meta block truncate">{project.detail}</span></span><ChevronRight className="size-3 text-muted-foreground"/></Button>)}</div></Panel>
        <Panel title="Aplicativos favoritos" action={<><Pencil/>{editing ? 'Concluir' : 'Editar'}</>} onAction={() => setEditing(!editing)}><div className="favorite-grid">{favorites.filter(item => !addedApps.includes(`hidden:${item.name}`)).map(item => <Button variant="ghost" className="favorite-tile" key={item.name} aria-label={editing ? `Remover ${item.name} dos favoritos` : item.name} onClick={() => editing ? setAddedApps([...addedApps, `hidden:${item.name}`]) : setDialog(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span>{item.name}</span></Button>)}<Button variant="ghost" className="favorite-tile" onClick={() => setDialog('Adicionar aplicativo')}><Plus className="size-6 text-muted-foreground"/><span>Adicionar</span></Button></div></Panel>
        <Panel title="Atividades recentes" action="Ver todas" onAction={() => setDialog('Atividades')} className="activity-panel"><div className="activity-list">{activities.map((item,index) => <div className="activity-row" key={item.title}>{index === 0 ? <CheckCircle2 className="size-6 activity-success"/> : <AppIcon icon={item.icon} tone={item.tone}/>}<div className="min-w-0"><div className="project-name truncate">{item.title}</div><div className="project-meta truncate">{item.detail}</div></div><time className="activity-time">{item.time}</time></div>)}</div></Panel>
      </div>
      <div className="lower-grid">
        <Panel title="Espaço atual"><Button variant="ghost" className="space-switch" onClick={() => setDialog('Espaços')}><AppIcon icon={WalletCards} tone="lime"/><span>Espaço Pessoal</span><span className="pro-badge">Pro</span><ChevronDown className="ml-auto size-3"/></Button></Panel>
        <Panel title="Dispositivos conectados"><div className="device-grid">{devices.map(item => <div className="device-item" key={item.name}><item.icon/><div className="min-w-0"><div className="device-name truncate">{item.name}</div><div className="device-status"><span className="online-dot"/>Online · {item.platform}</div></div></div>)}<Button variant="outline" className="add-device" onClick={() => setDialog('Adicionar dispositivo')}><Plus/>Adicionar</Button></div></Panel>
      </div>
      <footer className="os-footer"><span>OrdaX OS Web</span><span><span className="online-dot"/>Tudo em seu lugar.</span></footer>
    </main>
    <nav className="mobile-nav" aria-label="Navegação móvel">{[{ name: 'Início', icon: House }, { name: 'Aura', icon: Sparkles }, { name: 'Apps', icon: LayoutGrid }, { name: 'Espaços', icon: WalletCards }, { name: 'Mais', icon: Menu }].map(item => <Button variant="ghost" className="mobile-nav-item" key={item.name} data-active={item.name === 'Início'} onClick={() => openSection(item.name === 'Apps' ? 'Aplicativos' : item.name)}><item.icon/>{item.name}</Button>)}</nav>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent><DialogHeader><DialogTitle>{dialog}</DialogTitle><DialogDescription>{dialog === 'Aura' || dialog === 'Entrada por voz' ? 'Aura ainda não está conectada a um serviço de inteligência artificial.' : 'Espaço de apresentação · OrdaX OS Web'}</DialogDescription></DialogHeader>
      {dialog === 'Aura' && prompt && <div className="rounded-md bg-secondary p-4 text-sm">{prompt}</div>}
      {(dialog === 'Projetos' || projects.some(p => p.name === dialog)) && <div className="modal-list">{projects.filter(p => dialog === 'Projetos' || p.name === dialog).map(p => <div className="flex items-center gap-3 rounded-md bg-secondary p-3" key={p.name}><AppIcon icon={p.icon} tone={p.tone}/><div><div className="project-name">{p.name}</div><div className="project-meta">{p.detail}</div></div></div>)}</div>}
      {(dialog === 'Notificações' || dialog === 'Atividades') && <div className="modal-list">{activities.map(item => <div className="activity-row" key={item.title}><AppIcon icon={item.icon} tone={item.tone}/><div><div className="project-name">{item.title}</div><div className="project-meta">{item.detail}</div></div><time className="activity-time">{item.time}</time></div>)}</div>}
      {(dialog === 'Aplicativos' || dialog === 'Adicionar aplicativo') && <div className="favorite-grid">{favorites.map(item => <Button variant="ghost" className="favorite-tile" key={item.name} onClick={() => { if (dialog === 'Adicionar aplicativo') { setAddedApps(addedApps.filter(a => a !== `hidden:${item.name}`)); setDialog(null); } else setDialog(item.name); }}><AppIcon icon={item.icon} tone={item.tone}/>{item.name}</Button>)}</div>}
      {dialog === 'Configurações' && <div className="flex items-center justify-between border-b border-border py-4"><span>Aparência</span><Button variant="secondary" onClick={toggleTheme}>{theme === 'light' ? <Sun/> : <Moon/>}{theme === 'light' ? 'Claro' : 'Escuro'}</Button></div>}
      {(dialog === 'Mais' || dialog === 'Espaços' || dialog === 'Espaço Pessoal') && <div className="modal-list">{(dialog === 'Mais' ? navigation.slice(2).map(n => n.name).concat('Configurações') : ['Espaço Pessoal']).map(name => <Button variant="secondary" className="justify-between" key={name} onClick={() => setDialog(name)}>{name}<ChevronRight/></Button>)}</div>}
      {(dialog === 'Dispositivos' || dialog === 'Adicionar dispositivo') && <div className="modal-list">{devices.map(item => <div className="device-item" key={item.name}><item.icon/><span>{item.name}</span></div>)}</div>}
    </DialogContent></Dialog>
  </div>;
}
