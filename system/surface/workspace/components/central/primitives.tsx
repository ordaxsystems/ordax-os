import { projectSidebarAccount, sidebarAccountMarkup } from "../../../ui/sidebar-account.mjs";
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, UserRound, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWindowIcon, unavailableServices, type IconTone } from './config';
import { useWebAccount } from './account-context';
import symbol from '../../../ui/brand/ordax-symbol.png';
import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from '../../../../contracts/product-family.mjs';

const accountManagementUrl = new URL('/conta/', PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin).href;
export function Brand() {
  return <div className="brand" aria-label="OrdaX OS Web"><span className="meridian-brand-symbol" style={{maskImage:`url(${symbol})`,WebkitMaskImage:`url(${symbol})`}} aria-hidden="true"/><div><div className="brand-name">OrdaX</div><span className="brand-sub">OS · WEB</span></div></div>;
}
export function AppIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: IconTone }) {
  return <span className="app-icon" data-tone={tone}><Icon aria-hidden="true"/></span>;
}
export function WindowAppIcon({ title }: { title: string }) { const Icon = getWindowIcon(title); return <Icon aria-hidden="true"/>; }
export function Avatar() { const { displayName, initials } = useWebAccount(); return <span className="avatar" aria-label={displayName}>{initials ?? <UserRound aria-hidden="true"/>}</span>; }
export function Panel({ title, action, actionControl, onAction, children, className = '' }: { title: string; action?: ReactNode; actionControl?: ReactNode; onAction?: () => void; children: ReactNode; className?: string }) {
  return <section className={`os-panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{actionControl ?? (action && <Button variant="ghost" className="panel-action" onClick={onAction}>{action}</Button>)}</div>{children}</section>;
}

export function AccountCard({ onOpen, onNotifications }: { onOpen: () => void; onNotifications: () => void }) {
  const { identity, offline } = useWebAccount();
  const view = projectSidebarAccount(identity, offline);
  return <div onClick={event => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-sidebar-account-open]')) onOpen();
    else if (target.closest('[data-sidebar-notifications]')) onNotifications();
  }} dangerouslySetInnerHTML={{ __html: sidebarAccountMarkup(view) }}/>;
}

// Commands delegate to the existing identity-actions port; no local authentication.
export function AccountPanel() {
  const { session, identity, actions, displayName, offline } = useWebAccount();
  const registrationHint = useId();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState<string | null>(null);
  async function perform(action?: 'sign-in' | 'sign-out' | 'register') {
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
  return <Panel title="Minha conta" className="meridian-account-panel"><div className="account-service-content">
    <div className="account-service-profile"><Avatar/><div><strong>{displayName}</strong><span className="account-service-state" data-state={offline ? "offline" : identity.state}>{offline ? "Sem conexão" : identity.state === "signed-in" ? "Conta conectada" : "Conta não conectada"}</span><p className="project-meta">{offline ? 'Sem conexão. Os dados da sessão podem estar desatualizados.' : identity.state === 'signed-in' ? 'Identidade confirmada pelo serviço OrdaX.' : identity.state === 'signed-out' ? 'Entre para consultar seus Spaces e dados autorizados.' : 'Não foi possível conectar sua conta.'}</p></div></div>
    <div className="account-service-actions">
      <Button asChild><a href={accountManagementUrl}>Gerenciar minha conta<ChevronRight/></a></Button>
      <Button variant="outline" disabled={pending || offline} onClick={() => void perform()}>{pending ? 'Atualizando…' : 'Atualizar conexão'}</Button>
      {identity.state !== 'signed-in' && <Button disabled={pending || offline || !actions.supportedActions.includes('sign-in')} onClick={() => void perform('sign-in')}>Entrar</Button>}
      {identity.state !== 'signed-in' && <Button variant="outline" disabled={pending || offline || !actions.supportedActions.includes('register')} aria-describedby={!actions.supportedActions.includes('register') ? registrationHint : undefined} onClick={() => void perform('register')}>Criar conta</Button>}
      {actions.supportedActions.includes('sign-out') && <Button variant="outline" className="account-service-signout" disabled={pending || offline} onClick={() => void perform('sign-out')}>Sair da conta</Button>}
    </div>
    {identity.state !== 'signed-in' && !actions.supportedActions.includes('register') && <p className="meridian-integration-status" id={registrationHint}>Cadastro indisponível até confirmação do serviço.</p>}
    {error && <p role="alert" className="project-meta">{error}</p>}
    <div className="account-service-pending" aria-label="Recursos de conta pendentes"><section><h3>Armazenamento</h3><p>{unavailableServices.storage}</p></section><section><h3>Plano e cobrança</h3><p>Plano e cobrança aguardam o serviço de assinatura.</p></section></div>
  </div></Panel>;
}
