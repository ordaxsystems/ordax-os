import { useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Bell, Search, ChevronDown, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, ArrowUpRight, MoreHorizontal, X, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { sections } from '@/lib/account/model';
import { useOfficialAccountSession } from '@/lib/account/official-session';
import mark from '@/assets/ordax-mark.png';
import landscape from '@/assets/ordax-landscape.jpg';
export function AccountShell({ children }: { children: ReactNode }) {
 const path = useRouterState({ select: s => s.location.pathname });
 const [collapsed, setCollapsed] = useState(false);
 const [more, setMore] = useState(false);
 const [dialog, setDialog] = useState<'search'|'notifications'|'account'|null>(null);
 const [query, setQuery] = useState('');
 const active = sections.find(s => s.path === path) ?? sections[0];
 const officialSession = useOfficialAccountSession();
 return <div className={`account-app ${collapsed ? 'sidebar-collapsed' : ''}`}>
  <header className="topbar">
   <Link to="/" className="brand"><img src={mark} width="42" height="42" alt=""/><span>OrdaX <span className="brand-os">OS</span><sup>™</sup></span></Link>
   <div className="topbar-center"><span className="workspace-label">ESPAÇO PESSOAL</span><span className="header-divider"/><span className="text-muted-foreground text-xs">Minha Conta</span></div>
   <div className="topbar-actions"><Button variant="outline" className="search-launch" onClick={()=>setDialog('search')}><Search/><span>Buscar na minha conta</span><kbd>⌘ K</kbd></Button><Button variant="ghost" size="icon" aria-label="Notificações" title="Notificações" onClick={()=>setDialog('notifications')}><Bell/></Button><div className="header-divider"/><Button variant="ghost" className="account-menu" onClick={()=>setDialog('account')}><span className="mini-avatar"><UserRound/></span><span>Sua conta</span><ChevronDown/></Button></div>
  </header>
  <aside className="desktop-sidebar"><div className="sidebar-heading"><span>MINHA CONTA</span><Button size="icon" variant="ghost" title={collapsed?'Expandir menu':'Recolher menu'} aria-label={collapsed?'Expandir menu':'Recolher menu'} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</Button></div><nav aria-label="Menu da conta">{sections.slice(0,10).map((s,i)=><Link to={s.path} key={s.path} title={s.title} className={`sidebar-link ${path===s.path?'active':''} ${i===5?'nav-separator':''}`}><s.icon/><span>{s.title}</span>{path===s.path&&<span className="active-dot"/>}</Link>)}</nav>
   <div className="sidebar-bottom"><div className="sidebar-art"><img src={landscape} width="1920" height="640" alt="Montanhas sob um planeta azul" loading="lazy"/><div><img src={mark} width="30" height="30" alt=""/><p>Uma conta.<br/>Todos os seus mundos.</p><span>O seu universo começa aqui.</span></div></div><Link to="/suporte" className={`sidebar-link ${path==='/suporte'?'active':''}`}><ShieldCheck/><span>Precisa de ajuda?</span><ArrowUpRight/></Link><div className="sidebar-version"><span>OrdaX OS</span><span>ACCOUNT CENTER</span></div></div>
  </aside>
  <main className="account-main"><div className="breadcrumb"><span>OrdaX OS</span><ChevronRight/><span>Minha Conta</span>{path!=='/'&&<><ChevronRight/><span>{active.title}</span></>}</div>{children}<footer className="page-footer"><span><img src={mark} width="18" height="18" alt=""/> OrdaX OS <span className="footer-dash">—</span> Uma conta. Todos os seus mundos.</span><div><Link to="/privacidade">Privacidade</Link><Link to="/suporte">Ajuda</Link><span className="footer-status"><span/>Serviços não conectados</span></div></footer></main>
  <nav className="mobile-nav" aria-label="Navegação móvel">{[sections[0],sections[2],sections[3],sections[5]].map(s=><Link key={s.path} to={s.path} className={path===s.path?'active':''}><s.icon/><span>{s.path==='/'?'Resumo':s.path==='/assinatura'?'Assinatura':s.path==='/consumo'?'Consumo':'Segurança'}</span></Link>)}<Button variant="ghost" className={more?'active':''} onClick={()=>setMore(!more)} aria-label="Mais opções"><MoreHorizontal/><span>Mais</span></Button></nav>
  {more&&<div className="mobile-more"><div className="flex items-center justify-between mb-3"><h2>Minha Conta</h2><Button size="icon" variant="ghost" aria-label="Fechar menu" onClick={()=>setMore(false)}><X/></Button></div>{sections.slice(1).map(s=><Link key={s.path} to={s.path} onClick={()=>setMore(false)}><s.icon/>{s.title}<ChevronRight/></Link>)}</div>}
  <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null)}}><DialogContent>
   <DialogTitle>{dialog==='search'?'Buscar na minha conta':dialog==='notifications'?'Notificações':'Sua identidade OrdaX'}</DialogTitle>
   <DialogDescription>{dialog==='search'?'Encontre uma área da sua conta.':
     dialog==='notifications'?'As notificações confirmadas aparecerão aqui.':'Gerencie sua sessão de identidade no OrdaX.'}</DialogDescription>
   {dialog==='search'?<><label className="search-field"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="O que você está procurando?"/></label><div className="search-results">{sections.filter(s=>s.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).map(s=><Link key={s.path} to={s.path} onClick={()=>setDialog(null)}><s.icon/>{s.title}<ChevronRight/></Link>)}{!sections.some(s=>s.title.toLowerCase().includes(query.toLowerCase()))&&<p>Nenhuma área encontrada.</p>}</div></>:
    dialog==='notifications'?<div className="empty-state compact"><Bell/><h3>Nenhuma notificação disponível</h3><p>Este painel não apresenta notificações sem confirmação do serviço oficial.</p></div>:
    <section className="account-session-dialog" aria-live="polite">
      {officialSession.status==='checking'?<p>Verificando sessão…</p>:
       officialSession.status==='unavailable'?<p>Não foi possível verificar a sessão agora. Nenhuma informação pessoal será exibida.</p>:
       officialSession.status==='anonymous'?<div className="empty-state compact"><UserRound/><h3>Entre na sua conta</h3><p>Acesse sua identidade para gerenciar o OrdaX.</p><div className="flex gap-3 justify-center flex-wrap"><a className="account-auth-link" href="/login/">Entrar</a><a className="account-auth-link" href="/cadastro/">Criar conta</a></div></div>:
       <div className="account-authenticated-dialog">
        <p>Conta conectada</p>
        {officialSession.email&&<strong className="account-session-email">{officialSession.email}</strong>}
        <Link to="/dados-pessoais" onClick={()=>setDialog(null)} className="account-auth-link">Dados pessoais</Link>
        <Link to="/seguranca" onClick={()=>setDialog(null)} className="account-auth-link">Segurança e acesso</Link>
        <form action="/auth/logout" method="post"><button type="submit" className="account-auth-link account-logout-button">Sair da conta</button></form>
       </div>}
    </section>}
  </DialogContent></Dialog>
 </div>
}
