import type { ReactNode } from 'react';
import { Unplug, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWebApp, type WebAppId } from '@/lib/web/model';

export function AppIcon({ id, small = false }: { id: WebAppId; small?: boolean }) {
  const app = getWebApp(id);
  return <span className={`web-app-icon web-tone-${app.tone} ${small ? 'web-app-icon-small' : ''}`}><app.icon aria-hidden="true" /></span>;
}
export function ServiceEmpty({ title, description, icon, children }: { title: string; description: string; icon?: ReactNode; children?: ReactNode }) {
  return <div className="web-service-empty"><span className="web-empty-symbol">{icon ?? <Unplug />}</span><h3>{title}</h3><p>{description}</p>{children}<span className="web-status"><Unplug />Serviço não conectado</span></div>;
}
export function AppTile({ id, onOpen }: { id: WebAppId; onOpen: (id: WebAppId) => void }) {
  const app = getWebApp(id);
  return <Button variant="ghost" className="web-app-tile" onClick={() => onOpen(id)} title={`Abrir ${app.name}`}><AppIcon id={id} /><strong>{app.name}</strong><small>{app.subtitle}</small></Button>;
}
export function PanelHeading({ title, onOpen }: { title: string; onOpen?: () => void }) {
  return <div className="web-panel-heading"><h2>{title}</h2>{onOpen && <Button variant="ghost" size="sm" onClick={onOpen}>Ver todos <ArrowUpRight /></Button>}</div>;
}