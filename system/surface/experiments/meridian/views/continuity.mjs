import { button, esc } from '../ui.mjs';
/** Presentation derived from existing, scoped storyboard state. Not a task queue. */
export function continuityItems(data,ui){
 const states=[...ui.stories].filter(([key])=>{const [subject,space]=JSON.parse(key);return subject===data.presentationSubject&&(space===data.activeSpace||space==='@device');});
 const has=(kind,steps)=>states.some(([key,state])=>JSON.parse(key)[2]===kind&&steps.includes(state.step));
 const pending=has('update',['restart','deferred']);
 const items=[];
 if(!data.activeSpace)items.push({id:'space',text:'Contexto indisponível. Escolha um Space; o trabalho anterior não é transferido automaticamente.',action:'panel:spaces',label:'Escolher contexto'});
 if(ui.cloudExpired)items.push({id:'identity',text:'Conta expirada. Você pode continuar localmente; conteúdo remoto aguarda nova identificação.',action:'panel:account',label:'Revisar conta'});
 if(!data.networkOnline)items.push({id:'network',text:data.scenario==='guest'?'Sessão local e offline. Continue com os recursos disponíveis neste dispositivo.':pending?'Offline e com reinício pendente. O trabalho local continua; a atualização permanece adiada.':'Offline. O trabalho local continua; recursos remotos aguardam conexão.',action:'journey:settings:network',label:'Ver conexão'});
 if(pending&&ui.pendingDraftCount)items.push({id:'update',text:'Reinício pendente com texto não salvo. Revise os rascunhos antes de continuar.',action:'journey:update',label:'Revisar pendências'});
 if(has('files',['full'])||has('storage',['full']))items.push({id:'storage',text:'Gravação interrompida por falta de espaço. O rascunho permanece nesta sessão; nada foi apagado.',action:'journey:storage',label:'Ver armazenamento'});
 if(has('device',['offline'])&&ui.windows.length)items.push({id:'device',text:'Dispositivo indisponível durante o trabalho. A janela permanece aberta; a operação remota não foi concluída.',action:'route:devices',label:'Ver dispositivos'});
 return items;
}
export function continuityView(data,ui){
 const items=continuityItems(data,ui);
 return items.length?`<section class="md-continuity" aria-label="Continuidade da sessão">${items.map(item=>`<div data-continuity="${item.id}"><p>${esc(item.text)}</p>${button(item.label,item.action,'arrow')}</div>`).join('')}</section>`:'';
}
