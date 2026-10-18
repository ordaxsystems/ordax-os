import {translateSurfaceMessage} from '../../../../services/i18n/surface.mjs';
import {REGIONAL_LOCALE_PREFERENCE_ID} from '../../../../services/preferences/regional.mjs';
import { createElement, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode } from 'react';
import { Bell, Search, LayoutGrid, Monitor, MoreHorizontal, ChevronDown, ChevronRight, Sparkles, WalletCards, Settings, Clock3, Menu, Moon, Sun, ShieldCheck, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SIDEBAR_LAYOUT, sidebarBrandMarkup, sidebarNavigationCapacity, sidebarIsExpanded } from '../../../ui/sidebar-layout.mjs';
import { sidebarProfileButtonMarkup } from '../../../ui/sidebar-account.mjs';
import { mountSidebarHints } from '../../../ui/sidebar-hints.mjs';
import { presentationDestination } from '../../presentation.mjs';
import { favorites, navigation, getWindowIcon, getWindowTitle, matchesNavigationQuery } from './config';
import { AppIcon } from './primitives';
import { useWebAccount } from './account-context';
import { useWebPreferences } from './preferences-context';
import { HOME_SHORTCUTS_PREFERENCE_ID, readFavoriteShortcutIds } from '../../../../services/preferences/home-shortcuts.mjs';
import type { DesktopAction, DesktopState } from './desktop-state';

type HeaderProps = {title:string;theme:'light'|'dark';onMaterial:()=>void;onMenu:()=>void;onOpen:(title:string)=>void};
export function WorkspaceHeader({title,theme,onMaterial,onMenu,onOpen}:HeaderProps) {
  const {authorized}=useWebAccount();
  return <header className="meridian-system-header">
    <div className="meridian-system-location"><button className="meridian-mobile-menu" aria-label="Abrir navegação" onClick={onMenu} data-navigation-trigger><Menu size={20}/></button><span>{title}</span><i>/</i><button onClick={()=>onOpen('Espaços')}>{authorized.activeSpace?.name??'Seu espaço'}<ChevronDown size={13}/></button></div>
    <button className="meridian-system-search" aria-label="Buscar aplicativos e recursos" onClick={onMenu} data-navigation-trigger><Search size={17}/><span>Buscar aplicativos e recursos</span><kbd>Ctrl K</kbd></button>
    <div className="meridian-system-tools"><span className="meridian-planned-indicator"><i/>Recursos planejados</span><button aria-label={theme==='dark'?'Usar material Argila':'Usar material Grafite'} onClick={onMaterial}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button><button aria-label="Ajustes rápidos do sistema" onClick={()=>onOpen('Configurações')}><Settings size={18}/></button></div>
  </header>;
}

