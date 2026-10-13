import { unreadNotificationCount } from './operations.mjs';
import { currentContext } from '../context.mjs';
import { sections, findSection } from '../catalog.mjs';
import { icon, iconButton, avatar, esc } from '../ui.mjs';
import { taskbar, studyMarker } from './taskbar.mjs';
const brand = new URL('../../../ui/brand/ordax-symbol.png',import.meta.url).href;
function navItem(item,active){return `<button class="md-nav-item ${active===item.id?'is-active':''}" type="button" data-action="route:${item.id}" ${active===item.id?'aria-current="page"':''} title="${esc(item.sidebarLabel??item.label)}" aria-label="${esc(item.sidebarLabel??item.label)}">${icon(item.icon)}<span>${esc(item.sidebarLabel??item.label)}</span>${active===item.id?'<i aria-hidden="true"></i>':''}</button>`;}
export function shell(data,ui,content){
 const {space}=currentContext(data);
 const activeRoute=ui.presentation==='central'?ui.route:ui.windows.find(win=>win.id===ui.activeWindow&&!win.minimized)?.route;
 const guest=data.scenario==='guest';
 const unread=unreadNotificationCount(data,ui);
 return `<a class="md-skip" href="#meridian-main">Ir ao conteúdo</a><aside class="md-sidebar" aria-label="Navegação principal">
  ${ui.presentation==='desktop'?`<div class="md-brand"><img src="${brand}" alt="OrdaX OS"/><span>OrdaX <em>OS</em></span></div>`:`<button class="md-brand" type="button" data-action="route:central" aria-label="OrdaX Central"><img src="${brand}" alt=""/><span>OrdaX <em>OS</em></span></button>`}
  <button class="md-space-switch" type="button" data-action="panel:spaces" aria-label="Trocar Space, atual: ${esc(space.name)}"><span class="md-space-symbol">${icon(space.icon,20)}</span><span><small>SEU SPACE</small><strong>${esc(space.name)}</strong></span>${icon('down',15)}</button>
  <nav>${sections.filter(item=>item.group==='principal'&&(ui.presentation==='central'||item.id!=='central')).map(item=>navItem(item,activeRoute)).join('')}<p class="md-nav-label">ECOSSISTEMA</p>${sections.filter(item=>item.group==='ecossistema').map(item=>navItem(item,activeRoute)).join('')}</nav>
  <div class="md-sidebar-context"><span class="md-tiny-dot"></span><p>${!data.networkOnline?'Trabalhando offline':guest?'Sessão local':'Seu contexto, conectado'}<small>${esc(space.profile)}</small></p></div>
  <div class="md-sidebar-bottom"><div class="md-sidebar-utilities">${iconButton('Continuidade','route:activity','clock')}${iconButton('Notificações','panel:notifications','bell',unread?'has-unread':'')}${iconButton('Ajustes','route:settings','settings')}</div><button class="md-account" type="button" data-action="panel:account" aria-label="Conta e identidade">${avatar(guest?'VO':data.person.initials)}<span><strong>${guest?'Seu dispositivo':esc(data.person.name)}</strong><small>${guest?'Continuar sem conta':'Conta pessoal'}</small></span>${icon('chevron',16)}</button></div>
 </aside><div class="md-workspace">${ui.presentation==='desktop'?'':`<header class="md-topbar">
 <div class="md-topbar-location">${iconButton('Abrir navegação','panel:menu','menu','md-mobile-menu')}<span class="md-location">${esc(findSection(ui.route).label)}</span><span class="md-topbar-separator">/</span><button type="button" data-action="panel:spaces">${esc(space.name)} ${icon('down',13)}</button></div>
 <button class="md-topbar-search" type="button" data-action="panel:search" aria-label="Encontre o seu próximo passo">${icon('search',17)}<span>Encontre o seu próximo passo</span><kbd>Ctrl K</kbd></button>
 <div class="md-topbar-status">${studyMarker()}${iconButton('Ajustes rápidos do sistema','panel:system',data.networkOnline?'wifi':'globe')}${iconButton('Conta e identidade','panel:account','profiles','md-mobile-account')}</div>
 </header>`}<main id="meridian-main" class="md-main ${ui.presentation==='desktop'?'is-desktop':''}" tabindex="-1">${content}</main>
 ${taskbar(data,ui)}</div>
 <div class="md-panel-root"></div><div class="md-toast" role="status" aria-live="polite"></div>`;
}
