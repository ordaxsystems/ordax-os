import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Layers3, PanelsTopLeft, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { getWebApp, webNavigation, type WebAppId, type WebView } from '@/lib/web/model';

type Entry = { id: string; title: string; icon: typeof MoreHorizontal; kind: 'page' | 'app' | 'panel'; app?: WebAppId };
// Route destinations use the existing catalog. Shortcuts only add apps absent from it.
const entries: Entry[] = [...webNavigation, ...(['studio', 'notes', 'settings'] as const).map(id => ({ id, title: getWebApp(id).name, icon: getWebApp(id).icon, kind: 'app' as const, app: id }))];
const settings = entries.find(item => item.id === 'settings')!;
const destinations = entries.filter(item => item !== settings);
type Props = {
  page: WebView;
  intelligence: boolean;
  active?: WebAppId;
  adaptive?: boolean;
  onOpen: (id: WebAppId) => void;
  onNavigate: (view: WebView) => void;
  onSelectSpace: () => void;
  onArrange: () => void;
};

export function WorkspaceNavigation({ page, intelligence, active, adaptive = false, onOpen, onNavigate, onSelectSpace, onArrange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!adaptive || !node) return;
    const observer = new ResizeObserver(([entry]) => {
      const row = parseFloat(getComputedStyle(node).getPropertyValue('--web-navigation-row-height'));
      setCapacity(Math.max(0, Math.floor(entry.contentRect.height / row) - 1));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [adaptive]);
  // Reserve Mais and keep Ajustes visible whenever one destination fits.
  const slots = adaptive ? capacity : entries.length;
  const visible = slots === 0 ? [] : [...destinations.slice(0, Math.max(0, slots - 1)), settings];
  const hidden = entries.filter(item => !visible.includes(item));
  const selected = (item: Entry) => item.kind === 'page' ? page === item.id && !active : item.kind === 'panel' ? intelligence : active === item.app;
  const content = (item: Entry) => <><item.icon/><span>{item.title}</span></>;
  const open = (item: Entry) => { if (item.app) onOpen(item.app); };
  return <div ref={root} className="web-navigation-content" data-adaptive={adaptive}>
    <nav aria-label="Navegação OrdaX Web">
      {visible.map(item => item.kind === 'page'
        ? <Button asChild variant="ghost" key={item.id} className={'web-nav-link ' + (selected(item) ? 'selected' : '')}><Link to="." search={{ view: item.id as WebView }} title={item.title} aria-current={selected(item) ? 'page' : undefined} onClick={() => onNavigate(item.id as WebView)}>{content(item)}</Link></Button>
        : <Button variant="ghost" key={item.id} className={'web-nav-link ' + (selected(item) ? 'selected' : '')} title={item.title} aria-pressed={selected(item)} onClick={() => open(item)}>{content(item)}</Button>)}
      {/* A touch pan must remain a scroll gesture; keyboard/mouse retain Radix handling. */}
      <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}><DropdownMenuTrigger asChild onPointerDown={event => { if (event.pointerType === 'touch') event.preventDefault(); }} onClick={event => { if ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch') setMoreOpen(value => !value); }}><Button variant="ghost" className={'web-nav-link web-navigation-more ' + (hidden.some(selected) ? 'selected' : '')} title="Mais" aria-label="Mais opções de navegação"><MoreHorizontal/><span>Mais</span></Button></DropdownMenuTrigger><DropdownMenuContent side={adaptive ? 'right' : 'top'} align="end" className="web-navigation-more-menu">
        {hidden.map(item => item.kind === 'page'
          ? <DropdownMenuItem asChild key={item.id} data-destination={item.id}><Link to="." search={{ view: item.id as WebView }} aria-current={selected(item) ? 'page' : undefined} onClick={() => onNavigate(item.id as WebView)}>{content(item)}</Link></DropdownMenuItem>
          : <DropdownMenuItem key={item.id} data-destination={item.id} onSelect={() => open(item)}>{content(item)}</DropdownMenuItem>)}
        {hidden.length > 0 && <DropdownMenuSeparator/>}
        <DropdownMenuItem data-action="select-space" onSelect={onSelectSpace}><Layers3/>Selecionar Space</DropdownMenuItem>
        <DropdownMenuItem onSelect={onArrange}><PanelsTopLeft/>Organizar janelas</DropdownMenuItem>
        <DropdownMenuSeparator/><DropdownMenuLabel className="web-navigation-more-status"><Unplug/>Serviços não conectados</DropdownMenuLabel>
      </DropdownMenuContent></DropdownMenu>
    </nav>
  </div>;
}
