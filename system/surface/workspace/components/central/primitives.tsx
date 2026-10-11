import { type CSSProperties, type ReactNode } from 'react';
import { ChevronRight, Settings, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { presentationAccount, presentationStoragePercent, type IconTone } from './config';
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

export function AccountCard({ onOpen, onSettings }: { onOpen: () => void; onSettings: () => void }) {
  return <section className="account sidebar-account" aria-label="Espaço Pessoal — dados de demonstração">
    <Button variant="ghost" className="account-open" onClick={onOpen} aria-label="Abrir Espaço Pessoal" title={`${presentationAccount.spaceName} · ${presentationAccount.planName}`}>
      <Avatar/><span className="account-identity"><strong>{presentationAccount.spaceName}</strong><span>{presentationAccount.planName}</span></span><ChevronRight className="account-chevron"/>
    </Button>
    <div className="storage-track" role="progressbar" aria-label="Armazenamento de demonstração" aria-valuemin={0} aria-valuemax={presentationAccount.storageLimitGb} aria-valuenow={presentationAccount.storageUsedGb} style={{ '--storage-progress': `${presentationStoragePercent}%` } as CSSProperties}/>
    <div className="account-storage-footer"><span><strong>{presentationAccount.storageUsedGb} GB</strong><span className="account-storage-total"> de {presentationAccount.storageLimitGb} GB</span></span><Button variant="ghost" size="icon" aria-label="Ajustes do espaço" title="Ajustes do espaço" onClick={onSettings}><Settings/></Button></div>
  </section>;
}
