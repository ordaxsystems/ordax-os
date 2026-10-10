import { useEffect, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Link, useRouterState } from '@tanstack/react-router';
import { Bell, Search, ChevronDown, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, ArrowUpRight, MoreHorizontal, X, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { sections } from '@/lib/account/model';
import { accountSectionFromUrl } from '@/lib/account/navigation';
import { useOfficialAccountSession } from '@/lib/account/official-session';
import mark from '@/assets/ordax-mark.png';
import landscape from '@/assets/ordax-landscape.jpg';
export function AccountShell({ children }: { children: ReactNode }) {
 const path = useRouterState({ select: state => accountSectionFromUrl(state.location.pathname) });
 const [collapsed, setCollapsed] = useState(false);
 const [more, setMore] = useState(false);
 const [dialog, setDialog] = useState<'search'|'notifications'|null>(null);
 const [query, setQuery] = useState('');
 const active = sections.find(s => s.path === path) ?? sections[0];
 const officialSession = useOfficialAccountSession();
 useEffect(() => {
  const shortcut = (event: KeyboardEvent) => {
   if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    setDialog('search');
   }
  };
  document.addEventListener('keydown', shortcut);
  return () => document.removeEventListener('keydown', shortcut);
 }, []);
 return <div className={`account-app ${collapsed ? 'sidebar-collapsed' : ''}`}>
  <header className="topbar">
   <Link to="/" className="brand"><img src={mark} width="42" height="42" alt=""/><span>OrdaX <span className="brand-os">OS</span><sup>™</sup></span></Link>
   <div className="topbar-center"><span className="workspace-label">ESPAÇO PESSOAL</span><span className="header-divider"/><span className="text-muted-foreground text-xs">Minha Conta</span></div>
   <div className="topbar-actions"><Button variant="outline" className="search-launch" onClick={()=>setDialog('search')}><Search/><span>Buscar na minha conta</span><kbd>Ctrl/⌘ K</kbd></Button><Button variant="ghost" size="icon" aria-label="Notificações" title="Notificações" onClick={()=>setDialog('notifications')}><Bell/></Button><div className="header-divider"/><DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><Button variant="ghost" className="account-menu" aria-label="Abrir opções da minha conta"><span className="mini-avatar"><UserRound/></span><span>Minha conta</span><ChevronDown/></Button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={8} className="ordax-account-dropdown" aria-label="Opções da minha conta">
      <DropdownMenu.Label className="ordax-account-dropdown-heading">Minha conta
        {officialSession.status==='authenticated'&&officialSession.email&&<span className="ordax-account-dropdown-email">{officialSession.email}</span>}
      </DropdownMenu.Label>
      <DropdownMenu.Separator className="ordax-account-dropdown-separator"/>
      {officialSession.status==='authenticated'?<>
        <DropdownMenu.Item asChild><Link to="/dados-pessoais" className="ordax-account-dropdown-item"><UserRound/> Dados pessoais</Link></DropdownMenu.Item>
        <DropdownMenu.Item asChild><Link to="/seguranca" className="ordax-account-dropdown-item"><ShieldCheck/> Segurança e acesso</Link></DropdownMenu.Item>
        <DropdownMenu.Separator className="ordax-account-dropdown-separator"/>
        <form action="/auth/logout" method="post"><button type="submit" className="ordax-account-dropdown-item ordax-account-dropdown-logout">Sair da conta</button></form>
      </>:officialSession.status==='checking'?<p className="ordax-account-dropdown-status" role="status">Verificando sua sessão…</p>:<>
        {officialSession.status==='unavailable'&&<p className="ordax-account-dropdown-status" role="status">Não foi possível confirmar a sessão.</p>}
        <DropdownMenu.Item asChild><a href="/login/" className="ordax-account-dropdown-item">Entrar</a></DropdownMenu.Item>
        <DropdownMenu.Item asChild><a href="/cadastro/" className="ordax-account-dropdown-item">Criar conta</a></DropdownMenu.Item>
      </>}
    </DropdownMenu.Content></DropdownMenu.Portal>
   </DropdownMenu.Root></div>
  </header>
  <aside className="desktop-sidebar"><div className="sidebar-heading"><span>MINHA CONTA</span><Button size="icon" variant="ghost" title={collapsed?'Expandir menu':'Recolher menu'} aria-label={collapsed?'Expandir menu':'Recolher menu'} onClick={()=>setCollapsed(!collapsed)}>{collapsed?<PanelLeftOpen/>:<PanelLeftClose/>}</Button></div><nav aria-label="Menu da conta">{sections.slice(0,10).map((s,i)=><Link to={s.path} key={s.path} title={s.title} className={`sidebar-link ${path===s.path?'active':''} ${i===5?'nav-separator':''}`}><s.icon/><span>{s.title}</span>{path===s.path&&<span className="active-dot"/>}</Link>)}</nav>
   <div className="sidebar-bottom"><div className="sidebar-art"><img src={landscape} width="1920" height="640" alt="Montanhas sob um planeta azul" loading="lazy"/><div><img src={mark} width="30" height="30" alt=""/><p>Uma conta.<br/>Todos os seus mundos.</p><span>O seu universo começa aqui.</span></div></div><Link to="/suporte" className={`sidebar-link ${path==='/suporte'?'active':''}`}><ShieldCheck/><span>Precisa de ajuda?</span><ArrowUpRight/></Link><div className="sidebar-version"><span>OrdaX OS</span><span>ACCOUNT CENTER</span></div></div>
  </aside>
  <main className="account-main"><div className="breadcrumb"><span>OrdaX OS</span><ChevronRight/><span>Minha Conta</span>{path!=='/'&&<><ChevronRight/><span>{active.title}</span></>}</div>{children}<footer className="page-footer"><span><img src={mark} width="18" height="18" alt=""/> OrdaX OS <span className="footer-dash">—</span> Uma conta. Todos os seus mundos.</span><div><a href="/privacidade/">Política de privacidade</a><Link to="/suporte">Ajuda</Link><span className="footer-status"><span/>Métricas e faturamento pendentes</span></div></footer></main>
  <nav className="mobile-nav" aria-label="Navegação móvel">{[sections[0],sections[2],sections[3],sections[5]].map(s=><Link key={s.path} to={s.path} className={path===s.path?'active':''}><s.icon/><span>{s.path==='/'?'Resumo':s.path==='/assinatura'?'Assinatura':s.path==='/consumo'?'Consumo':'Segurança'}</span></Link>)}<Button variant="ghost" className={more?'active':''} onClick={()=>setMore(true)} aria-label="Mais opções" aria-expanded={more} aria-controls="account-mobile-more"><MoreHorizontal/><span>Mais</span></Button></nav>
  <DialogPrimitive.Root open={more} onOpenChange={setMore}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ordax-account-mobile-overlay"/>
      <DialogPrimitive.Content id="account-mobile-more" className="mobile-more" aria-describedby="account-mobile-more-description">
        <div className="flex items-center justify-between mb-3">
          <DialogPrimitive.Title asChild><h2>Minha Conta</h2></DialogPrimitive.Title>
          <DialogPrimitive.Close asChild><Button size="icon" variant="ghost" aria-label="Fechar menu"><X/></Button></DialogPrimitive.Close>
        </div>
        <DialogPrimitive.Description id="account-mobile-more-description" className="ordax-account-mobile-description">Escolha uma seção da sua conta.</DialogPrimitive.Description>
        {sections.slice(1).map(s=><Link key={s.path} to={s.path} onClick={()=>setMore(false)}><s.icon/>{s.title}<ChevronRight/></Link>)}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
  <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null)}}><DialogContent>
   <DialogTitle>{dialog==='search'?'Buscar na minha conta':'Notificações'}</DialogTitle>
   <DialogDescription>{dialog==='search'?'Encontre uma área da sua conta.':'As notificações confirmadas aparecerão aqui.'}</DialogDescription>
   {dialog==='search'?<><label className="search-field"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="O que você está procurando?"/></label><div className="search-results">{sections.filter(s=>s.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).map(s=><Link key={s.path} to={s.path} onClick={()=>setDialog(null)}><s.icon/>{s.title}<ChevronRight/></Link>)}{!sections.some(s=>s.title.toLowerCase().includes(query.toLowerCase()))&&<p>Nenhuma área encontrada.</p>}</div></>:
    <div className="empty-state compact"><Bell/><h3>Nenhuma notificação disponível</h3><p>Este painel não apresenta notificações sem confirmação do serviço oficial.</p></div>}
  </DialogContent></Dialog>
 </div>
}
