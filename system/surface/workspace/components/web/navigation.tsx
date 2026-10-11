import { Link } from '@tanstack/react-router';
import { Plus, Settings2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWebApp, webNavigation, type WebAppId, type WebView } from '@/lib/web/model';
import { AppIcon } from './primitives';

type Props = {
  page: WebView;
  intelligence: boolean;
  active?: WebAppId;
  onOpen: (id: WebAppId) => void;
  onNavigate: (view: WebView) => void;
};

export function WorkspaceNavigation({ page, intelligence, active, onOpen, onNavigate }: Props) {
  return <div className="web-navigation-content">
    <nav aria-label="Navegação OrdaX Web">
      {webNavigation.map(item => {
        const selected = item.kind === 'page' ? page === item.id : item.kind === 'panel' ? intelligence : active === item.app;
        const className = `web-nav-link ${selected ? 'selected' : ''}`;
        const content = <><item.icon/><span>{item.title}</span></>;
        return item.kind === 'page'
          ? <Button asChild variant="ghost" key={item.id} className={className}>
              <Link to="." search={{ view: item.id }} title={item.title} aria-current={selected ? 'page' : undefined} onClick={() => onNavigate(item.id)}>{content}</Link>
            </Button>
          : <Button variant="ghost" key={item.id} className={className} title={item.title} aria-pressed={selected} onClick={() => { if (item.app) onOpen(item.app); }}>{content}</Button>;
      })}
    </nav>
    <div className="web-sidebar-favorites">
      <span>Favoritos</span>
      {(['studio', 'files', 'notes'] as const).map(id => <Button key={id} variant="ghost" className="web-favorite" title={`Abrir ${getWebApp(id).name}`} onClick={() => onOpen(id)}><AppIcon id={id} small/><span>{getWebApp(id).name}</span><Plus/></Button>)}
    </div>
    <div className="web-sidebar-bottom">
      <Button variant="ghost" className="web-favorite" title="Ajustes do ambiente" onClick={() => onOpen('settings')}><Settings2/><span>Ajustes</span></Button>
      <div className="web-sidebar-status"><Unplug/><div><strong>Protótipo visual</strong><span>Serviços não conectados</span></div></div>
    </div>
  </div>;
}
