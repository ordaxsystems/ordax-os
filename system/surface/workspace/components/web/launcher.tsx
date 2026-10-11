import { useRef, useState } from 'react';
import { Search, LayoutGrid, Unplug, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { webApps, type WebAppId } from '@/lib/web/model';
import { AppTile } from './primitives';

export function Launcher({ open, onOpenChange, onLaunch }: { open: boolean; onOpenChange: (value: boolean) => void; onLaunch: (id: WebAppId) => void }) {
  const [query, setQuery] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('Todos');
  const visible = webApps.filter(app => app.id !== 'activity' && `${app.name} ${app.subtitle}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')) && (category === 'Todos' || (category === 'Trabalho' ? ['studio', 'projects', 'files', 'notes'].includes(app.id) : category === 'Criatividade' ? ['image-viewer', 'assistant'].includes(app.id) : ['settings', 'internet', 'spaces', 'store'].includes(app.id))));
  return <Dialog open={open} onOpenChange={value => { onOpenChange(value); if (!value) setQuery(''); }}><DialogContent className="web-launcher" onOpenAutoFocus={event => { if (window.matchMedia('(pointer: coarse)').matches) { event.preventDefault(); title.current?.focus(); } }}><DialogTitle ref={title} tabIndex={-1}><LayoutGrid/>Aplicativos</DialogTitle><DialogDescription>Conceitos de interface · serviços oficiais não conectados</DialogDescription><label className="web-launcher-search"><Search/><input ref={searchInput} aria-label="Pesquisar aplicativos" placeholder="Buscar aplicativos, ferramentas…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <Button variant="ghost" size="icon" aria-label="Limpar busca de aplicativos" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X aria-hidden="true"/></Button>}</label><div className="web-launcher-categories" role="group" aria-label="Categorias de aplicativos">{['Todos', 'Trabalho', 'Criatividade', 'Ambiente'].map(item => <Button aria-pressed={category === item} variant="ghost" key={item} onClick={() => setCategory(item)}>{item}</Button>)}</div><div className="web-launcher-grid" role="group" aria-label="Aplicativos encontrados">{visible.map(app => <AppTile id={app.id} key={app.id} onOpen={id => { onLaunch(id); onOpenChange(false); setQuery(''); }}/>)}</div>{visible.length === 0 && <p className="web-no-results" role="status">Nenhuma interface encontrada.</p>}<div className="web-launcher-footer"><Unplug/>A abertura da interface não concede acesso a dados.</div></DialogContent></Dialog>;
}