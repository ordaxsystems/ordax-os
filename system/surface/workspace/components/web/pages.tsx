import { useState } from 'react';
import { Search } from 'lucide-react';
import { webApps, type WebAppId, type WebView } from '@/lib/web/model';
import { AppContent, type Appearance } from './app-content';
import { AppTile } from './primitives';
import { WorkspaceHome } from './home';
import { IntelligenceSurface } from '@/components/intelligence/surface';
export function WorkspacePages({ page, onOpen, onLauncher, appearance, onAppearance }: { page: WebView; onOpen: (id: WebAppId) => void; onLauncher: () => void; appearance: Appearance; onAppearance: (value: Appearance) => void }) {
  const [query, setQuery] = useState('');
  return <div className="web-pages">{(['home', 'assistant', 'projects', 'spaces', 'apps', 'store'] as const).map(id => <section key={id} hidden={page !== id} className={`web-page web-page-${id}`} aria-label={`Página ${id === 'assistant' ? 'OrdaX Intelligence' : id === 'home' ? 'Início' : id === 'projects' ? 'Projetos' : id === 'spaces' ? 'Spaces' : id === 'apps' ? 'Aplicativos' : 'Loja'}`}>
    {id === 'home' ? <WorkspaceHome onOpen={onOpen} onLauncher={onLauncher}/> : id === 'assistant' ? <IntelligenceSurface presentation="page" onOpenStudio={() => onOpen('studio')}/> : id === 'store' ? <AppContent id={id} onOpen={onOpen} appearance={appearance} onAppearance={onAppearance}/> : <><header className="web-page-heading"><div><span>WORKSPACE / {id === 'projects' ? 'PROJETOS' : id === 'apps' ? 'APLICATIVOS' : 'SPACES'}</span><h1>{id === 'projects' ? 'Projetos' : id === 'spaces' ? 'Spaces' : id === 'apps' ? 'Aplicativos' : 'Loja'}</h1></div><small>Protótipo · serviços não conectados</small></header>{id === 'apps' ? <><label className="web-inline-search"><Search/><input aria-label="Buscar aplicativos na página" placeholder="Buscar aplicativos" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="web-page-apps">{webApps.filter(app => !['projects', 'spaces', 'store', 'activity'].includes(app.id) && app.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(app => <AppTile key={app.id} id={app.id} onOpen={onOpen}/>)}</div></> : <AppContent id={id} onOpen={onOpen} appearance={appearance} onAppearance={onAppearance}/>}</>}
  </section>)}</div>;
}
