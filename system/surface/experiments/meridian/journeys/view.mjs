import { icon, button, esc, tag, notice, glyph } from '../ui.mjs';
import { currentContext } from '../context.mjs';

const rows = values => `<dl class="md-journey-facts">${values.map(item=>`<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join('')}</dl>`;
const setupGroups = [
 {label:'Boas-vindas',steps:['boot','boot-error','welcome']},
 {label:'Preferências',steps:['language','keyboard','region']},
 {label:'Conexão',steps:['network','network-connecting','network-error']},
 {label:'Segurança',steps:['security']},
 {label:'Sua conta',steps:['account','sign-in','sign-up','identity-error']},
 {label:'Privacidade',steps:['privacy']},
 {label:'Pronto para começar',steps:['name','review','save-error','complete']},
];
function setupProgress(state) {
 const current = setupGroups.findIndex(group=>group.steps.includes(state.step));
 return {current, total:setupGroups.length, markup:`<aside class="md-journey-trail" aria-label="Etapas da configuração"><p class="md-eyebrow">PRIMEIROS PASSOS</p><ol>${setupGroups.map((group,index)=>`<li aria-label="${esc(group.label)}" ${index===current?'aria-current="step"':''} class="${index<current?'is-complete':''}"><span>${index<current?icon('check',13):index+1}</span><p>${group.label}</p></li>`).join('')}</ol><p class="md-hint">Tudo no seu tempo. Você pode voltar para revisar suas escolhas.</p></aside>`};
}
function accountIntro(){return `<aside class="md-account-intro"><span class="md-account-orbit" aria-hidden="true">${icon('spaces',44)}</span><p class="md-eyebrow">SUA CONTA ORDAX</p><h2>Uma identidade.<br>Novas possibilidades.</h2><p>Seu trabalho, suas ferramentas e um lugar para continuar.</p><ul><li>${icon('spaces',19)}<span>Seus Spaces, sempre por perto</span></li><li>${icon('shield',19)}<span>Privacidade sob seu controle</span></li><li>${icon('desktop',19)}<span>Uma experiência entre dispositivos</span></li></ul></aside>`;}
export function storyboardFields(definition,state,topics) {
 const frame=definition.screens[state.step];
 return frame.topicFields ? (topics.find(item=>item.id===state.entity)?.fields ?? []) : frame.fields ?? [];
}
export function entityFor(kind,id,data,topics) {
 const collection={space:data.spaces,profile:data.profiles,store:data.store,device:data.devices,settings:topics};
 return collection[kind]?.find(item=>item.id===id) ?? null;
}
function fieldMarkup(field,state) {
 const value=state.fields[field.id] ?? field.value ?? '';
 const id=`md-journey-${field.id}`;
 const control=field.options
  ? `<select id="${id}" data-story-field="${esc(field.id)}">${field.options.map(option=>`<option value="${esc(option.value)}" ${value===option.value?'selected':''}>${esc(option.label)}</option>`).join('')}</select>`
  : field.multiline
   ? `<textarea id="${id}" data-story-field="${esc(field.id)}" maxlength="${field.max??1000}" rows="4">${esc(value)}</textarea>`
   : `<input id="${id}" data-story-field="${esc(field.id)}" value="${esc(value)}" maxlength="${field.max??64}" autocomplete="off"/>`;
 return `<label class="md-field md-journey-field" for="${id}"><span>${esc(field.label)}</span>${control}</label>`;
}
export function journeyView(kind,definition,state,data,ui) {
 const frame=definition.screens[state.step];
 const {space,files,project}=currentContext(data);
 const entity=entityFor(kind,state.entity,data,ui.lab.topics);
 const fields=storyboardFields(definition,state,ui.lab.topics);
 const confirm=frame.confirm;
 const nextDisabled=confirm&&state.fields[`confirm:${state.step}`]!==true;
 const history=state.visited.filter(id=>id===state.step||!definition.screens[id].tone||definition.screens[id].tone==='success');
 const completedFields=Object.entries(state.fields).filter(([key])=>!key.startsWith('confirm:')&&key!=='streamLength');
 const pending=ui.windows;
 const unavailableEntity=['space','profile','store','device','settings'].includes(kind)&&!entity;
 const progress=kind==='setup'?setupProgress(state):null;
 const displayTitle=kind==='settings'&&state.step==='edit'?entity?.name??frame.title:frame.title;
 const displayText=kind==='settings'&&state.step==='edit'?entity?.detail??frame.text:frame.text;
 const stepIcon=kind==='settings'?entity?.icon??definition.icon:kind==='setup'?({network:'wifi','network-connecting':'wifi','network-error':'wifi',security:'shield',account:'profiles','sign-in':'profiles','sign-up':'profiles',privacy:'shield',region:'globe',name:'desktop'}[state.step]??definition.icon):definition.icon;
 const planned=kind==='profile'&&entity?.id==='law';
 if(unavailableEntity||planned)return `<div class="md-journey-unavailable">${glyph('shield','amber',32)}<h3>${planned?'Legal BR é uma proposta.':'O item não está disponível neste contexto.'}</h3><p>${planned?'O catálogo pode explicar a direção de produto, mas este perfil não possui disponibilidade comprovada. Não oferecemos instalação ou ativação.':'Selecione explicitamente uma referência disponível. Não usamos o primeiro item como substituto.'}</p>${button('Voltar','journey-close','arrow')}${planned?rows([{label:'Maturidade',value:'Conceitual · não disponível'},{label:'Direção',value:'Casos, prazos e documentos; módulos ainda precisam de contrato e entrega'}]):''}</div>`;
 return `<div class="md-journey" data-story="${kind}" data-story-step="${state.step}" data-tone="${frame.tone??'neutral'}">
 <div class="md-journey-context"><span>${progress?'Configuração inicial':esc(entity?.name??definition.label)}</span>${progress?`<span class="md-step-count">Etapa ${progress.current+1} de ${progress.total}</span>`:''}</div>
 <div class="md-journey-layout">${progress?progress.markup:kind==='identity'?accountIntro():`<aside class="md-journey-trail" aria-label="Etapas percorridas"><p class="md-eyebrow">SEU PERCURSO</p><ol>${history.map(id=>`<li ${id===state.step?'aria-current="step"':''}><span>${id===state.step?icon('arrow',13):icon('check',13)}</span><p>${esc(kind==='settings'?({edit:'Configurar',pending:'Revisar',complete:'Concluído',undo:'Restaurado'}[id]??definition.screens[id].title):definition.screens[id].title)}</p></li>`).join('')}</ol></aside>`}
 <section class="md-journey-step"><div class="md-journey-step-icon md-glyph--${frame.tone==='warning'?'amber':frame.tone==='success'?'sage':'clay'}">${icon(frame.tone==='success'?'check':stepIcon,30)}</div>
 <h3 id="md-story-title" tabindex="-1" ${kind==='identity'?'role="heading" aria-level="1"':kind==='setup'?'role="heading" aria-level="2"':''}>${esc(displayTitle)}</h3><p class="md-journey-description" ${frame.tone==='warning'?'role="alert"':''} ${kind==='intelligence'&&state.step==='stream'?'data-story-stream':''}>${esc(kind==='intelligence'&&state.step==='stream'?frame.text.slice(0,state.fields.streamLength??0):displayText)}</p>
 ${frame.entity&&entity?`<div class="md-journey-entity">${glyph(entity.icon??definition.icon,entity.tone??'sage',26)}<div><strong>${esc(entity.name)}</strong><p>${esc(entity.description??entity.detail??'')}</p></div></div>`:''}
 ${frame.phase!=null?`<div class="md-journey-progress"><label for="md-story-progress">Preparando <span>${frame.phase}%</span></label><progress id="md-story-progress" value="${frame.phase}" max="100">${frame.phase}%</progress></div>`:''}
 ${frame.code?`<div class="md-journey-code"><span>CÓDIGO DE EXEMPLO</span><strong>${esc(frame.code)}</strong><small>Não é um código de pareamento válido.</small></div>`:''}
 ${frame.volumeList?`<div class="md-journey-volumes">${ui.lab.system.volumes.map(item=>`<div>${glyph(item.icon,'sage')}<span><strong>${esc(item.name)}</strong><p>${esc(item.detail)}</p><small>${esc(item.mode)}</small></span></div>`).join('')}</div>`:''}
 ${frame.sources?`<div class="md-journey-sources"><h4>Contexto revisável</h4><p>${esc(project?.name??'Sem projeto selecionado')} · ${esc(space.name)}</p>${files.length?files.map(file=>`<label><input type="checkbox" data-story-field="source:${esc(file.id)}" ${state.revokedSources?.includes(file.id)?'disabled':state.fields[`source:${file.id}`]===false?'':'checked'}/><span>${icon(file.icon,17)}${esc(file.name)}${state.revokedSources?.includes(file.id)?' · indisponível no ensaio':''}</span></label>`).join(''):'<p>Nenhuma referência de arquivo neste Space.</p>'}<small>Selecionar uma fonte não concede leitura ou saída ao provedor.</small></div>`:''}
 ${frame.fileList?`<div class="md-journey-sources"><h4>Referências deste Space</h4>${files.map(file=>`<div class="md-journey-file">${glyph(file.icon,file.tone)}<span><strong>${esc(file.name)}</strong><small>${esc(file.kind)} · ${esc(file.size)}</small></span></div>`).join('')||'<p>Nenhum arquivo neste contexto.</p>'}</div>`:''}
 ${frame.pending?`<div class="md-journey-pending"><h4>Trabalho nesta sessão</h4><p>${pending.length} janela(s), incluindo minimizadas · ${ui.pendingDraftCount??0} rascunho(s) em memória.</p><p>Salve os rascunhos antes de encerrar a sessão.</p></div>`:''}
 ${frame.network?`<div class="md-network-picker"><p class="md-field-label">REDES DISPONÍVEIS</p><button type="button" class="md-network-option" data-action="story-move:network-connecting" aria-label="Conectar à rede Estúdio"><span class="md-network-signal">${icon('wifi',25)}</span><span><strong>Estúdio</strong><small>Rede protegida · sinal forte</small></span><span class="md-network-connect">Conectar ${icon('chevron',17)}</span></button><p class="md-network-help">${icon('shield',16)} Conecte-se a uma rede em que você confia.</p></div>`:''}
 ${frame.rows?rows(frame.rows):''}
 ${fields.length?`<div class="md-journey-fields">${fields.map(field=>fieldMarkup(field,state)).join('')}</div>`:''}
 ${frame.summary&&completedFields.length?rows(completedFields.map(([key,value])=>{const spec=(definition.summaryFields??[]).concat(Object.values(definition.screens).flatMap(s=>s.fields??[])).concat(ui.lab.topics.flatMap(t=>t.fields??[])).find(f=>f.id===key);return {label:spec?.label??key,value:spec?.options?.find(o=>o.value===value)?.label??String(value)};})):''}
 ${frame.note?`<p class="md-hint">${esc(frame.note)}</p>`:''}
 ${frame.receipt?`<div class="md-journey-receipt" role="status">${icon('check',22)}<div><strong>Resultado</strong><p>${esc(frame.receipt)}</p></div></div>`:''}
 ${confirm?`<label class="md-journey-consent"><input type="checkbox" data-story-field="confirm:${state.step}" ${!nextDisabled?'checked':''}/><span>${esc(confirm)}</span></label>`:''}
 <div class="md-journey-actions">${state.trail.length?button('Voltar','story-back','arrow'):''}
 ${frame.next?`<button type="button" class="md-button md-button--${frame.primaryAction?'quiet':'solid'}" data-action="story-next" ${nextDisabled?'disabled':''}>${esc(frame.nextLabel??'Continuar')} ${icon('arrow',18)}</button>`:''}
 ${frame.finish?button(frame.finish,'story-finish','check','solid'):''}
 ${(frame.network?[]:frame.actions??[]).map(item=>button(item.label,`story-move:${item.target}`,'',frame.primaryAction===item.target?'solid':'quiet')).join('')}</div>
 ${frame.links?.length?`<div class="md-journey-links">${frame.links.map(link=>button(link.label,link.action,'arrow')).join('')}</div>`:''}
 ${frame.conditions?.length?`<details class="md-journey-conditions"><summary>Ajuda para continuar</summary><p>Encontre uma alternativa para continuar.</p><div>${frame.conditions.map(item=>button(item.label,`story-move:${item.target}`,'sliders')).join('')}</div></details>`:''}
 </section></div></div>`;
}
export function journeyFrame(title,body,fullscreen=false,kind='') {
 if(!fullscreen)return `<dialog class="md-dialog md-dialog--journey ${kind==='settings'?'md-dialog--settings':''}" aria-labelledby="md-panel-title"><header class="md-panel-header"><div><p class="md-eyebrow">ORDAX</p><h2 id="md-panel-title">${esc(title)}</h2></div>${button('Fechar','journey-close','close')}</header><div class="md-panel-body">${body}</div><div class="md-panel-feedback" role="status" aria-live="polite"></div></dialog>`;
 return `<main class="md-stage" data-flow="${esc(kind)}" tabindex="-1" id="meridian-main"><header class="md-stage-header"><span class="md-stage-brand"><img src="/system/surface/ui/brand/ordax-symbol.png" alt="" width="30" height="30"/>OrdaX</span>${button(kind==='identity'?'Voltar':'Configurar depois','journey-close','close')}</header><div class="md-stage-body"><p class="md-eyebrow">${kind==='identity'?'SEU MUNDO, POR PERTO':'UM ESPAÇO DO SEU JEITO'}</p><h1>${esc(title)}</h1>${body}</div></main>`;
}
export function lockScreen(ui) {
 return `<main class="md-stage md-lock-stage" tabindex="-1" id="meridian-main"><div class="md-lock-card"><p class="md-lock-brand">OrdaX</p><span class="md-lock-symbol">${icon('profiles',48)}</span><p class="md-eyebrow">SESSÃO LOCAL</p><h1>Bom ter você de volta.</h1><p>Retome suas ferramentas e continue de onde parou.</p>${ui.lockError?notice('Não foi possível confirmar o acesso. Tente novamente para continuar.','warning'):''}<div class="md-lock-actions">${button('Desbloquear','lab-unlock','arrow','solid')}${button('Não consigo acessar','lab-lock-error','shield')}</div></div></main>`;
}
