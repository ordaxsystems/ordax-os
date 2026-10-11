import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, FolderKanban, Layers3, Monitor, Smartphone, Tablet, UserRound, ChevronRight, ChevronDown, Clock3, Download, RefreshCw, Package, ShieldCheck, CheckCircle2, Sparkles, Search, Folder, LayoutGrid, Activity, Boxes, Ellipsis } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AppTile } from './primitives';
import { IntelligenceSurface } from '@/components/intelligence/surface';
import { useIntelligenceSession } from '@/components/intelligence/session';
import { getWebApp, homeDemo, type WebAppId } from '@/lib/web/model';
import landscape from '@/assets/ordax-landscape.jpg';
import bay from '@/assets/demo-salvador-1.jpg';

type Detail = 'projects' | 'apps' | 'activity' | 'devices' | 'overview';
type Project = typeof homeDemo.projects[number];
const activityIcons = { download: Download, sync: RefreshCw, app: Package, security: ShieldCheck };
const deviceIcons = { desktop: Monitor, phone: Smartphone, tablet: Tablet };
function Heading({ title, action = 'Ver todos', onClick }: { title: string; action?: string; onClick: () => void }) {
  return <div className="web-home-panel-heading"><h2>{title}</h2><Button variant="ghost" onClick={onClick}>{action}<ChevronRight/></Button></div>;
}
function ProjectCards({ preview = false, onSelect }: { preview?: boolean; onSelect: (project: Project, trigger: HTMLButtonElement) => void }) {
  return <div className={'web-home-projects ' + (preview ? 'web-home-project-preview' : '')}>{homeDemo.projects.map(project => <Button variant="ghost" className="web-home-project-card" key={project.id} onClick={event => onSelect(project, event.currentTarget)} title={'Ver projeto de demonstração: ' + project.name}>
    <span className={'web-home-cover web-home-cover-' + project.cover}>{project.cover === 'landscape' || project.cover === 'bay' ? <img src={project.cover === 'bay' ? bay : landscape} alt="" width={90} height={110}/> : project.cover === 'apps' ? <Boxes/> : <Layers3/>}</span>
    <span className="web-home-project-copy"><strong>{project.name}</strong><small>Projeto · Space Pessoal</small><span>{project.description}</span><small><Clock3/>{project.edited}</small></span><Ellipsis className="web-home-project-dots" aria-hidden="true"/>
  </Button>)}</div>;
}
function ActivityList() {
  return <ul className="web-home-activity-list">{homeDemo.activity.map(item => { const Icon = activityIcons[item.kind]; return <li key={item.id}><span className={'web-home-event-icon event-' + item.kind}><Icon/></span><span className="web-home-event-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>{item.progress !== null ? <span className="web-home-event-progress"><progress max={100} value={item.progress} aria-label={item.title + ' — progresso de demonstração'}/><small>{item.progress}%</small></span> : <span className="web-home-event-time"><CheckCircle2/><small>{item.time}</small></span>}</li>; })}</ul>;
}
function DevicesList() {
  return <><div className="web-home-space-card"><span><UserRound/></span><div><strong>{homeDemo.space.name}</strong><small><i/>{homeDemo.space.status}</small></div><Layers3/></div><ul className="web-home-devices-list">{homeDemo.devices.map(device => { const Icon = deviceIcons[device.kind]; return <li key={device.id}><span className={'web-home-device-icon device-' + device.kind}><Icon/></span><span><strong>{device.name}</strong><small><i className={device.id === 'tablet' ? 'offline' : ''}/>{device.status}</small></span><small>{device.platform}</small></li>; })}</ul></>;
}
export function WorkspaceHome({ onOpen, onLauncher, favorites }: { onOpen: (id: WebAppId) => void; onLauncher: () => void; favorites: readonly WebAppId[] }) {
  const [demo, setDemo] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const projectTrigger = useRef<HTMLButtonElement | null>(null);
  const openDetail = (value: Detail) => { detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDetail(value); };
  const returningToProjects = useRef(false);
  const openProject = (value: Project, trigger: HTMLButtonElement) => { projectTrigger.current = trigger; if (!detail) detailTrigger.current = trigger; setProject(value); };
  useLayoutEffect(() => { if (!project && returningToProjects.current) { returningToProjects.current = false; projectTrigger.current?.focus({ preventScroll: true }); } }, [project]);
  const { dispatch } = useIntelligenceSession();
  const actions = [
    { label: 'Resumir projetos', icon: UserRound, run: () => dispatch({ type: 'draft', value: 'Analise meu projeto no Studio' }) },
    { label: 'Criar um documento', icon: Folder, run: () => onOpen('notes') },
    { label: 'Pesquisar na internet', icon: Search, run: () => onOpen('internet') },
    { label: 'Organizar arquivos', icon: FolderKanban, run: () => dispatch({ type: 'draft', value: 'Organize meus documentos por tipo' }) },
  ];
  const projects = <>{demo ? <ProjectCards onSelect={openProject}/> : <p className="web-home-unavailable">{getWebApp('projects').service}</p>}</>;
  const apps = <div className="web-home-app-grid">{favorites.map(id => <AppTile key={id} id={id} onOpen={onOpen}/>)}</div>;
  const activity = demo ? <ActivityList/> : <p className="web-home-unavailable">{getWebApp('activity').service}</p>;
  const devices = demo ? <DevicesList/> : <p className="web-home-unavailable">{getWebApp('spaces').service} Nenhum dispositivo verificado disponível.</p>;
  return <div className="web-home" data-home-mode={demo ? 'demo' : 'unavailable'}>
    <img className="web-home-atmosphere" src={landscape} alt="" width={1920} height={1088}/>
    <header className="web-welcome"><div><h1>Bem-vindo ao seu <span>OrdaX.</span></h1><Button variant="ghost" className="web-home-space" onClick={() => openDetail('devices')}><UserRound/><span>{demo ? homeDemo.space.name : 'Sem Space ativo'}</span><ChevronRight/></Button><p>Seu ambiente para continuar de onde parou.</p></div><div className="web-home-meta"><Button variant="outline" className="web-home-demo-toggle" aria-pressed={demo} onClick={() => setDemo(value => !value)}>{demo ? 'Dados de demonstração' : 'Mostrar demonstração'}</Button><p>Mais foco.<br/>Mais possibilidades.<br/>O seu mundo, em ordem.</p></div></header>
    <section className="web-home-ai" aria-label="Aura no Início"><IntelligenceSurface presentation="home" onExpand={() => onOpen('assistant')}/><div className="web-home-quick-actions">{actions.map(action => <Button variant="outline" key={action.label} onClick={action.run}><action.icon/>{action.label}</Button>)}<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="Mais ações da Aura"><Ellipsis/><span>Mais ações</span><ChevronDown/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{actions.map(action => <DropdownMenuItem key={action.label} onSelect={action.run}><action.icon/>{action.label}</DropdownMenuItem>)}<DropdownMenuItem onSelect={() => onOpen('assistant')}><Sparkles/>Abrir Aura</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></section>
    <section className="web-home-recent" aria-label="Projetos recentes"><Heading title="Continue de onde parou" onClick={() => openDetail('projects')}/>{demo ? <ProjectCards preview onSelect={openProject}/> : <p className="web-home-unavailable">{getWebApp('projects').service}<Button variant="ghost" onClick={() => onOpen('projects')}>Abrir Projetos<ArrowUpRight/></Button></p>}</section>
    <div className="web-home-dashboard"><section className="web-home-favorites" aria-label="Aplicativos favoritos"><Heading title="Aplicativos favoritos" action="Abrir todos" onClick={onLauncher}/>{apps}</section><section className="web-home-activity" aria-label="Atividade do sistema"><Heading title="Atividade do sistema" onClick={() => openDetail('activity')}/>{activity}</section><section className="web-home-devices" aria-label="Spaces e dispositivos"><Heading title="Spaces e dispositivos" action="Gerenciar" onClick={() => openDetail('devices')}/>{devices}</section></div>
    <nav className="web-home-summary" aria-label="Resumo do ambiente"><Button variant="outline" onClick={() => openDetail('projects')}><FolderKanban/><span>Projetos</span></Button><Button variant="outline" onClick={() => openDetail('apps')}><LayoutGrid/><span>Aplicativos</span></Button><Button variant="outline" onClick={() => openDetail('activity')}><Activity/><span>Atividade</span></Button><Button variant="outline" onClick={() => openDetail('overview')}><Ellipsis/><span>Mais</span></Button></nav>
    <Dialog open={detail !== null || project !== null} onOpenChange={open => { if (!open) { setDetail(null); setProject(null); } }}><DialogContent className={project ? 'web-home-dialog web-home-project-dialog' : 'web-home-dialog'} onCloseAutoFocus={event => { event.preventDefault(); if (detailTrigger.current?.getClientRects().length) detailTrigger.current.focus({ preventScroll: true }); }}><header><DialogTitle>{project?.name ?? (detail === 'projects' ? 'Continue de onde parou' : detail === 'apps' ? 'Aplicativos favoritos' : detail === 'activity' ? 'Atividade do sistema' : detail === 'devices' ? 'Spaces e dispositivos' : 'Seu ambiente')}</DialogTitle><DialogDescription>{project ? 'Projeto de demonstração · nenhum repositório ou arquivo associado.' : demo ? 'Dados de demonstração. Nenhum arquivo, dispositivo ou serviço real está sendo acessado.' : 'Os serviços ainda não estão conectados.'}</DialogDescription></header><div className="web-home-dialog-body">{project ? <section><p>{project.description}</p><Button onClick={() => { setProject(null); setDetail(null); onOpen('studio'); }}>Abrir Studio<ArrowUpRight/></Button>{detail && <Button variant="outline" onClick={() => { returningToProjects.current = true; setProject(null); }}>Voltar aos projetos</Button>}</section> : <>{(detail === 'projects' || detail === 'overview') && <section><h2>Projetos</h2>{projects}</section>}{(detail === 'apps' || detail === 'overview') && <section><h2>Aplicativos</h2>{apps}<Button variant="outline" onClick={() => { setDetail(null); onLauncher(); }}>Abrir todos os aplicativos<ArrowUpRight/></Button></section>}{(detail === 'activity' || detail === 'overview') && <section><h2>Atividade</h2>{activity}</section>}{(detail === 'devices' || detail === 'overview') && <section><h2>Spaces e dispositivos</h2>{devices}<Button variant="outline" onClick={() => { setDetail(null); onOpen('spaces'); }}>Abrir Spaces<ArrowUpRight/></Button></section>}</>}</div></DialogContent></Dialog>
  </div>;
}