type Props = {menuRequest?:number;onSidebarChange:(mode:'collapsed'|'expanded')=>void;state:DesktopState;dispatch:Dispatch<DesktopAction>;view:'central'|'desktop';onToggleView:()=>void;onCentral:()=>void};
export function WorkspaceNavigation({state,dispatch,view,onToggleView,onCentral,onSidebarChange,menuRequest=0}:Props) {
  const destination=presentationDestination(view);
  const DestinationIcon=destination.target==='desktop'?Monitor:LayoutGrid;
  const {snapshot}=useWebPreferences();
  const locale=String(snapshot[REGIONAL_LOCALE_PREFERENCE_ID]??'pt-BR');
  const {authorized,offline,sidebarAccount}=useWebAccount(id=>translateSurfaceMessage(locale,id));
  const pinnedIds=new Set(readFavoriteShortcutIds(snapshot[HOME_SHORTCUTS_PREFERENCE_ID]));
  const pinned=favorites.filter(item=>pinnedIds.has(item.id));
  const [startOpen,setStartOpen]=useState(false);
  const [search,setSearch]=useState('');
  const observedMenuRequest=useRef(menuRequest);
  const [visibleCount,setVisibleCount]=useState(6);
  const [expanded,setExpanded]=useState(false);
  const collapseLabel=translateSurfaceMessage(String(snapshot[REGIONAL_LOCALE_PREFERENCE_ID]??'pt-BR'),expanded?'shell.sidebar.collapse':'shell.sidebar.expand');
  const [menuContainer,setMenuContainer]=useState<HTMLElement|null>(null);
  const sidebar=useRef<HTMLElement>(null);
  const nav=useRef<HTMLElement>(null);
  const hintHost=useRef<HTMLDivElement>(null);
  const menuTrigger=useRef<HTMLElement|null>(null);
  const menuNavigated=useRef(false);
  const dock=useRef<HTMLDivElement>(null);
  const [edges,setEdges]=useState({start:false,end:false});
  function openMenu(trigger?:HTMLElement) {menuTrigger.current=trigger??document.activeElement as HTMLElement;menuNavigated.current=false;setSearch('');setStartOpen(true);}
  useLayoutEffect(()=>{setMenuContainer(sidebar.current?.closest<HTMLElement>('.window-workspace')??null);},[]);
  useEffect(()=>{if(menuRequest!==observedMenuRequest.current){observedMenuRequest.current=menuRequest;openMenu();}},[menuRequest]);
  useEffect(()=>{
    function key(event:globalThis.KeyboardEvent){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open],[role="dialog"][data-state="open"]')&&!document.activeElement?.shadowRoot?.querySelector('dialog[open]')){event.preventDefault();openMenu();}}
    document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);
  },[]);
  useEffect(()=>{if(!hintHost.current||!sidebar.current)return;const hints=mountSidebarHints(hintHost.current,sidebar.current);return()=>hints.destroy();},[]);
  useLayoutEffect(()=>{
    const host=nav.current,rail=sidebar.current;if(!host||!rail)return;
    const measure=()=>{const expanded=sidebarIsExpanded(rail);setExpanded(expanded);setVisibleCount(Math.max(0,sidebarNavigationCapacity(host)-(expanded?1:0)));};
    measure();const observer=new ResizeObserver(measure);observer.observe(host);observer.observe(rail);return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{
    const host=dock.current;if(!host)return;
    const measure=()=>{const value={start:host.scrollLeft>2,end:host.scrollLeft+host.clientWidth<host.scrollWidth-2};setEdges(previous=>previous.start===value.start&&previous.end===value.end?previous:value);};
    measure();host.addEventListener('scroll',measure,{passive:true});const observer=new ResizeObserver(measure);observer.observe(host);return()=>{host.removeEventListener('scroll',measure);observer.disconnect();};
  },[state.windows]);
  const activeWindow=state.windows.find(window=>window.title===state.active&&!window.minimized);
  const active=activeWindow ? getWindowTitle(activeWindow.title) : undefined;
  const railDestinations=navigation.filter(item=>item.rail&&item.name!=='Início');
  const visible=railDestinations.slice(0,visibleCount>=railDestinations.length?railDestinations.length:Math.max(0,visibleCount-1));
  const menuItems=[...navigation,{name:'Atividades',icon:Clock3},{name:'Continuidade',icon:Clock3},{name:'Minha conta',icon:ShieldCheck},{name:'Notificações',icon:Bell}].filter(item=>item.name!=='Início'&&matchesNavigationQuery(item,search));
  const homeMatch=matchesNavigationQuery({name:'Central Início'},search);
  const dockItems=[...pinned,...state.windows.filter(window=>!pinned.some(item=>getWindowTitle(item.name)===getWindowTitle(window.title))).map(window=>({id:window.title,name:window.title,icon:getWindowIcon(window.title),tone:'green' as const}))];
  function open(title:string){menuNavigated.current=startOpen;setStartOpen(false);dispatch({type:'open',title:getWindowTitle(title)});}
  function home(){menuNavigated.current=startOpen;setStartOpen(false);dispatch({type:'show-desktop'});onCentral();}
  function dockKeys(event:KeyboardEvent<HTMLDivElement>){
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('.desktop-task')];
    const index=buttons.indexOf((event.target as HTMLElement).closest('button') as HTMLButtonElement);if(index<0)return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
    buttons[next]?.focus();buttons[next]?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  const items=(<>{visible.map((item,index)=><div className="meridian-nav-destination" key={item.name}>{item.group==='ecossistema'&&visible[index-1]?.group!=='ecossistema'&&<p className="meridian-nav-label">Ecossistema</p>}<Button variant="ghost" className="os-nav-item" aria-label={item.name} title={item.name} aria-current={(item.target??item.name)===active?(view==='central'?'page':'true'):undefined} data-active={(item.target??item.name)===active} onClick={()=>open(item.target??item.name)}><item.icon aria-hidden="true"/><span>{item.name}</span></Button></div>)}{visible.length<railDestinations.length&&<Button variant="ghost" className="os-nav-item" aria-label="Mais destinos" title="Mais destinos" onClick={event=>openMenu(event.currentTarget)}><MoreHorizontal/><span>Mais destinos</span></Button>}</>);
  const slots:Record<string,ReactNode>={
    brand:<button type="button" className="meridian-brand-home" aria-label="OrdaX Central" onClick={home} dangerouslySetInnerHTML={{__html:sidebarBrandMarkup()}}/>,
    home:<><button className="meridian-rail-space" aria-label={`Trocar Space, atual: ${authorized.activeSpace?.name??'nenhum selecionado'}`} title={`Trocar Space: ${authorized.activeSpace?.name??'escolher contexto'}`} onClick={()=>open('Espaços')}><span><WalletCards size={20}/></span><span><small>SEU SPACE</small><strong>{authorized.activeSpace?.name??'Escolher contexto'}</strong></span><ChevronDown size={14}/></button>{view==='central'&&<Button variant="ghost" className="os-nav-item meridian-home-destination" data-window-home aria-label="Início" title="Início" data-active={!activeWindow} aria-current={!activeWindow?'page':undefined} onClick={home}><LayoutGrid/><span>Início</span></Button>}</>,
    navigation:items,
    account:<><div className="meridian-rail-context"><i/><span>{offline?'Sem conexão':'Sessão do navegador'}<small>{authorized.activeSpace?.name??'Contexto sob seu controle'}</small></span></div><div className="meridian-rail-utilities"><button aria-label="Continuidade" title="Continuidade" onClick={()=>open('Continuidade')}><Clock3 size={18}/></button><button aria-label="Notificações" title="Notificações" onClick={()=>open('Notificações')}><Bell size={18}/></button><button aria-label="Ajustes" title="Ajustes" onClick={()=>open('Configurações')}><Settings size={18}/></button></div><section className="account sidebar-account" aria-label={sidebarAccount.displayName} onClick={event=>{if((event.target as HTMLElement).closest('[data-sidebar-account-open]'))open('Minha conta');}} dangerouslySetInnerHTML={{__html:sidebarProfileButtonMarkup(sidebarAccount,false,activeWindow?.title==='Minha conta')}}/></>,
    auxiliary:<button type="button" className="sidebar-collapse" aria-label={collapseLabel} title={collapseLabel} aria-controls="workspace-sidebar" aria-expanded={expanded} onClick={()=>onSidebarChange(expanded?'collapsed':'expanded')}>{expanded?<PanelLeftClose size={16}/>:<PanelLeftOpen size={16}/>}</button>,
  };
  return <Dialog open={startOpen} onOpenChange={setStartOpen}>
    <DialogContent placement="custom" portalContainer={menuContainer} className="desktop-start-menu meridian-navigation-menu" onCloseAutoFocus={event=>{event.preventDefault();if(menuNavigated.current)return;const target=menuTrigger.current?.getClientRects().length&&menuTrigger.current.tabIndex>=0?menuTrigger.current:menuContainer?.querySelector<HTMLElement>('[data-navigation-trigger]');target?.focus({preventScroll:true});}}><DialogTitle>Aplicativos e navegação</DialogTitle><DialogDescription>Encontre um destino. Escape fecha este menu.</DialogDescription><label className="desktop-menu-search"><Search size={17}/><input aria-label="Pesquisar destinos" placeholder="Apps, Spaces e recursos" value={search} onChange={event=>setSearch(event.target.value)}/></label><div className="desktop-menu-apps">{homeMatch&&<Button variant="ghost" className="desktop-menu-item" onClick={home}><LayoutGrid/>Central<ChevronRight/></Button>}{menuItems.map(item=><Button variant="ghost" key={item.name} className="desktop-menu-item" onClick={()=>open('target'in item&&item.target?item.target:item.name)}><item.icon/>{item.name}<ChevronRight className="ml-auto"/></Button>)}</div>{!menuItems.length&&!homeMatch&&<p role="status">Nenhum destino encontrado.</p>}</DialogContent>
    <aside ref={sidebar} id="workspace-sidebar" className="os-sidebar workspace-sidebar ordax-product-sidebar meridian-rail" aria-label="Navegação principal">{SIDEBAR_LAYOUT.map(slot=>createElement(slot.tag,{key:slot.key,className:slot.className,'data-sidebar-slot':slot.key,ref:slot.key==='navigation'?nav:undefined,'aria-label':slot.key==='navigation'?'Destinos':undefined},slots[slot.key]))}</aside><div ref={hintHost} data-sidebar-hint-host/>
    <footer className="desktop-taskbar workspace-navigation meridian-taskbar" aria-label="Navegação inferior"><div className="meridian-taskbar-start"><Button variant="ghost" size="icon" data-workspace-switch aria-label={view==='central'?'Abrir área de trabalho':'Abrir Central'} title={view==='central'?'Área de trabalho':'Voltar à Central'} aria-pressed={view==='desktop'} onClick={onToggleView}><DestinationIcon/></Button><button className="meridian-launcher" aria-label="Abrir aplicativos e navegação" title="Aplicativos e navegação" data-navigation-trigger onClick={event=>openMenu(event.currentTarget)}><LayoutGrid size={19}/></button><button className="meridian-dock-search" aria-label="Buscar aplicativos e recursos" title="Buscar · Ctrl K" onClick={event=>openMenu(event.currentTarget)}><Search size={18}/></button></div><div className="meridian-dock-frame" data-start={edges.start} data-end={edges.end}><div ref={dock} className="desktop-running-apps meridian-dock" role="group" aria-label="Aplicativos fixados e abertos" onKeyDown={dockKeys}>{dockItems.map(item=>{const window=state.windows.find(window=>getWindowTitle(window.title)===getWindowTitle(item.name));const selected=!!window&&!window.minimized&&state.active===window.title;const label=selected?'Ativo':window?.minimized?'Minimizado':window?'Aberto':'Fixado';return <Button variant="ghost" className="desktop-task" key={item.id} data-window-restore={window?.title} data-pinned={!window} data-active={selected} data-minimized={window?.minimized??false} aria-label={window?`Restaurar janela ${window.title}`:`Abrir ${item.name} · Fixado`} aria-current={selected?'true':undefined} title={`${item.name} · ${label}`} onClick={()=>window?dispatch({type:window.minimized?'open':'focus',title:window.title}):open(item.name)}><AppIcon icon={item.icon} tone={item.tone}/><span className="meridian-dock-label">{item.name}</span></Button>;})}</div><span className="meridian-dock-edge start" aria-hidden>‹</span><span className="meridian-dock-edge end" aria-hidden>›</span></div><div className="meridian-taskbar-end"><button aria-label="Notificações" title="Notificações" onClick={()=>open('Notificações')}><Bell size={18}/></button><button aria-label="Estado do sistema" title="Sistema · consultar disponibilidade" onClick={()=>open('Configurações')}><ShieldCheck size={18}/><span>Web</span></button></div></footer>
  </Dialog>;
}
