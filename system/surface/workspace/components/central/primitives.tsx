import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, ChevronRight, Settings, UserRound, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWindowIcon, unavailableServices, type IconTone } from './config';
import { useWebAccount } from './account-context';
export function Brand() {
  return <div className="brand" aria-label="OrdaX OS Web"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><div><div className="brand-name">ORDA<em>X</em>OS</div><span className="brand-sub">WEB</span></div></div>;
}
export function AppIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: IconTone }) {
  return <span className="app-icon" data-tone={tone}><Icon aria-hidden="true"/></span>;
}
export function WindowAppIcon({ title }: { title: string }) { const Icon = getWindowIcon(title); return <Icon aria-hidden="true"/>; }
export function Avatar() { const { displayName, initials } = useWebAccount(); return <span className="avatar" aria-label={displayName}>{initials ?? <UserRound aria-hidden="true"/>}</span>; }
export function Panel({ title, action, actionControl, onAction, children, className = '' }: { title: string; action?: ReactNode; actionControl?: ReactNode; onAction?: () => void; children: ReactNode; className?: string }) {
  return <section className={`os-panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{actionControl ?? (action && <Button variant="ghost" className="panel-action" onClick={onAction}>{action}</Button>)}</div>{children}</section>;
}

export function AccountCard({ onOpen, onSettings, onNotifications }: { onOpen: () => void; onSettings: () => void; onNotifications: () => void }) {
  const { displayName, identity, offline } = useWebAccount();
  const label = offline ? 'Sem conexão' : identity.state === 'signed-in' ? 'Sessão verificada' : 'Conectar conta';
  return <section className="account sidebar-account" aria-label={displayName}>
    <Button variant="ghost" className="account-open" onClick={onOpen} aria-label="Abrir minha conta" title={displayName}>
      <Avatar/><span className="account-identity"><strong title={displayName}>{displayName}</strong><span>{label}</span></span><ChevronRight className="account-chevron"/>
    </Button>
    <div className="storage-track storage-unavailable" aria-label={unavailableServices.storage}/>
    <div className="account-storage-footer"><span className="account-storage-value" title={unavailableServices.storage}><span className="account-storage-summary">Uso indisponível</span><span className="account-storage-compact">—</span></span><div className="account-actions"><Button variant="ghost" size="icon" aria-label="Notificações" title="Notificações" onClick={onNotifications}><Bell/></Button><Button variant="ghost" size="icon" aria-label="Ajustes do espaço" title="Ajustes do espaço" onClick={onSettings}><Settings/></Button></div></div>
  </section>;
}

// Commands delegate to the existing identity-actions port; no local authentication.
export function AccountPanel() {
  const { session, identity, actions, displayName, offline } = useWebAccount();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState<string | null>(null);
  async function perform(action?: 'sign-in' | 'sign-out') {
    if (inFlight.current) return;
    if (session.surface.getSnapshot().connectivity === 'offline') {
      setError('Você está offline. Reconecte para atualizar a conta.');
      return;
    }
    inFlight.current = true;
    setPending(true); setError(null);
    try { if (action) await session.actions.execute(action); else await session.refresh(); }
    catch { if (mounted.current) setError('Não foi possível concluir a operação. Tente novamente.'); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }
  return <Panel title="Minha conta"><div className="account-service-content">
    <div className="account-service-profile"><Avatar/><div><strong>{displayName}</strong><p className="project-meta">{offline ? 'Sem conexão. Os dados da sessão podem estar desatualizados.' : identity.state === 'signed-in' ? 'Identidade confirmada pelo serviço OrdaX.' : identity.state === 'signed-out' ? 'Entre para consultar seus Spaces e dados autorizados.' : 'Não foi possível conectar sua conta.'}</p></div></div>
    <div className="account-service-actions">
      <Button variant="outline" disabled={pending || offline} onClick={() => void perform()}>{pending ? 'Atualizando…' : 'Atualizar conexão'}</Button>
      {actions.supportedActions.includes('sign-in') && <Button disabled={pending || offline} onClick={() => void perform('sign-in')}>Entrar</Button>}
      {actions.supportedActions.includes('sign-out') && <Button variant="outline" disabled={pending || offline} onClick={() => void perform('sign-out')}>Sair da conta</Button>}
      <Button variant="outline" asChild><a href="/conta/">Gerenciar minha conta<ChevronRight/></a></Button>
    </div>
    {error && <p role="alert" className="project-meta">{error}</p>}
    <p className="project-meta">{unavailableServices.storage}</p>
    <p className="project-meta">Plano e cobrança aguardam o serviço de assinatura.</p>
  </div></Panel>;
}
