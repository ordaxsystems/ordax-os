import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IconTone } from './config';
export function Brand() {
  return <div className="brand" aria-label="OrdaX OS Web — demonstração visual"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><div><div className="brand-name">ORDA<em>X</em>OS</div><span className="brand-sub">WEB · DEMONSTRAÇÃO</span></div></div>;
}
export function AppIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: IconTone }) {
  return <span className="app-icon" data-tone={tone}><Icon aria-hidden="true"/></span>;
}
export function Avatar() { return <span className="avatar" aria-label="João">JO</span>; }
export function Panel({ title, action, onAction, children, className = '' }: { title: string; action?: ReactNode; onAction?: () => void; children: ReactNode; className?: string }) {
  return <section className={`os-panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{action && <Button variant="ghost" className="panel-action" onClick={onAction}>{action}</Button>}</div>{children}</section>;
}
