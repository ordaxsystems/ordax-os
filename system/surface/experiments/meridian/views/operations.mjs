import { continuityView } from './continuity.mjs';
import { findMaterial } from '../catalog.mjs';
import { button, tag, glyph, esc, switchRow, notice, icon } from '../ui.mjs';
export const unreadNotificationCount=(data,ui)=>data.activity.filter(item=>!ui.dismissed.includes(item.id)&&!data.read.includes(item.id)).length;
export function notificationsView(data,ui) {
 const filter=ui.notificationFilter;
 const all=data.activity;
 const entries=all.filter(item=>filter==='history'?ui.dismissed.includes(item.id):!ui.dismissed.includes(item.id)&&(filter!=='unread'||!data.read.includes(item.id)));
 return `${switchRow('Não perturbe','Escolha visual desta sessão; não altera notificações do sistema.',ui.dnd,'notification-dnd')}
 <div class="md-notification-filters" aria-label="Filtrar notificações">${[['unread','Não lidas'],['all','Todas'],['history','Histórico']].map(([id,label])=>`<button type="button" class="md-button" data-action="notification-filter:${id}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div>
 ${button('Marcar exemplos como lidos','read-all','check')}
 ${ui.dnd?notice('Alertas visuais silenciados no ensaio. Os eventos continuam no histórico.'):''}
 <div class="md-notification-list">${entries.map(item=>`<article class="md-notification-item ${data.read.includes(item.id)?'is-read':''}">${glyph(item.icon,item.tone)}<div><div class="md-notification-origin">${tag(item.source??'Continuidade')}${tag(item.priority??'Informação')}${tag('Exemplo','clay')}</div><small>${esc(item.time)}</small><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p><div class="md-inline-actions">${button('Ver contexto',item.action,'arrow')}${filter==='history'?button('Restaurar',`notification-restore:${item.id}`,'refresh'):(!data.read.includes(item.id)?button('Lida',`read:${item.id}`,'check'):'')+button('Dispensar',`notification-dismiss:${item.id}`,'close')}</div></div></article>`).join('')||`<div class="md-empty"><h3>${filter==='unread'?'Tudo em dia neste contexto.':'Nenhum evento nesta seleção.'}</h3><p>Notificações de outra identidade ou Space não aparecem aqui.</p></div>`}</div><p class="md-hint">Uma notificação aponta para o evento do owner. Ela não é a fonte de verdade de tarefas ou comandos.</p>`;
}
export function systemView(data,ui) {
 const fixture=ui.lab.system;
 const battery=data.devices.find(item=>item.id==='computer')?.battery;
 const range=(id,label,value,glyphName,min=0)=>`<div class="md-quick-range"><label for="md-quick-${id}">${icon(glyphName,19)}<span>${label}</span><output for="md-quick-${id}" data-range-value="${id}">${value}%</output></label><input id="md-quick-${id}" type="range" min="${min}" max="100" value="${value}" data-range="${id}" aria-label="${label}"/></div>`;
 return `${continuityView(data,ui)}<div class="md-quick-status"><span class="md-quick-device">${icon('desktop',23)}<span><strong>${esc(fixture.host)}</strong><small>${data.networkOnline?'Conectado à internet':'Sem conexão com a internet'}</small></span></span><span class="md-quick-battery">${icon('battery',19)}${battery??'—'}%</span></div>
 <div class="md-quick-grid"><button type="button" class="md-quick-tile ${data.networkOnline?'is-on':''}" data-action="journey:settings:network">${icon(data.networkOnline?'wifi':'globe',24)}<strong>Wi-Fi</strong><small>${data.networkOnline?'Estúdio':'Desconectado'}</small>${icon('chevron',16)}</button>
 <button type="button" class="md-quick-tile ${data.focus?'is-on':''}" data-action="focus" aria-pressed="${data.focus}">${icon('moon',24)}<strong>Foco</strong><small>${data.focus?'Ativado':'Desativado'}</small></button>
 <button type="button" class="md-quick-tile ${ui.dnd?'is-on':''}" data-action="notification-dnd" aria-pressed="${ui.dnd}">${icon('bell',24)}<strong>Não perturbe</strong><small>${ui.dnd?'Ativado':'Desativado'}</small></button>
 <button type="button" class="md-quick-tile" data-action="panel:materials">${icon('sun',24)}<strong>Aparência</strong><small>${esc(findMaterial(ui.material)?.name)}</small>${icon('chevron',16)}</button></div>
 <div class="md-quick-sliders">${range('brightness','Brilho',ui.brightness,'sun',40)}${range('volume','Volume',ui.volume,'music')}</div>
 <div class="md-quick-footer">${button('Conta e sessão','panel:account','profiles')}${button('Bloquear','lab-lock','shield')}${button('Todos os ajustes','route:settings','settings')}</div>
 <details class="md-quick-more"><summary>Mais opções do sistema</summary><dl class="md-detail-list"><div><dt>Sessão</dt><dd>${esc(fixture.localUser)}</dd></div><div><dt>Sistema</dt><dd>OrdaX USB</dd></div><div><dt>Armazenamento</dt><dd>${esc(fixture.used)} de ${esc(fixture.capacity)}</dd></div></dl><div class="md-panel-actions">${button('Notificações','panel:notifications','bell')}${button('Intelligence neste contexto','panel:intelligence-context','aura')}${button('Armazenamento','journey:storage','folder')}${button('Atualização do sistema','journey:update','refresh')}${button('Energia e pendências','journey:power','pause')}${button('Recuperação','journey:recovery','shield')}${button('Primeiro uso','journey:setup','sun')}${button('Áudio','journey:settings:audio','music')}</div></details>
 ${ui.review?`<details class="md-network-example"><summary>Condição de rede para revisão</summary><div class="md-panel-actions">${button('Offline','network-example:offline','globe')}${button('Conectado','network-example:connected','wifi')}</div></details>`:''}`;
}
