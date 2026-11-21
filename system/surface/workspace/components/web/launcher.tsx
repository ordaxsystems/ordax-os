import { useRef, useState } from 'react';
import { Search, LayoutGrid, Unplug, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { webWorkspaceEntries, type WebAppId } from '@/lib/web/model';
import { AppTile } from './primitives';
import { StoreCatalogSummary } from '../store/catalog-summary';

// A launcher must never imply that a preview or documented target is installed.
// The Web entries are browser-local tools and the official Store view; the Store
// itself still validates authority and catalog readiness via its existing port.
export function Launcher({ open, onOpenChange, onLaunch }: { open: boolean; onOpenChange: (value: boolean) => void; onLaunch: (id: WebAppId) => void }) {
  const [query, setQuery] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const visible = webWorkspaceEntries.filter(app => `${app.name} ${app.subtitle}`.toLocaleLowerCase('pt-BR').includes(normalized));
  return <Dialog open={open} onOpenChange={value => { onOpenChange(value); if (!value) setQuery(''); }}>
    <DialogContent className="web-launcher" onOpenAutoFocus={event => { if (window.matchMedia('(pointer: coarse)').matches) { event.preventDefault(); title.current?.focus(); } }}>
      <DialogTitle ref={title} tabIndex={-1}><LayoutGrid/>Recursos do ambiente</DialogTitle>
      <DialogDescription>Ferramentas acessíveis nesta sessão. A Loja informa quando o catálogo oficial estiver indisponível; esta lista não confirma aplicativos instalados.</DialogDescription>
      <label className="web-launcher-search"><Search/><input ref={searchInput} aria-label="Pesquisar recursos" placeholder="Buscar recursos…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <Button variant="ghost" size="icon" aria-label="Limpar busca de recursos" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X aria-hidden="true"/></Button>}</label>
      <div className="web-launcher-grid" role="group" aria-label="Recursos encontrados">{visible.map(app => <AppTile id={app.id} key={app.id} onOpen={id => { onLaunch(id); onOpenChange(false); setQuery(''); }}/>)}</div>
      {visible.length === 0 && <p className="web-no-results" role="status">Nenhum recurso corresponde à busca.</p>}
      {!query.trim() && <section aria-label="Aplicativos do catálogo oficial"><h3>Estado oficial dos aplicativos</h3><StoreCatalogSummary limit={8}/></section>}
      <div className="web-launcher-footer"><Unplug/>A abertura de um recurso não concede acesso a dados nem instala aplicativos.</div>
    </DialogContent>
  </Dialog>;
}
