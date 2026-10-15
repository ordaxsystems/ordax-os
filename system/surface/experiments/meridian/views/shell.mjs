import { unreadNotificationCount } from './operations.mjs';
import { currentContext, foregroundWindow } from '../context.mjs';
import { navigationSections, findSection } from '../catalog.mjs';
import { icon, iconButton, avatar, esc } from '../ui.mjs';
import { taskbar, studyMarker } from './taskbar.mjs';
const brand = new URL('../../../ui/brand/ordax-symbol.png',import.meta.url).href;
function navItem(item,active,presentation){return `<button class="md-nav-item ${active===item.id?'is-active':''}" type="button" data-action="route:${item.id}" ${active===item.id?`aria-current="${presentation==='central'?'page':'true'}"`:''} data-tooltip="${esc(item.sidebarLabel??item.label)}" title="${esc(item.sidebarLabel??item.label)}" aria-label="${esc(item.sidebarLabel??item.label)}">${icon(item.icon)}<span>${esc(item.sidebarLabel??item.label)}</span>${active===item.id?'<i aria-hidden="true"></i>':''}</button>`;}
export function shell(data,ui,content){
 const {space}=currentContext(data);
 const activeRoute=ui.presentation==='central'?ui.route:foregroundWindow(ui)?.route;
 const guest=data.scenario==='guest';
 const unread=unreadNotificationCount(data,ui);
 return `<a class="md-skip" href="#meridian-main">Ir ao conteúdo</a><aside class="md-sidebar" aria-label="Navegação principal">
  ${ui.presentation==='desktop'?`<div class="md-brand"><img src="${brand}" alt="OrdaX OS"/><span>OrdaX <em>OS</em></span></div>`:`<button class="md-brand" type="button" data-action="route:central" aria-label="OrdaX Central"><img src="${brand}" alt=""/><span>OrdaX <em>OS</em></span></button>`}
  <button class="md-space-switch" type="button" data-action="panel:spaces" aria-label="Trocar Space, atual: ${esc(space.name)}" title="Trocar Space, atual: ${esc(space.name)}" data-tooltip="Trocar Space, atual: ${esc(space.name)}" aria-haspopup="dialog"><span class="md-space-symbol">${icon(space.icon,20)}</span><span><small>SEU SPACE</small><strong>${esc(space.name)}</strong></span>${icon('down',15)}</button>
  <nav>${navigationSections(ui.presentation).filter(item=>item.group==='principal').map(item=>navItem(item,activeRoute,ui.presentation)).join('')}<p class="md-nav-label">ECOSSISTEMA</p>${navigationSections(ui.presentation).filter(item=>item.group==='ecossistema').map(item=>navItem(item,activeRoute,ui.presentation)).join('')}</nav>
  <div class="md-sidebar-context"><span class="md-tiny-dot"></span><p>${!data.networkOnline?'Trabalhando offline':guest?'Sessão local':'Seu contexto, conectado'}<small>${esc(space.profile)}</small></p></div>
  <div class="md-sidebar-bottom"><div class="md-sidebar-utilities">${iconButton('Continuidade','route:activity','clock')}${iconButton('Notificações','panel:notifications','bell',unread?'has-unread':'')}${iconButton('Ajustes','route:settings','settings')}</div><button class="md-account" type="button" data-action="panel:account" aria-label="Conta e identidade" title="Conta e identidade" data-tooltip="Conta e identidade" aria-haspopup="dialog">${avatar(guest?'VO':data.person.initials)}<span><strong>${guest?'Seu dispositivo':esc(data.person.name)}</strong><small>${guest?'Continuar sem conta':'Conta pessoal'}</small></span>${icon('chevron',16)}</button></div>
 </aside><div class="md-workspace">${ui.presentation==='desktop'?'':`<header class="md-topbar">
 <div class="md-topbar-location">${iconButton('Abrir navegação','panel:menu','menu','md-mobile-menu')}<span class="md-location">${esc(findSection(ui.route).label)}</span><span class="md-topbar-separator">/</span><button type="button" data-action="panel:spaces">${esc(space.name)} ${icon('down',13)}</button></div>
 <button class="md-topbar-search" type="button" data-action="panel:search" aria-label="Encontre o seu próximo passo">${icon('search',17)}<span>Encontre o seu próximo passo</span><kbd>Ctrl K</kbd></button>
 <div class="md-topbar-status">${studyMarker(false,ui.review)}${iconButton('Ajustes rápidos do sistema','panel:system',data.networkOnline?'wifi':'globe')}${iconButton('Conta e identidade','panel:account','profiles','md-mobile-account')}</div>
 </header>`}<main id="meridian-main" class="md-main ${ui.presentation==='desktop'?'is-desktop':''}" tabindex="-1">${content}</main>
 ${taskbar(data,ui)}</div>
 <div class="md-pointer-hint" role="tooltip" hidden></div><div class="md-panel-root"></div><div class="md-toast" role="status" aria-live="polite"></div>`;
}
