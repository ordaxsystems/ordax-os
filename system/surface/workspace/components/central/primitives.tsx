import { projectSidebarAccount, sidebarAccountMarkup } from "../../../ui/sidebar-account.mjs";
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Settings, ShieldCheck, WalletCards, RefreshCw, Monitor, LogOut, UserRound, ChevronRight, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getWindowIcon, unavailableServices, type IconTone } from './config';
import { useWebAccount } from './account-context';
import { PRODUCT_FAMILY_PUBLIC_ENDPOINTS } from '../../../../contracts/product-family.mjs';

const accountManagementUrl = new URL('/conta/', PRODUCT_FAMILY_PUBLIC_ENDPOINTS.site.origin).href;
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
export function AccountPanel({ onOpen }: { onOpen?: (title: string) => void } = {}) {
  const { session, identity, actions, displayName, offline, authorized } = useWebAccount();
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
    <p className="account-page-intro">Sua identidade no OrdaX. Cuide da sua conta e personalize este espaço.</p>
    <section className="account-overview" aria-label="Identidade e sessão">
      <div className="account-service-profile"><Avatar/><div><p className="meridian-eyebrow">CONTA ORDAX</p><h3>{displayName}</h3><span className="account-service-state" data-state={offline ? "offline" : identity.state}>{offline ? "Sem conexão" : identity.state === "signed-in" ? "Conta conectada" : "Conta não conectada"}</span><p className="project-meta">{offline ? 'Sem conexão. Os dados da sessão podem estar desatualizados.' : identity.state === 'signed-in' ? 'Identidade confirmada pelo serviço OrdaX.' : identity.state === 'signed-out' ? 'Entre para consultar seus Spaces e dados autorizados.' : 'Não foi possível conectar sua conta.'}</p></div></div>
      <div className="account-portal-access"><a className="account-portal-primary" href={accountManagementUrl} target="_blank" rel="noopener noreferrer">Gerenciar minha conta<ArrowUpRight size={18}/><span className="sr-only"> — abre em nova aba</span></a><p>Abre o portal OrdaX em uma nova aba. Sua área de trabalho continua aqui.</p></div>
    </section>
    <div className="account-page-grid"><section className="account-page-section" aria-labelledby="account-management-title"><header><h3 id="account-management-title">Identidade e proteção</h3><p>Gerencie seus dados no portal da Conta OrdaX.</p></header><nav aria-label="Gerenciar Conta OrdaX">{[{id:'dados-pessoais',title:'Dados pessoais',description:'Seu perfil e suas informações cadastrais.',icon:UserRound},{id:'seguranca',title:'Segurança e acesso',description:'Opções de proteção e recuperação da conta.',icon:ShieldCheck},{id:'privacidade',title:'Dados e privacidade',description:'Seus dados, suas escolhas e permissões.',icon:WalletCards}].map(item=><a key={item.id} className="account-management-link" href={accountManagementUrl+'#'+item.id} target="_blank" rel="noopener noreferrer"><span className="account-feature-icon"><item.icon size={20}/></span><span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowUpRight size={17}/><span className="sr-only">Abre no portal OrdaX em nova aba</span></a>)}</nav></section>
    <section className="account-page-section account-session-section" aria-labelledby="account-session-title"><header><h3 id="account-session-title">Neste navegador</h3><p>Informações e controles desta sessão.</p></header><dl className="account-session-facts"><div><dt>Ambiente</dt><dd><Monitor size={15}/>OrdaX Web</dd></div><div><dt>Space atual</dt><dd>{authorized.activeSpace?.name ?? 'Nenhum selecionado'}</dd></div></dl>{onOpen && <div className="account-local-shortcuts"><button onClick={()=>onOpen('Espaços')}><WalletCards size={17}/>Meus espaços<ChevronRight size={16}/></button><button onClick={()=>onOpen('Configurações')}><Settings size={17}/>Preferências do Web<ChevronRight size={16}/></button></div>}<div className="account-service-actions">
      <Button variant="outline" disabled={pending || offline} onClick={() => void perform()}><RefreshCw size={16}/>{pending ? 'Atualizando…' : 'Atualizar conexão'}</Button>
      {identity.state !== 'signed-in' && <Button disabled={pending || offline || !actions.supportedActions.includes('sign-in')} onClick={() => void perform('sign-in')}>Entrar</Button>}
      {identity.state !== 'signed-in' && <Button variant="outline" disabled={pending || offline || !actions.supportedActions.includes('register')} aria-describedby={!actions.supportedActions.includes('register') ? registrationHint : undefined} onClick={() => void perform('register')}>Criar conta</Button>}
      {actions.supportedActions.includes('sign-out') && <Button variant="ghost" className="account-service-signout" disabled={pending || offline} onClick={() => void perform('sign-out')}><LogOut size={16}/>Sair da conta</Button>}
    </div></section></div>
    {identity.state !== 'signed-in' && !actions.supportedActions.includes('register') && <p className="meridian-integration-status" id={registrationHint}>Cadastro indisponível até confirmação do serviço.</p>}
    {error && <p role="alert" className="project-meta">{error}</p>}
    <section className="account-resources" aria-labelledby="account-resources-title"><header><h3 id="account-resources-title">Recursos da conta</h3><p>As opções em desenvolvimento continuam disponíveis para acompanhamento.</p></header><div className="account-service-pending" aria-label="Recursos de conta pendentes"><section><div className="account-resource-heading"><h4>Armazenamento</h4><span className="meridian-integration-status">Integração pendente</span></div><p>{unavailableServices.storage}</p><a href={accountManagementUrl+'#consumo'} target="_blank" rel="noopener noreferrer">Consumo e limites<ArrowUpRight size={16}/><span className="sr-only"> — abre em nova aba</span></a></section><section><div className="account-resource-heading"><h4>Plano e cobrança</h4><span className="meridian-integration-status">Integração pendente</span></div><p>Plano e cobrança aguardam o serviço de assinatura.</p><a href={accountManagementUrl+'#assinatura'} target="_blank" rel="noopener noreferrer">Plano e assinatura<ArrowUpRight size={16}/><span className="sr-only"> — abre em nova aba</span></a></section></div></section>
  </div></Panel>;
}
