import {button,iconButton,glyph,icon,esc,tag} from '../../meridian/primitives.mjs';


const favoriteKey=(data,id)=>JSON.stringify([data.presentationSubject??'lia',id]);
export function isSpaceFavorite(data,ui,space){return ui.spaceFavorites?.[favoriteKey(data,space.id)]??space.dashboard?.favorite??false;}
export function filterSpaces(data,ui){
 const normalize=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const query=normalize(ui.spacesQuery??'').trim();
 return data.spaces.filter(space=>(!query||normalize([space.name,space.description,space.profile,space.dashboard?.location??''].join(' ')).includes(query))&&(!ui.spacesCategory||ui.spacesCategory==='Todos'||(ui.spacesCategory==='Favoritos'?isSpaceFavorite(data,ui,space):space.dashboard?.group===ui.spacesCategory))).sort((a,b)=>ui.spacesSort==='name'?a.name.localeCompare(b.name,'pt-BR'):(a.dashboard?.recent??100)-(b.dashboard?.recent??100));
}
// Each space supplies its own indicators; tuples remain compatible with older fixtures.
const spaceMetrics=space=>(space.dashboard?.metrics??[['Pessoas',space.members,'Neste espaço']]).map(item=>Array.isArray(item)?{label:item[0],value:item[1],detail:item[2]}:item).filter(item=>item&&item.label);
function metrics(space,compact=false){
 const items=spaceMetrics(space);
 if(!items.length)return '';
 return `<dl class="md-spaces-metrics ${compact?'is-compact':''}" aria-label="Indicadores de ${esc(space.name)}">${items.map(item=>{
  const hasValue=item.value!==null&&item.value!==undefined&&item.value!=='';
  const progress=typeof item.progress==='number'&&Number.isFinite(item.progress)?Math.max(0,Math.min(100,item.progress)):null;
  const tone=['positive','attention','neutral'].includes(item.tone)?item.tone:'neutral';
  return `<div class="md-spaces-metric is-${tone}"><dt>${item.icon?icon(item.icon,15):''}${esc(item.label)}</dt><dd class="${hasValue?'':'is-unavailable'}">${hasValue?esc(item.value):'—'}</dd>${progress!==null?`<meter min="0" max="100" value="${progress}" aria-label="${esc(item.label)}">${progress}%</meter>`:''}${item.detail?`<small>${esc(item.detail)}</small>`:''}</div>`;
 }).join('')}</dl>`;
}
function activeSpaceHero(space){
 const location=space.dashboard?.location;
 return `<section class="md-spaces-hero ${space.cover?'has-cover':''} md-art--${esc(space.tone)}" aria-labelledby="md-active-space-name">
 <div class="md-spaces-hero-identity">${space.cover?`<img class="md-spaces-hero-cover" src="${esc(space.cover)}" alt=""/>`:''}<div class="md-spaces-hero-art" aria-hidden="true">${icon(space.icon,100)}</div>
 <div class="md-spaces-hero-top"><span class="md-spaces-active-label"><i aria-hidden="true"></i>ESPAÇO EM USO</span><div>${button('Abrir espaço',`select-space:${space.id}`,'arrow','light')}${iconButton(`Opções de ${space.name}`,`space:${space.id}`,'settings')}</div></div>
 <div class="md-spaces-hero-name">${glyph(space.icon,space.tone,36)}<div class="md-spaces-hero-copy"><div class="md-spaces-hero-title"><h2 id="md-active-space-name">${esc(space.name)}</h2>${tag(space.dashboard?.group??space.profile,space.tone)}</div>${space.description?`<p>${esc(space.description)}</p>`:''}<div class="md-spaces-hero-meta">${location?`<span>${icon('globe',13)}${esc(location)}</span>`:''}${space.members?`<span>${icon('profiles',14)}${esc(space.members)}</span>`:''}</div></div></div></div>
 ${metrics(space)}${space.dashboard?.attention?`<div class="md-spaces-hero-attention">${icon('bell',16)}<span><strong>${esc(space.dashboard.attention.title)}</strong><small>${esc(space.dashboard.attention.detail)}</small></span>${button('Ver detalhes',`space:${space.id}`,'arrow','quiet')}</div>`:''}</section>`;
}
function favoriteButton(data,ui,space){const active=isSpaceFavorite(data,ui,space);return `<button type="button" class="md-spaces-favorite ${active?'is-favorite':''}" data-action="spaces-favorite:${esc(space.id)}" aria-label="${active?'Remover':'Adicionar'} ${esc(space.name)} ${active?'dos':'aos'} favoritos" aria-pressed="${active}">${icon('star',18)}</button>`;}
function spaceCard(space,data,ui,compact=false){return `<article class="md-spaces-card ${compact?'is-small':''} md-art--${esc(space.tone)}">${compact?glyph(space.icon,space.tone,25):`<div class="md-spaces-cover" aria-hidden="true"><span>${icon(space.icon,48)}</span><i></i><b>${esc(space.name.split(' ')[0])}</b></div>`}${favoriteButton(data,ui,space)}<div class="md-spaces-card-body"><div class="md-spaces-card-title"><h3>${esc(space.name)}</h3>${tag(space.dashboard?.group??space.profile,space.tone)}</div><p>${esc(space.description)}</p>${!compact&&space.dashboard?.location?`<small class="md-spaces-location">${icon('globe',13)} ${esc(space.dashboard.location)}</small>`:''}${compact?`<small class="md-spaces-small-metric">${esc(spaceMetrics(space)[0]?.value??space.members)} · ${esc(spaceMetrics(space)[0]?.label??'Pessoas')}</small>`:metrics(space,true)}<footer>${button('Abrir espaço',`select-space:${space.id}`,'arrow',compact?'quiet':'solid')}${iconButton(`Opções de ${space.name}`,`space:${space.id}`,'settings')}</footer></div></article>`;}
function dashboard(data,ui){
 const active=data.spaces.find(space=>space.id===data.activeSpace);
 const visible=filterSpaces(data,ui),primary=visible.filter(space=>space.dashboard?.primary),others=visible.filter(space=>!space.dashboard?.primary);
 const alerts=data.spaces.filter(space=>space.dashboard?.attention),activity=(data.spaceActivity??[]).filter(item=>data.spaces.some(space=>space.id===item.space));
 return `<div class="md-spaces-dashboard"><div class="md-spaces-center"><header class="md-spaces-page-header"><div><p class="md-eyebrow">SEUS AMBIENTES, CONECTADOS</p><h1>Espaços</h1><p>Seu trabalho, seus produtos e seus projetos em um lugar.</p></div>${button('Criar novo espaço','panel:new-space','plus','solid')}</header>
 ${active?activeSpaceHero(active):''}
 <section aria-labelledby="md-spaces-list-title"><div class="md-spaces-list-heading"><h2 id="md-spaces-list-title">Seus espaços <span>${visible.length}</span></h2><div class="md-spaces-controls"><div class="md-spaces-filters" role="group" aria-label="Filtrar espaços">${['Todos','Operação','Desenvolvimento','Favoritos'].map(value=>`<button type="button" data-action="spaces-filter:${value}" aria-pressed="${(ui.spacesCategory??'Todos')===value}">${value}</button>`).join('')}</div><button type="button" class="md-button" data-action="spaces-sort" aria-label="Ordenar espaços: ${ui.spacesSort==='name'?'nome':'recentes'}">${icon('refresh',14)} ${ui.spacesSort==='name'?'Nome A–Z':'Recentes'}</button></div></div>
 <p class="md-spaces-result ${ui.spacesQuery?'has-query':''}" role="status">${visible.length} ${visible.length===1?'espaço encontrado':'espaços encontrados'}${ui.spacesQuery?` para “${esc(ui.spacesQuery)}”`:''}</p>
 ${primary.length?`<div class="md-spaces-cards">${primary.map(space=>spaceCard(space,data,ui)).join('')}</div>`:''}
 ${others.length?`<h3 class="md-spaces-others-title">${primary.length?'Outros espaços':'Seus ambientes'} <span>${others.length}</span></h3><div class="md-spaces-others">${others.map(space=>spaceCard(space,data,ui,true)).join('')}</div>`:''}
 ${!visible.length?`<div class="md-spaces-empty">${glyph('search','sage',30)}<h3>Nenhum espaço por aqui.</h3><p>Tente outro nome ou revise os filtros.</p>${button('Limpar busca e filtros','spaces-clear','refresh')}</div>`:''}
 </section><section class="md-spaces-privacy">${icon('shield',20)}<div><strong>Seu contexto tem limites claros.</strong><p>Pessoas, ferramentas e permissões próprias em cada espaço.</p></div>${button('Ver privacidade','panel:memory','arrow')}</section>
 </div><aside class="md-spaces-insights" aria-label="Contexto dos espaços">
 <section class="md-spaces-insight"><header><h2>${icon('aura',23)} Intelligence</h2>${tag(data.networkOnline?'Disponível':'Local','sage')}</header><p>${alerts.length?`${alerts.length} espaços precisam da sua atenção.`:'Tudo tranquilo nos seus espaços.'}</p><div class="md-spaces-alerts">${alerts.map(space=>`<button type="button" data-action="space:${space.id}">${glyph(space.icon,space.tone,19)}<span><strong>${esc(space.name)}</strong><small>${esc(space.dashboard.attention.detail)}</small><time>${esc(space.dashboard.attention.time)}</time></span></button>`).join('')}</div>${button('Ver análise completa','route:intelligence','arrow')}</section>
 <section class="md-spaces-insight"><header><h2>Atividade recente</h2>${button('Ver todas','route:activity','arrow')}</header>${activity.map(item=>{const space=data.spaces.find(space=>space.id===item.space);return `<button class="md-spaces-event" type="button" data-action="space:${space.id}">${glyph(item.icon,space.tone,18)}<span><strong>${esc(item.title)}</strong><small>${esc(space.name)}</small><time>${esc(item.time)}</time></span></button>`;}).join('')||'<p>As próximas novidades aparecerão aqui.</p>'}</section>
 <section class="md-spaces-insight"><header><h2>Modelos de espaços</h2>${button('Ver todos','route:store','arrow')}</header><div class="md-spaces-templates">${(data.spaceTemplates??[]).map(item=>`<button type="button" data-action="spaces-template:${esc(item.id)}" aria-label="Criar espaço a partir de ${esc(item.name)}">${glyph(item.icon,item.tone,24)}<span>${esc(item.name)}</span></button>`).join('')}</div></section>
 </aside></div>`;
}
export function spacesView(data,ui){
 return `<div class="md-spaces-body"><label class="md-spaces-search" for="md-spaces-search">${icon('search',18)}<input id="md-spaces-search" type="search" data-spaces-search value="${esc(ui.spacesQuery??'')}" placeholder="Buscar espaços por nome, perfil ou local" aria-label="Buscar espaços"/></label>${dashboard(data,ui)}</div>`;
}
