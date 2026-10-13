import { windowTarget } from '../catalog.mjs';
import { unreadNotificationCount } from './operations.mjs';
import { currentContext } from '../context.mjs';
import { icon, iconButton, esc } from '../ui.mjs';
import { presentationDestination } from '../../../workspace/presentation.mjs';

export function studyMarker(compact=false){return `<button class="md-demo-label" type="button" data-action="panel:scenes" aria-label="Meridian · estudo visual"><i></i><span>${compact?'Estudo':'Meridian <small>· estudo visual</small><small class="md-study-short">· estudo</small>'}</span></button>`;}

export function taskbar(data,ui){
 const isDesktop=ui.presentation==='desktop';
 const {space}=currentContext(data);
 const pinned=space.featuredApps??data.apps.slice(0,5).map(app=>app.id);
 const dockApps=[...new Set([...pinned,...ui.windows.map(win=>win.id)])].map(id=>windowTarget(data,id)).filter(Boolean);
 const battery=data.devices.find(item=>item.id==='computer')?.battery;
 const destination=presentationDestination(ui.presentation);
 const unread=unreadNotificationCount(data,ui);
 return `<footer class="md-taskbar" aria-label="Barra de trabalho"><div class="md-taskbar-start">
 ${iconButton(destination.target==='desktop'?'Área de trabalho':'Voltar à Central','presentation:toggle',destination.target==='desktop'?'desktop':'central','md-view-toggle')}
 ${isDesktop?iconButton('Abrir aplicativos e navegação','panel:menu','apps','md-launcher')+iconButton('Buscar no contexto · Ctrl ou Command K','panel:search','search','md-taskbar-search'):`<span class="md-taskbar-label">Central</span>`}
 </div><div class="md-dock" role="group" aria-label="Aplicativos fixados e abertos">${dockApps.map(app=>{
 const win=ui.windows.find(win=>win.id===app.id);
 const active=isDesktop&&win&&!win.minimized&&ui.activeWindow===win.id;
 const state=active?'Ativo':win?.minimized?'Minimizado':win?'Aberto':'Fixado';
 return `<button type="button" class="md-dock-app ${win?'is-running':''} ${active?'is-active':''} ${win?.minimized?'is-minimized':''}" data-action="app:${app.id}" aria-label="${esc(app.name)} · ${state}" ${active?'aria-current="true"':''} title="${esc(app.name)} · ${state}"><span class="md-dock-symbol md-glyph--${app.tone}">${icon(app.icon,21)}</span><span class="md-dock-tooltip">${esc(app.name)} · ${state}</span></button>`;
 }).join('')}${!isDesktop?`<span class="md-dock-divider"></span>${iconButton('Todos os aplicativos','route:apps','apps')}`:''}</div>
 <div class="md-taskbar-end" aria-label="${isDesktop?'Bandeja do sistema':'Estado do sistema'}">${isDesktop?`
 ${iconButton('Intelligence neste contexto','panel:intelligence-context','aura','md-context-intelligence')}
 ${iconButton(`Notificações · ${unread} não lidas`,'panel:notifications','bell','md-tray-notifications '+(unread?'has-unread':''))}
 <button type="button" class="md-tray-system" data-action="panel:system" aria-label="Ajustes rápidos · ${data.networkOnline?'rede de exemplo':'offline'} · bateria ${battery??'indisponível'} · informações ilustrativas">${icon(data.networkOnline?'wifi':'globe',18)}<span class="md-tray-battery">${icon('battery',18)} ${battery??'—'}%</span><span class="md-tray-time">${esc(data.time)}<small>exemplo</small></span></button>${studyMarker(true)}`:`
 <button class="md-focus-toggle ${data.focus?'is-active':''}" type="button" data-action="focus" aria-label="Foco" aria-pressed="${data.focus}">${icon(data.focus?'pause':'moon',16)}<span>${data.focus?'Em foco':'Foco'}</span></button><button class="md-system-summary" type="button" data-action="panel:system" aria-label="Sistema, bateria de exemplo em ${battery??'indisponível'} por cento">${icon('battery',21)}<span>${battery??'—'}%</span></button>`}</div></footer>`;
}
