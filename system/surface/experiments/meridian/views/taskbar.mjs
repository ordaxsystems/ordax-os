import { windowTarget } from '../catalog.mjs';
import { unreadNotificationCount } from './operations.mjs';
import { currentContext, foregroundWindow } from '../context.mjs';
import { icon, iconButton, esc, presentationControl } from '../ui.mjs';

export function studyMarker(compact=false,review=false){if(!review)return '';return `<button class="md-demo-label" type="button" data-action="panel:scenes" aria-label="Meridian · estudo visual" title="Meridian · estudo visual" data-tooltip="Meridian · estudo visual"><i></i><span>${compact?'Estudo':'Meridian <small>· estudo visual</small><small class="md-study-short">· estudo</small>'}</span></button>`;}

export function taskbar(data,ui){
 const isDesktop=ui.presentation==='desktop';
 const {space}=currentContext(data);
 const pinned=space.featuredApps??data.apps.slice(0,5).map(app=>app.id);
 const dockApps=[...new Set([...pinned,...ui.windows.map(win=>win.id)])].map(id=>windowTarget(data,id)).filter(Boolean);
 const battery=data.devices.find(item=>item.id==='computer')?.battery;
 const destination=presentationControl(ui.presentation);
 const unread=unreadNotificationCount(data,ui);
 return `<footer class="md-taskbar" aria-label="Barra de trabalho"><div class="md-taskbar-start">
 ${iconButton(destination.label,'presentation:toggle',destination.icon,'md-view-toggle')}
 ${isDesktop?iconButton('Abrir aplicativos e navegação','panel:menu','apps','md-launcher')+iconButton('Buscar no contexto · Ctrl ou Command K','panel:search','search','md-taskbar-search'):`<span class="md-taskbar-label">Central</span>`}
 </div><div class="md-dock-frame" data-overflow="none"><div class="md-dock" role="group" aria-label="Aplicativos fixados e abertos" aria-describedby="md-dock-scroll-hint">${dockApps.map(app=>{
 const win=ui.windows.find(win=>win.id===app.id);
 const active=foregroundWindow(ui)?.id===win?.id&&!!win;
 const state=active?'Ativo':win?.minimized?'Minimizado':win?'Aberto':'Fixado';
 return `<button type="button" class="md-dock-app ${win?'is-running':''} ${active?'is-active':''} ${win?.minimized?'is-minimized':''}" data-action="app:${app.id}" aria-label="${esc(app.name)} · ${state}" ${active?'aria-current="true"':''} title="${esc(app.name)} · ${state}" data-tooltip="${esc(app.name)} · ${state}"><span class="md-dock-symbol md-glyph--${app.tone}">${icon(app.icon,21)}</span></button>`;
 }).join('')}${!isDesktop?`<span class="md-dock-divider"></span>${iconButton('Todos os aplicativos','route:apps','apps')}`:''}</div><span class="md-dock-edge md-dock-edge--start" aria-hidden="true">${icon('chevron',12)}</span><span class="md-dock-edge md-dock-edge--end" aria-hidden="true">${icon('chevron',12)}</span><span id="md-dock-scroll-hint" class="md-sr-only">Deslize para ver mais aplicativos. No teclado, use as setas esquerda e direita, Home e End.</span></div>
 <div class="md-taskbar-end" aria-label="${isDesktop?'Bandeja do sistema':'Estado do sistema'}">${isDesktop?`
 ${iconButton('Intelligence neste contexto','panel:intelligence-context','aura','md-context-intelligence')}
 ${iconButton(`Notificações · ${unread} não lidas`,'panel:notifications','bell','md-tray-notifications '+(unread?'has-unread':''))}
 <button type="button" class="md-tray-system" data-action="panel:system" aria-haspopup="dialog" aria-expanded="${ui.panel?.type==='system'}" data-tooltip="Ajustes rápidos" title="Ajustes rápidos" aria-label="Ajustes rápidos · ${data.networkOnline?'rede conectada':'offline'} · bateria ${battery??'indisponível'}">${icon(data.networkOnline?'wifi':'globe',18)}<span class="md-tray-battery">${icon('battery',18)} ${battery??'—'}%</span><span class="md-tray-time">${esc(data.time)}${ui.review?'<small>exemplo</small>':''}</span></button>${studyMarker(true,ui.review)}`:`
 <button class="md-focus-toggle ${data.focus?'is-active':''}" type="button" data-action="focus" aria-label="Foco" aria-pressed="${data.focus}">${icon(data.focus?'pause':'moon',16)}<span>${data.focus?'Em foco':'Foco'}</span></button><button class="md-system-summary" type="button" data-action="panel:system" aria-label="Sistema, bateria em ${battery??'indisponível'} por cento">${icon('battery',21)}<span>${battery??'—'}%</span></button>`}</div></footer>`;
}
