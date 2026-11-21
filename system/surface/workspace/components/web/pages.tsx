import { useState } from 'react';
import { Search } from 'lucide-react';
import { webWorkspaceEntries, type WebAppId, type WebView } from '@/lib/web/model';
import { AppContent, type Appearance } from './app-content';
import { AppTile } from './primitives';
import { WorkspaceHome } from './home';
import { StoreCatalogSummary } from '../store/catalog-summary';
import { IntelligenceSurface } from '@/components/intelligence/surface';
export function WorkspacePages({ page, onOpen, onLauncher, appearance, onAppearance }: { page: WebView; onOpen: (id: WebAppId) => void; onLauncher: () => void; appearance: Appearance; onAppearance: (value: Appearance) => void }) {
  const [query, setQuery] = useState('');
  return <div className="web-pages">{(['home', 'assistant', 'projects', 'spaces', 'apps', 'store'] as const).map(id => <section key={id} hidden={page !== id} className={`web-page web-page-${id}`} aria-label={`Página ${id === 'assistant' ? 'OrdaX Intelligence' : id === 'home' ? 'Início' : id === 'projects' ? 'Projetos' : id === 'spaces' ? 'Spaces' : id === 'apps' ? 'Aplicativos' : 'Loja'}`}>
    {id === 'home' ? <WorkspaceHome onOpen={onOpen} onLauncher={onLauncher}/> : id === 'assistant' ? <IntelligenceSurface presentation="page" onOpenStudio={() => onOpen('studio')}/> : id === 'store' ? <AppContent id={id} onOpen={onOpen} appearance={appearance} onAppearance={onAppearance}/> : <><header className="web-page-heading"><div><span>WORKSPACE / {id === 'projects' ? 'PROJETOS' : id === 'apps' ? 'APLICATIVOS' : 'SPACES'}</span><h1>{id === 'projects' ? 'Projetos' : id === 'spaces' ? 'Spaces' : id === 'apps' ? 'Recursos do ambiente' : 'Loja'}</h1></div><small>{id === 'apps' ? 'Ferramentas desta sessão · nenhuma instalação presumida' : 'Disponibilidade sujeita à conexão oficial'}</small></header>{id === 'apps' ? <><label className="web-inline-search"><Search/><input aria-label="Buscar aplicativos na página" placeholder="Buscar aplicativos" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="web-page-apps">{webWorkspaceEntries.filter(app => app.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).map(app => <AppTile key={app.id} id={app.id} onOpen={onOpen}/>)}</div>{!query.trim() && <section aria-label="Aplicativos do catálogo oficial"><h2>Estado oficial dos aplicativos</h2><StoreCatalogSummary limit={12}/></section>}</> : <AppContent id={id} onOpen={onOpen} appearance={appearance} onAppearance={onAppearance}/>}</>}
  </section>)}</div>;
}
