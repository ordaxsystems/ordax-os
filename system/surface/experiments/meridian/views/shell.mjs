import { currentContext } from '../context.mjs';
import { sections, findSection } from '../catalog.mjs';
import { icon, iconButton, avatar, esc } from '../ui.mjs';
import { presentationDestination } from '../../../workspace/presentation.mjs';
const brand = new URL('../../../ui/brand/ordax-symbol.png',import.meta.url).href;
function navItem(item,active){return `<button class="md-nav-item ${active===item.id?'is-active':''}" type="button" data-action="route:${item.id}" ${active===item.id?'aria-current="page"':''} title="${esc(item.label)}" aria-label="${esc(item.label)}">${icon(item.icon)}<span>${esc(item.label)}</span>${active===item.id?'<i aria-hidden="true"></i>':''}</button>`;}
export function shell(data,ui,content){
 const {space}=currentContext(data);
 const dockApps=data.apps.filter((app,index)=>index<5||ui.windows.some(win=>win.id===app.id));
 const battery=data.devices.find(item=>item.id==='computer')?.battery??0;
 const guest=data.scenario==='guest';
 const destination=presentationDestination(ui.presentation);
 const switchLabel=destination.target==='desktop'?'Área de trabalho':'Voltar à Central';
 const unread=data.activity.filter(item=>!data.read.includes(item.id)).length;
 return `<a class="md-skip" href="#meridian-main">Ir ao conteúdo</a><aside class="md-sidebar" aria-label="Navegação principal">
  <button class="md-brand" type="button" data-action="route:central" aria-label="OrdaX Central"><img src="${brand}" alt=""/><span>OrdaX <em>OS</em></span></button>
  <button class="md-space-switch" type="button" data-action="panel:spaces" aria-label="Trocar Space, atual: ${esc(space.name)}"><span class="md-space-symbol">${icon(space.icon,20)}</span><span><small>SEU SPACE</small><strong>${esc(space.name)}</strong></span>${icon('down',15)}</button>
  <nav>${sections.filter(item=>item.group==='principal').map(item=>navItem(item,ui.presentation==='central'?ui.route:null)).join('')}<p class="md-nav-label">ECOSSISTEMA</p>${sections.filter(item=>item.group==='ecossistema').map(item=>navItem(item,ui.presentation==='central'?ui.route:null)).join('')}</nav>
  <div class="md-sidebar-context"><span class="md-tiny-dot"></span><p>${data.scenario==='offline'?'Trabalhando offline':'Seu contexto, conectado'}<small>${esc(space.profile)}</small></p></div>
  <div class="md-sidebar-bottom"><div class="md-sidebar-utilities">${iconButton('Continuidade','route:activity','clock')}${iconButton('Notificações','panel:notifications','bell',unread?'has-unread':'')}${iconButton('Ajustes','route:settings','settings')}</div><button class="md-account" type="button" data-action="panel:account" aria-label="Conta e identidade">${avatar(guest?'VO':data.person.initials)}<span><strong>${guest?'Seu dispositivo':esc(data.person.name)}</strong><small>${guest?'Continuar sem conta':'Conta pessoal'}</small></span>${icon('chevron',16)}</button></div>
 </aside><div class="md-workspace"><header class="md-topbar">
 <div class="md-topbar-location">${iconButton('Abrir navegação','panel:menu','menu','md-mobile-menu')}<span class="md-location">${ui.presentation==='desktop'?'Área de trabalho':esc(findSection(ui.route).label)}</span><span class="md-topbar-separator">/</span><button type="button" data-action="panel:spaces">${esc(space.name)} ${icon('down',13)}</button></div>
 <button class="md-topbar-search" type="button" data-action="panel:search" aria-label="Encontre o seu próximo passo">${icon('search',17)}<span>Encontre o seu próximo passo</span><kbd>Ctrl K</kbd></button>
 <div class="md-topbar-status"><button class="md-demo-label" type="button" data-action="panel:scenes" aria-label="Meridian · estudo visual"><i></i><span>Meridian <small>· estudo visual</small><small class="md-study-short">· estudo</small></span></button>${iconButton('Ajustes rápidos do sistema','panel:system',data.scenario==='offline'?'globe':'wifi')}${iconButton('Conta e identidade','panel:account','profiles','md-mobile-account')}</div>
 </header><main id="meridian-main" class="md-main ${ui.presentation==='desktop'?'is-desktop':''}" tabindex="-1">${content}</main>
 <footer class="md-taskbar"><div class="md-taskbar-start">${iconButton(switchLabel,'presentation:toggle',destination.target==='desktop'?'desktop':'central','md-view-toggle')}<span class="md-taskbar-label">${ui.presentation==='desktop'?'Desktop':'Central'}</span></div>
 <div class="md-dock" aria-label="Aplicativos e janelas de demonstração">${dockApps.map(app=>`<button type="button" class="md-dock-app ${ui.windows.some(win=>win.id===app.id)?'is-running':''}" data-action="app:${app.id}" aria-label="Abrir ${esc(app.name)}" title="${esc(app.name)}"><span class="md-dock-symbol md-glyph--${app.tone}">${icon(app.icon,21)}</span><span class="md-dock-tooltip">${esc(app.name)}</span></button>`).join('')}<span class="md-dock-divider"></span>${iconButton('Todos os aplicativos','route:apps','apps')}</div>
 <div class="md-taskbar-end"><button class="md-focus-toggle ${data.focus?'is-active':''}" type="button" data-action="focus" aria-label="Foco" aria-pressed="${data.focus}">${icon(data.focus?'pause':'moon',16)}<span>${data.focus?'Em foco':'Foco'}</span></button><button class="md-system-summary" type="button" data-action="panel:system" aria-label="Sistema, bateria de exemplo em ${battery} por cento">${icon('battery',21)}<span>${battery}%</span></button></div></footer></div>
 <div class="md-panel-root"></div><div class="md-toast" role="status" aria-live="polite"></div>`;
}
