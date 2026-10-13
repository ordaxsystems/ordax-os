import { StoreExperience } from '@/components/store/store';
import { useState, type ReactNode } from 'react';
import { Folder, Search, LayoutGrid, List, ChevronRight, Clock3, Star, Trash2, Plus, ArrowUpRight, Code2, FileText, Play, Terminal, Unplug, Send, MessageSquare, ScanLine, WandSparkles, Workflow, ShieldCheck, Layers3, Image, Globe2, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getWebApp, webApps, type WebAppId } from '@/lib/web/model';
import { AppIcon, ServiceEmpty } from './primitives';
import { IntelligenceSurface } from '@/components/intelligence/surface';
import mark from '@ordax-brand/ordax-symbol.png';
import landscape from '@/assets/ordax-landscape.jpg';

export type Appearance = { wallpaper: boolean; compact: boolean };
type AppProps = { id: WebAppId; appearance: Appearance; onAppearance: (value: Appearance) => void; onOpen: (id: WebAppId) => void };
function Toolbar({ children }: { children: ReactNode }) { return <div className="web-app-toolbar">{children}</div>; }

function FilesApp() {
  const [place, setPlace] = useState('Meus arquivos');
  const [layout, setLayout] = useState('grid');
  const [query, setQuery] = useState('');
  return <div className="web-file-app"><nav className="web-app-navigation" aria-label="Locais dos arquivos">{[{ name: 'Meus arquivos', icon: Folder }, { name: 'Recentes', icon: Clock3 }, { name: 'Favoritos', icon: Star }, { name: 'Lixeira', icon: Trash2 }].map(item => <Button variant="ghost" key={item.name} className={place === item.name ? 'selected' : ''} onClick={() => setPlace(item.name)}><item.icon/><span>{item.name}</span></Button>)}<span className="web-nav-caption">File Space</span><p>Sem concessão ativa</p></nav><div className="web-app-main"><Toolbar><span className="web-crumb"><Folder/>{place}<ChevronRight/></span><div className="web-toolbar-actions"><Button size="icon" variant="ghost" aria-label="Visualização em grade" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid/></Button><Button size="icon" variant="ghost" aria-label="Visualização em lista" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><List/></Button><Button disabled size="sm"><Plus/>Novo</Button></div></Toolbar><label className="web-inline-search"><Search/><input placeholder="Buscar arquivos" aria-label="Buscar arquivos" value={query} onChange={e => setQuery(e.target.value)}/></label><ServiceEmpty title={`${place} indisponíveis`} description={getWebApp('files').service} icon={<Folder/>}/><div className="web-app-status"><ShieldCheck/>Nenhum arquivo acessado<span>{layout === 'grid' ? 'Grade' : 'Lista'}</span></div></div></div>;
}
function StudioApp({ onOpen }: Pick<AppProps, 'onOpen'>) {
  const [tab, setTab] = useState('Editor');
  const [bottom, setBottom] = useState('Terminal');
  return <div className="web-studio-app"><Toolbar><span className="web-crumb"><Code2/>Nenhum projeto aberto</span><Button disabled size="icon" variant="ghost" aria-label="Executar projeto indisponível"><Play/></Button></Toolbar><div className="web-studio-body"><nav className="web-studio-explorer"><span><Folder/>Explorador</span><p>Registro de projetos<br/>não conectado</p><Button size="sm" variant="outline" disabled>Abrir projeto</Button></nav><div className="web-studio-editor"><div className="web-app-tabs" role="tablist" aria-label="Área do Studio">{['Editor', 'Assistente', 'Preview'].map(item => <Button role="tab" aria-selected={tab === item} variant="ghost" key={item} onClick={() => setTab(item)}>{item}</Button>)}</div>{tab === 'Assistente' ? <IntelligenceSurface presentation="compact" onExpand={() => onOpen('assistant')}/> : <div className="web-studio-idle"><Code2/><h3>{tab === 'Editor' ? 'OrdaX Studio' : 'Preview indisponível'}</h3><p>{tab === 'Editor' ? 'Projeto, código e contexto no mesmo lugar.' : 'Um projeto e host autorizados são necessários.'}</p><span>Runtime não conectado</span></div>}</div></div><div className="web-studio-terminal"><div className="web-app-tabs" role="tablist" aria-label="Painel de diagnóstico">{['Terminal', 'Problemas', 'Saída'].map(item => <Button role="tab" aria-selected={bottom === item} variant="ghost" key={item} onClick={() => setBottom(item)}>{item}</Button>)}</div><p><Terminal/> {bottom === 'Terminal' ? 'Terminal indisponível — nenhum processo em execução.' : `${bottom} indisponíveis — nenhum diagnóstico recebido.`}</p></div></div>;
}
function InternetApp() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  function openAddress(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = new URL(query.includes('://') ? query : `https://${query}`);
      if (!query.trim() || !['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) { setError('Informe um endereço Web válido.'); return; }
      window.open(url.href, '_blank', 'noopener,noreferrer'); setError('');
    } catch { setError('Informe um endereço Web válido.'); }
  }
  return <div className="web-internet-app"><Toolbar><Button disabled size="icon" variant="ghost" aria-label="Voltar indisponível"><ArrowLeft/></Button><Button disabled size="icon" variant="ghost" aria-label="Avançar indisponível"><ArrowRight/></Button><Button disabled size="icon" variant="ghost" aria-label="Recarregar indisponível"><RotateCw/></Button><span className="web-browser-address"><ShieldCheck/>Nova aba</span></Toolbar><div className="web-browser-home"><img className="web-browser-earth" src={landscape} alt="Planeta azul sobre montanhas" width={1920} height={640}/><div className="web-browser-brand"><img src={mark} alt="" width={50} height={50}/><h2>OrdaX</h2></div><form onSubmit={openAddress}><Search/><input aria-label="Endereço Web" placeholder="Digite um endereço Web…" value={query} onChange={e => setQuery(e.target.value)}/><Button type="submit" variant="ghost" size="icon" aria-label="Abrir endereço em nova aba"><ArrowUpRight/></Button></form>{error && <p role="alert">{error}</p>}<div className="web-browser-links">{[{ name: 'OrdaX', url: 'https://ordax.com.br/' }, { name: 'GitHub', url: 'https://github.com/ordaxsystems' }].map(site => <Button asChild variant="outline" key={site.name}><a href={site.url} target="_blank" rel="noopener noreferrer"><Globe2/>{site.name}<ArrowUpRight/></a></Button>)}</div><p className="web-browser-note">Host não conectado · links abrem em uma nova aba</p></div></div>;
}
function ResourceApp({ id, onOpen }: { id: 'projects' | 'spaces' | 'image-viewer' | 'notes'; onOpen: AppProps['onOpen'] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Todos');
  const app = getWebApp(id);
  const labels = id === 'projects' ? ['Todos', 'Recentes', 'Favoritos'] : id === 'spaces' ? ['Todos', 'Pessoais', 'Compartilhados'] : id === 'notes' ? ['Todas', 'Favoritas'] : ['Todas', 'Favoritas'];
  return <div className="web-resource-app"><Toolbar><span className="web-crumb"><app.icon/>{app.name}</span><Button disabled size="sm"><Plus/>{id === 'spaces' ? 'Novo Space' : id === 'projects' ? 'Novo projeto' : id === 'notes' ? 'Nova nota' : 'Importar'}</Button></Toolbar><label className="web-inline-search"><Search/><input aria-label={`Buscar em ${app.name}`} placeholder={`Buscar em ${app.name.toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)}/></label><div className="web-app-tabs" role="tablist" aria-label={`Filtros de ${app.name}`}>{labels.map(label => <Button role="tab" aria-selected={filter === label} variant="ghost" onClick={() => setFilter(label)} key={label}>{label}</Button>)}</div><ServiceEmpty title={`${app.name} não conectados`} description={app.service} icon={<app.icon/>}/>{id === 'projects' && <Button className="web-resource-secondary" variant="outline" onClick={() => onOpen('studio')}><Code2/>Abrir interface do Studio<ArrowUpRight/></Button>}<div className="web-app-status"><Unplug/>{app.owner}</div></div>;
}
function SettingsApp({ appearance, onAppearance }: Pick<AppProps, 'appearance' | 'onAppearance'>) {
  return <div className="web-settings-app"><div className="web-settings-heading"><h2>Seu ambiente, seu ritmo.</h2><p>Prévia de aparência · apenas nesta sessão</p></div><div className="web-setting"><div><h3>Papel de parede</h3><p>Baía ao entardecer</p></div><Switch aria-label="Exibir papel de parede" checked={appearance.wallpaper} onCheckedChange={value => onAppearance({ ...appearance, wallpaper: value })}/></div><div className="web-setting"><div><h3>Barra lateral compacta</h3><p>Mais espaço para a área de trabalho</p></div><Switch aria-label="Barra lateral compacta" checked={appearance.compact} onCheckedChange={value => onAppearance({ ...appearance, compact: value })}/></div><div className="web-setting"><div><h3>Sincronização entre dispositivos</h3><p>Serviço oficial não conectado</p></div><Switch disabled aria-label="Sincronização indisponível" checked={false}/></div><div className="web-setting"><div><h3>Permissões do ambiente</h3><p>Nenhuma concessão de arquivos, microfone ou processos</p></div><ShieldCheck/></div></div>;
}
function StoreApp({ onOpen }: { onOpen: AppProps['onOpen'] }) {
  return <StoreExperience onOpenApp={id => { if (webApps.some(a => a.id === id)) onOpen(id as WebAppId); }}/>;
}
export function AppContent({ id, appearance, onAppearance, onOpen }: AppProps) {
  if (id === 'files') return <FilesApp/>;
  if (id === 'studio') return <StudioApp onOpen={onOpen}/>;
  if (id === 'internet') return <InternetApp/>;
  if (id === 'assistant') return <IntelligenceSurface presentation="panel" onOpenStudio={() => onOpen('studio')} onExpand={() => onOpen('assistant')}/>;
  if (id === 'settings') return <SettingsApp appearance={appearance} onAppearance={onAppearance}/>;
  if (id === 'store') return <StoreApp onOpen={onOpen}/>;
  if (id === 'projects' || id === 'spaces' || id === 'image-viewer' || id === 'notes') return <ResourceApp id={id} onOpen={onOpen}/>;
  return <ServiceEmpty title="Notificações indisponíveis" description={getWebApp(id).service}/>;
}