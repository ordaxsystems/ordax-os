import { items, sections, copy, kindMeta, operationSteps } from './preview-data.js';
import { advanceQueue, cancelRequest } from './session.js';
import { icon as meridianIcon } from './icons.mjs';
import { initialStore, storeReducer, statusOf, activeOps } from '../../../surface/workspace/lib/store/state.ts';
import { searchCatalog, evaluateModel, platformLabel } from '../../../surface/workspace/lib/store/catalog.ts';
import { listFirstRunDefaultAppIds } from '../../../services/apps/first-run-selection.mjs';
import logo from '../../../surface/ui/brand/ordax-symbol.png';

// Isolated presentation; never calls a platform, catalog or installation endpoint.
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extra={heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',alert:'<path d="m12 3 10 18H2Z M12 9v5m0 3v.1"/>',cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>'};
const icon=(n,s=20)=>extra[n]?`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra[n]}</svg>`:meridianIcon(n,s);
const find=id=>items.find(i=>i.id===id);
const essential=new Set(listFirstRunDefaultAppIds());
let state=structuredClone(initialStore);
const ui={route:'discover',query:'',type:'all',sort:'catalog',category:'all',platform:'all',tab:'models',libraryTab:'resources',detailTab:'overview',returnTo:'discover',collection:null,modelTask:'all',updatesTab:'available',returnContext:null,pendingReturn:null,scene:'ready',removed:new Set(),steps:new Map()};
let dialogAction=null,dialogCancel=null,toastTimer=null;
const status=i=>statusOf(state,i);
const labels={available:'Disponível',installed:'Instalado','update-available':'Atualização disponível',informational:'Informativo',disconnected:'Não conectado','authorization-required':'Autorização pendente',connected:'Conectado',disabled:'Não habilitado',enabled:'Habilitado',unavailable:'Indisponível'};
const tone=s=>['installed','connected','enabled'].includes(s)?'sage':s==='update-available'?'clay':s==='authorization-required'?'amber':'';
const glyph=(i,big=false)=>`<span class="glyph ${esc(i.preview.tone)} ${big?'large':''}">${icon(i.preview.icon,big?36:25)}</span>`;
const tag=(text,t='')=>`<span class="tag ${t}">${esc(text)}</span>`;
const btn=(label,act,id='',style='',g='',disabled=false)=>`<button type="button" class="button ${style}" data-action="${act}" data-id="${esc(id)}" ${disabled?'disabled':''}>${g?icon(g,15):''}${esc(label)}</button>`;
const head=(eyebrow,title,description,action='')=>`<header class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p class="lead">${esc(description)}</p></div>${action}</header>`;
const subhead=(title,note='',act='')=>`<div class="section-heading"><div><h2>${esc(title)}</h2>${note?`<p>${esc(note)}</p>`:''}</div>${act}</div>`;
const list=v=>v?.length?`<ul class="bullet-list">${v.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:'<p class="body-copy">Não informado neste exemplo.</p>';
const facts=rows=>`<dl class="facts">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v??'Não informado')}</dd></div>`).join('')}</dl>`;
const info=(t,g='shield')=>`<div class="info-line">${icon(g,18)}<span>${esc(t)}</span></div>`;
const empty=(t,d,act='')=>`<section class="empty">${icon('store',32)}<h2>${esc(t)}</h2><p>${esc(d)}</p>${act}</section>`;
const installed=()=>items.filter(i=>['app','plugin'].includes(i.kind)&&['installed','update-available'].includes(status(i)));
const updates=()=>items.filter(i=>status(i)==='update-available');
const busy=i=>activeOps(state).some(o=>o.itemId===i.id);
const itemStatus=i=>i.kind==='package'&&status(i)==='installed'?(i.packageType==='Idioma'?'Reinício pendente':i.packageType==='Template'?'Pronto para novos projetos':'Aplicado'):labels[status(i)];
const currentVersion=i=>['installed','update-available'].includes(status(i))?(status(i)==='update-available'?i.preview.installedVersion:i.preview.version)??('version'in i?i.version:null):null;
const unavailable=()=>ui.scene!=='ready';
function action(i){
 const s=status(i);
 if(busy(i))return btn('Na fila','noop',i.id,'quiet','clock',true);
 if(i.kind==='model')return ui.route==='detail'&&ui.itemId===i.id?btn('Instalação pendente','noop',i.id,'quiet','cpu',true):btn('Ver requisitos','open',i.id,'quiet');
 if(s==='authorization-required')return btn('Revisar acesso','connect',i.id,'quiet');
 if(s==='update-available')return btn('Atualizar','update',i.id,'','refresh',unavailable());
 if(s==='installed'&&i.kind==='app')return btn('Abrir','launch',i.id,'quiet');
 if(['provider','connector'].includes(i.kind))return s==='connected'?btn('Gerenciar','open',i.id,'quiet'):btn('Conectar','connect',i.id,'quiet','link',unavailable());
 if(i.kind==='agent')return btn(s==='enabled'?'Desabilitar':'Habilitar',s==='enabled'?'disable':'enable',i.id,'quiet','',unavailable());
 if(i.kind==='package')return s==='installed'?btn(itemStatus(i),'noop',i.id,'quiet','check',true):btn('Aplicar','apply',i.id,'quiet','',unavailable());
 if(s==='installed')return btn('Ver detalhes','open',i.id,'quiet');
 return btn(ui.removed.has(i.id)?'Reinstalar':'Instalar','install',i.id,'','download',unavailable());
}
function card(i){return `<article class="product-card"><button class="product-open" data-action="open" data-id="${esc(i.id)}" aria-label="Ver detalhes de ${esc(i.name)}">${glyph(i)}<span><small>${esc(kindMeta[i.kind].label)}</small><h3>${esc(i.name)}</h3></span></button><p>${esc(i.tagline)}</p><footer>${tag(itemStatus(i),tone(status(i)))}${action(i)}</footer></article>`;}
const grid=v=>v.length?`<div class="app-grid">${v.map(card).join('')}</div>`:empty('Nada encontrado por aqui.','Tente outra categoria ou use um termo diferente na busca.',btn('Limpar filtros','clear','','quiet'));
function row(i){return `<li class="resource-row">${glyph(i)}<button class="resource-name" data-action="open" data-id="${esc(i.id)}"><strong>${esc(i.name)}</strong><small>${esc(kindMeta[i.kind].label)} · ${esc(itemStatus(i))}${currentVersion(i)?` · ${esc(currentVersion(i))}`:''}</small></button>${action(i)}</li>`;}
function renderNav(){
 $('navigation').innerHTML=[['explore','Explorar'],['catalog','Catálogo'],['manage','Seus recursos']].map(([id,label])=>`<div class="nav-group"><p class="nav-label">${label}</p>${sections.filter(s=>s.group===id).map(s=>`<a class="nav-item" href="#${s.id}" ${ui.route===s.id&&!ui.query&&ui.type==='all'?'aria-current="page"':''}>${icon(s.id==='updates'?'refresh':s.icon,18)}<span>${s.label}</span>${s.id==='updates'&&updates().length?`<span class="count">${updates().length}</span>`:''}</a>`).join('')}</div>`).join('');
}
function discover(){
 const recent=items.filter(i=>i.preview.date&&i.preview.changes).sort((a,b)=>b.preview.date.localeCompare(a.preview.date)).slice(0,3);
 return `${head(...copy.discover)}<div class="feature-layout"><section class="feature"><div class="feature-copy"><p class="eyebrow">SELEÇÃO ORDAX</p><h2>Sua próxima ideia<br>merece um bom começo.</h2><p>Ferramentas que dão forma ao seu trabalho, do primeiro esboço ao próximo projeto.</p>${btn('Explorar OrdaX Studio','open','studio','light','arrow')}</div><div class="feature-art" aria-hidden="true"><i></i><i></i><i></i></div></section><section class="feature-side"><div><p class="eyebrow">INTELIGÊNCIA LOCAL</p><h2>Mais perto de você.<br>Mais possibilidades.</h2><p>Conheça modelos, formatos e requisitos para o seu OrdaX.</p></div><a class="text-link" href="#models">Explorar modelos ${icon('arrow',16)}</a><span class="orbital" aria-hidden="true"></span></section></div>
 <nav class="category-strip" aria-label="Categorias">${[['apps','Aplicativos','apps'],['models','Modelos de IA','aura'],['connectors','Conectores','link'],['extensions','Extensões','cube'],['packages','Personalização','sun']].map(([id,label,g])=>`<a href="#${id}">${icon(g,20)}<span>${label}</span></a>`).join('')}</nav>
 <section>${subhead('Feitos para o seu dia','Uma seleção de aplicativos OrdaX.',`<a class="text-link" href="#essentials">Ver essenciais ${icon('arrow',15)}</a>`)}${grid(['files','notes','studio'].map(find))}</section>
 <section class="section">${subhead('Encontre seu próximo caminho','Coleções editoriais desta prévia.')}<div class="collection-grid"><a class="collection" href="#collection=daily"><div><p class="eyebrow">PARA O DIA A DIA</p><h3>Menos distração.<br>Mais espaço para fazer.</h3><p>Organize arquivos, ideias e pequenas tarefas.</p></div>${icon('file',38)}</a><a class="collection" href="#collection=create"><div><p class="eyebrow">PARA CRIAR</p><h3>Da ideia ao<br>próximo projeto.</h3><p>Ferramentas para começar, conectar e construir.</p></div>${icon('cube',40)}</a></div></section>
 <section class="section">${subhead('Novos na seleção','Novidades demonstrativas, sem ranking ou rastreamento.')}${grid(items.filter(i=>i.preview.newItem||['startup-tpl','pt-pt'].includes(i.id)))}</section>
 <section class="section">${subhead('Recentemente atualizados','Veja as mudanças antes de escolher.',`<a class="text-link" href="#updates">Ver atualizações ${icon('arrow',15)}</a>`)}<ul class="resource-list">${recent.map(row).join('')}</ul></section>
 <section class="trust-strip">${icon('shield',28)}<div><strong>Uma escolha informada começa pela origem.</strong><p>Versões, requisitos e permissões ficam na ficha de cada recurso. Você escolhe o que entra no seu OrdaX.</p></div></section>`;
}
function tabs(v,s,act){return `<div class="filter-tabs" role="group" aria-label="Filtrar seção">${v.map(([id,l])=>`<button data-action="${act}" data-id="${id}" aria-pressed="${s===id}">${esc(l)}</button>`).join('')}</div>`;}
const sortSelect=()=>`<select id="sort" aria-label="Ordenar catálogo">${[['catalog','Ordem do catálogo'],['name','Nome: A–Z'],['date','Mais recentes']].map(([v,t])=>`<option value="${v}" ${ui.sort===v?'selected':''}>${t}</option>`).join('')}</select>`;
const sorted=v=>ui.sort==='name'?[...v].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')):ui.sort==='date'?[...v].sort((a,b)=>(b.preview.date??'').localeCompare(a.preview.date??'')):v;
function catalogPage(route){
 let values=[],controls='',note='';
 if(route==='apps'){
  values=items.filter(i=>i.kind==='app'&&i.official);const categories=[...new Set(values.map(i=>i.category))];
  controls=`${tabs([['all','Todos'],['web','Web'],['os','OrdaX OS']],ui.platform,'platform')}<div class="filter-selects"><select id="category" aria-label="Categoria"><option value="all">Todas as categorias</option>${categories.map(c=>`<option ${ui.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select>${sortSelect()}</div>`;
  values=values.filter(i=>(ui.platform==='all'||i.platforms.includes(ui.platform))&&(ui.category==='all'||i.category===ui.category));
 }else if(route==='essentials'){
  values=items.filter(i=>i.kind==='app'&&essential.has(i.id));note=info('Seleção inicial existente do OrdaX, limitada aos exemplos presentes no catálogo.');
 }else if(route==='models'){
  controls=tabs([['models','Modelos locais'],['providers','Provedores'],['agents','Agentes'],['compare','Comparar modelos']],ui.tab,'ai-tab');
  if(ui.tab==='compare')return `${head(...copy.models)}<div class="filters">${controls}</div>${compare()}`;
  values=items.filter(i=>i.kind===({models:'model',providers:'provider',agents:'agent'}[ui.tab]));
  if(ui.tab==='models'){
    const tasks=[...new Set(values.flatMap(i=>i.tasks))];
    controls+=`<div class="filter-selects"><select id="model-task" aria-label="Filtrar modelos por tarefa"><option value="all">Todas as tarefas</option>${tasks.map(t=>`<option value="${esc(t)}" ${ui.modelTask===t?'selected':''}>${esc(t)}</option>`).join('')}</select>${sortSelect()}</div>`;
    values=values.filter(i=>ui.modelTask==='all'||i.tasks.includes(ui.modelTask));
  }
  note=info(ui.tab==='models'?'Instalação independente de modelos aguardando lifecycle assinado, hardware homologado e rollback. Conheça e compare os requisitos.':ui.tab==='providers'?'Provedores usam autorização própria. Nenhuma conta ou chave é conectada nesta prévia.':'Habilitar um agente não concede acesso. Ferramentas e permissões exigem revisão.',ui.tab==='models'?'cpu':'shield');
 }else if(route==='connectors'){values=items.filter(i=>i.kind==='connector');note=info('Conectar é autorizar um serviço. Um conector não é um aplicativo instalado.');}
 else if(route==='extensions'){values=items.filter(i=>i.kind==='plugin');note=info('Conceitos demonstrativos. Código externo depende de assinatura, sandbox, revogação e política de confiança.');}
 else if(route==='packages'){values=items.filter(i=>i.kind==='package');controls=tabs([['all','Todos'],['Tema','Temas'],['Idioma','Idiomas'],['Template','Templates']],ui.category,'package-type');values=values.filter(i=>ui.category==='all'||i.packageType===ui.category);}
 return `${head(...copy[route])}<div class="filters">${controls||sortSelect()}</div>${note}<p class="result-count">${values.length} recursos nesta seleção</p>${grid(sorted(values))}`;
}
function collectionPage(){return `${head('COLEÇÃO ORDAX',ui.collection==='daily'?'Um dia com mais espaço.':'Sua próxima ideia começa aqui.','Seleção editorial demonstrativa, organizada por intenção explícita.')}<button class="detail-back" data-action="back">${icon('arrow',15)}Voltar à descoberta</button>${grid(items.filter(i=>i.preview.collection===ui.collection))}`;}
function searchPage(){const result=sorted(searchCatalog(ui.query,ui.type,items));return `${head('BUSCAR NA LOJA',ui.query?`Resultados para “${ui.query}”`:'Explore por tipo.','Nome, descrição, desenvolvedor, tags e capacidades.')}<div class="filters"><div class="filter-selects"><select id="type" aria-label="Filtrar tipo"><option value="all">Todos os tipos</option>${Object.entries(kindMeta).map(([k,v])=>`<option value="${k}" ${ui.type===k?'selected':''}>${esc(v.plural)}</option>`).join('')}</select>${sortSelect()}</div><button class="text-link" data-action="clear">Limpar busca ${icon('close',14)}</button></div><p class="result-count">${result.length} resultados</p>${grid(result)}`;}
function library(){
 const filters=tabs([['resources','Meus recursos'],['favorites','Favoritos'],['recent','Recentes'],['removed','Removidos']],ui.libraryTab,'library-tab');
 const values=ui.libraryTab==='favorites'?state.favorites.map(find).filter(Boolean):ui.libraryTab==='recent'?state.history.map(find).filter(Boolean):ui.libraryTab==='removed'?[...ui.removed].map(find).filter(Boolean):items.filter(i=>['installed','update-available','connected','enabled'].includes(status(i)));
 return `${head(...copy.library)}<div class="filters">${filters}</div>${ui.libraryTab==='removed'?info('Remoção preserva os dados. Reinstalar é uma escolha explícita. Os exemplos duram somente nesta sessão.'):''}${values.length?`<ul class="resource-list">${values.map(row).join('')}</ul>`:empty(ui.libraryTab==='favorites'?'Suas próximas descobertas ficam aqui.':'Um lugar para retomar.','Explore o catálogo e guarde o que fizer sentido para você.',`<a class="button quiet" href="#discover">Explorar a Loja ${icon('arrow',15)}</a>`)}`;
}
function installedPage(){const values=installed();return `${head(...copy.installed)}<p class="result-count">${values.length} recursos instalados na demonstração</p>${values.length?`<ul class="resource-list">${values.map(row).join('')}</ul>`:empty('Nenhum aplicativo neste exemplo.','Explore o catálogo para simular uma instalação.')}<section class="trust-strip">${icon('shield',25)}<div><strong>A base do sistema é preservada.</strong><p>Conta, Ajustes, Sistema e Loja são componentes estruturais. Não há ação de remoção desses componentes.</p></div></section>`;}
function compare(){
 const values=items.filter(i=>i.kind==='model');const rows=[['Tarefas',i=>i.tasks.join(', ')],['Motor',i=>i.engine],['Formato',i=>`${i.format} · ${i.quantization}`],['Licença',i=>i.license],['Tamanho',i=>i.artifactSize??'Não comprovado'],['RAM',i=>i.ram??'Não homologada'],['VRAM',i=>i.vram??'Não homologada'],['GPU',i=>i.gpu],['Compatibilidade',i=>evaluateModel(i,{connected:false})],['Instalação',()=> 'Lifecycle independente pendente']];
 return `${info('Sem dados de hardware verificados, nenhum modelo é declarado compatível. Requisitos e medições dependem do owner real.','cpu')}<div class="compare-wrap"><table class="compare"><thead><tr><th scope="col">Atributo</th>${values.map(i=>`<th scope="col"><button class="text-link" data-action="open" data-id="${esc(i.id)}">${esc(i.name)}</button></th>`).join('')}</tr></thead><tbody>${rows.map(([l,f])=>`<tr><th scope="row">${l}</th>${values.map(i=>`<td>${esc(f(i))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function appPreview(i){
 if(!i.preview.screenshots)return '';const layout=i.preview.screenshots;
 const body=layout==='notes'?`<h3>Uma ideia antes do café.</h3><p>O começo de um projeto cabe em poucas linhas.<br>Guarde a intenção, reúna referências e encontre o próximo passo.</p><div class="mock-line"></div><div class="mock-line short"></div><div class="mock-line"></div>`:layout==='files'?`<h3>Seu projeto, organizado.</h3><div class="mock-file-grid">${['Documentos','Referências','Mídia'].map(t=>`<div><span class="glyph sage">${icon('folder',18)}</span>${t}</div>`).join('')}</div><div class="mock-line"></div>`:`<h3>Projeto Atlas</h3><div class="mock-canvas"><i></i><i></i><i></i></div>`;
 return `<figure class="preview-figure"><div class="mock-window" role="img" aria-label="Ilustração da interface de ${esc(i.name)}"><div class="mock-bar"><i></i><i></i><i></i><span>${esc(i.name)}</span></div><div class="mock-body"><div class="mock-rail"><p class="active">${layout==='notes'?'Minhas notas':layout==='files'?'Meu espaço':'Projeto'}</p><p>Recentes</p><p>Favoritos</p><p>Compartilhados</p></div><div class="mock-content">${body}</div></div></div><figcaption>Prévia ilustrativa de layout. Não é uma captura do aplicativo publicado.</figcaption></figure>`;
}
function permissions(i){return i.permissions?.length?`<ul class="permission-list">${i.permissions.map(p=>`<li>${icon('shield',20)}<span>${esc(p)}</span></li>`).join('')}</ul>`:info('Nenhuma permissão adicional informada neste exemplo.');}
function details(i){
 const s=status(i),model=i.kind==='model',p=i.preview;
 const version=p.version??('version'in i?i.version:'Não informada');
 const current=['installed','update-available'].includes(s)?(s==='installed'?p.version:p.installedVersion)??'Não informada':'Não instalado';
 let body='';
 if(ui.detailTab==='overview'){
  body=`${appPreview(i)}<h2>Sobre este recurso</h2><p class="body-copy">${esc(i.description)}</p>${i.tags.length?`<div class="filter-tabs" style="margin-top:18px">${i.tags.map(t=>tag(t)).join('')}</div>`:''}`;
  if(model)body+=`<div class="compatibility">${icon('cpu',24)}<div><strong>Compatibilidade ainda não avaliada</strong><p>Não há hardware ou volume autorizado nesta prévia. RAM, GPU, espaço livre e health check dependem de evidência real.</p></div></div><h2>Ficha do modelo</h2>${facts([['Família',i.family],['Variante',i.variant],['Identificador',i.modelId],['Motor',i.engine],['Formato',i.format],['Quantização',i.quantization],['RAM',i.ram??'Não homologada'],['VRAM',i.vram??'Não homologada'],['GPU',i.gpu],['Artefato',i.artifactSize??'Tamanho não comprovado'],['Licença',i.license],['Idiomas',i.languages.join(', ')]])}${info('Instalação independente bloqueada até pacote assinado, hardware/volume verificados, ativação, health check, rollback e prova física.','alert')}`;
  if(i.kind==='app')body+=`<h2>Requisitos e plataformas</h2>${list(i.requirements)}<p class="body-copy" style="margin-top:12px">${esc(platformLabel(i.platforms))}</p>`;
  if(i.kind==='connector'||i.kind==='plugin')body+=`<h2>Recursos oferecidos</h2>${list(i.provides)}${i.kind==='plugin'?`<h2>Aplicativos compatíveis</h2>${list(i.compatibleApps)}${info('A prévia não carrega código arbitrário nem concede capabilities.')}`:''}`;
  if(i.kind==='provider')body+=`<h2>Capacidades</h2>${list(i.capabilities)}<h2>Formas de acesso</h2>${list(i.access.map(a=>a==='assinatura'?'Conta e assinatura no provedor':'Credencial de API no provedor'))}${info('Execução na nuvem pode enviar dados ao provedor. Nenhuma credencial é solicitada nesta prévia.')}`;
  if(i.kind==='agent')body+=`<h2>Tarefas e ferramentas</h2>${list([...i.tasks,...i.tools])}<h2>Dependências</h2>${list(i.dependencies.map(d=>d==='projects-svc'?'Serviço de Projetos · não conectado':d))}`;
  if(i.kind==='package')body+=`<h2>Como é aplicado</h2><p class="body-copy">${esc(i.activation)}</p>${info('Conteúdo declarativo usa seu próprio owner. Não é tratado como executável de terceiros.')}`;
 }else if(ui.detailTab==='permissions'){
  body=`<h2>O acesso começa pela sua escolha.</h2><p class="body-copy" style="margin-bottom:20px">Permissões previstas no exemplo. Nenhum acesso é concedido pelo botão de instalação desta prévia.</p>${permissions(i)}${p.permissionChange?`<h2>Mudanças nesta atualização</h2>${list(p.permissionChange)}${info('No sistema real, mudanças de acesso exigem consentimento pelo owner de permissões.')}`:''}`;
 }else if(ui.detailTab==='changes'){
  body=`<h2>O que muda nesta versão</h2>${p.changes?`<section class="changelog"><header><strong>${esc(p.version)}</strong><small>${esc(p.date)} · exemplo</small></header>${list(p.changes)}</section>`:info('Este exemplo não possui changelog publicado.')}<h2>Versões</h2>${facts([['Disponível',version],['Instalada',current],['Canal',p.channel??'Não informado'],['Download',p.size??'Não informado']])}`;
 }else{
  body=`<h2>Origem e informações</h2>${facts([['Desenvolvedor',i.developer],['Tipo',kindMeta[i.kind].label],['Categoria',i.category??i.packageType??kindMeta[i.kind].label],['Data da versão',p.date??'Não informada'],['Licença',i.license??p.license??'Não informada'],['Arquitetura','Não informada'],['Versão mínima do OrdaX','Não informada'],['Procedência','Exemplo de apresentação'],['Assinatura e hash','Não verificados nesta prévia'],['Canal',p.channel??'Não informado'],['Estado',labels[s]]])}<h2>Disponibilidade real</h2><p class="body-copy">A UI só pode afirmar instalação, integridade ou compatibilidade quando os owners canônicos devolverem o estado verificado. Os dados desta página são demonstrativos.</p>`;
 }
 const filters=tabs([['overview','Visão geral'],['changes','Atualizações'],['permissions','Permissões'],['info','Informações']],ui.detailTab,'detail-tab');
 const op=state.ops.find(o=>o.itemId===i.id),favorite=state.favorites.includes(i.id);
 const remove=['installed','update-available'].includes(s)&&['app','plugin'].includes(i.kind);
 return `<button class="detail-back" data-action="back">${icon('arrow',16)}Voltar ao catálogo</button><header class="detail-header">${glyph(i,true)}<div class="detail-title">${tag(kindMeta[i.kind].label,p.tone)}<h1>${esc(i.name)}</h1><p>${esc(i.tagline)}</p><span class="publisher">${icon(i.official?'shield':'profiles',14)}${esc(i.developer)}</span></div><div class="detail-header-actions">${action(i)}<button class="icon-button" data-action="favorite" data-id="${esc(i.id)}" aria-label="${favorite?'Remover dos':'Adicionar aos'} favoritos" aria-pressed="${favorite}">${icon('heart',22)}</button></div></header>
 <div class="detail-summary"><div><span>Estado</span><strong>${esc(itemStatus(i))}</strong></div><div><span>Versão</span><strong>${esc(version)}</strong></div><div><span>Tamanho</span><strong>${esc(model?i.artifactSize??'Não comprovado':p.size??'Não informado')}</strong></div><div><span>Tipo</span><strong>${esc(kindMeta[i.kind].label)}</strong></div></div>
 ${op?operationCard(op):''}<div class="detail-layout"><div class="detail-main"><div class="detail-tabs">${filters}</div>${body}</div><aside class="detail-sidebar"><h2>Sua escolha, com contexto.</h2>${facts([['Origem',i.official?'OrdaX · exemplo':'Exemplo ilustrativo'],['Estado',labels[s]],['Instalada',current],['Disponível',version],['Canal',p.channel??'Não informado']])}<p>Valores demonstrativos. A verificação real pertence ao catálogo e ao lifecycle do sistema.</p>${remove?btn('Remover aplicativo','remove',i.id,'quiet','',busy(i)):s==='connected'?btn('Desconectar serviço','disconnect',i.id,'quiet'):''}</aside></div>
 ${remove?`<div class="mobile-detail-remove">${btn('Remover aplicativo','remove',i.id,'quiet','',busy(i))}</div>`:s==='connected'?`<div class="mobile-detail-remove">${btn('Desconectar serviço','disconnect',i.id,'quiet')}</div>`:''}`;
}
function operationCard(op){
 const i=find(op.itemId),steps=operationSteps(op.op,i),step=ui.steps.get(op.id)??0,active=activeOps(state).at(-1);
 const queued=active&&active.id!==op.id&&['requested','accepted'].includes(op.state),end=['succeeded','failed','blocked'].includes(op.state);
 const label=op.state==='succeeded'?'Concluída · simulação':op.state==='failed'?'Falhou · versão mantida':op.state==='blocked'?'Bloqueada':queued?'Na fila':op.state==='requested'?'Solicitada':op.state==='accepted'?'Aceita':steps[Math.min(step,steps.length-2)];
 const percent=end?(op.state==='succeeded'?100:Math.round(step/(steps.length-1)*100)):queued?0:Math.round(step/(steps.length-1)*100);
 return `<article class="operation-card"><div class="operation-title">${icon(op.state==='succeeded'?'check':op.state==='failed'||op.state==='blocked'?'alert':'clock',18)}<strong>${esc(i?.name??op.itemId)}</strong><span>${esc(label)}</span></div><p>${esc(op.message)}</p>
 ${op.state!=='blocked'?`<ol class="stage-list" aria-label="Etapas demonstrativas da operação">${steps.map((name,n)=>`<li class="${op.state==='succeeded'||n<step?'complete':!queued&&n===step?'current':'pending'}">${icon(op.state==='succeeded'||n<step?'check':'clock',12)}<span>${esc(name)}</span>${!queued&&n===step&&!end?'<b>Agora</b>':''}</li>`).join('')}</ol>`:''}
 ${!end?`<div class="operation-steps" role="progressbar" aria-label="Progresso ilustrativo de ${esc(i?.name??op.itemId)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">${steps.map((_,n)=>`<span class="${n<step?'done':n===step?'current':''}"></span>`).join('')}</div>`:''}
 <div class="operation-footer">${!end&&op.state!=='running'?`<button class="text-link" data-action="cancel" data-id="${esc(op.id)}">Cancelar solicitação</button>`:''}${end?`<button class="text-link" data-action="dismiss" data-id="${esc(op.id)}">Dispensar</button>`:''}${op.state==='failed'?`<button class="text-link" data-action="retry" data-id="${esc(op.id)}">Tentar novamente</button>`:''}</div>
 ${end?`<details class="receipt"><summary>Ver resultado demonstrativo</summary><p>Operação: ${esc(op.op)} · ${esc(label)}</p><code>${esc(op.id)}</code><p>${op.state==='failed'?'A versão anterior permanece funcional no exemplo. Os dados foram preservados.':op.state==='succeeded'?'Resultado simulado; não é um receipt da autoridade da plataforma.':'Nenhum estado de instalação foi alterado.'}</p></details>`:''}</article>`;
}

function updatesPage(){
 const values=updates(),running=activeOps(state),finished=state.ops.filter(o=>['succeeded','failed','blocked'].includes(o.state));
 const views=tabs([['available',`Disponíveis (${values.length})`],['queue',`Em andamento (${running.length})`],['history',`Resultados (${finished.length})`]],ui.updatesTab,'updates-tab');
 let content='';
 if(ui.updatesTab==='available')content=`<section class="updates-list">${values.length?values.map(i=>`<article class="update-card"><header class="update-card-head">${glyph(i)}<button class="resource-name" data-action="open" data-id="${esc(i.id)}"><strong>${esc(i.name)}</strong><small>${esc(kindMeta[i.kind].label)}</small></button>${action(i)}</header><div class="version-change"><span>${esc(i.preview.installedVersion??'Versão atual não informada')}</span>${icon('arrow',13)}<strong>${esc(i.preview.version??'Versão disponível não informada')}</strong>${i.preview.size?tag(i.preview.size):''}</div><p>${esc(i.preview.changes?.[0]??'Consulte o changelog e os requisitos na ficha do recurso.')}</p>${i.preview.permissionChange?`<div class="update-warning">${icon('shield',14)}Revisão de acesso antes da promoção.</div>`:''}<details><summary>O que muda e quais acessos são necessários</summary>${list(i.preview.changes)}${i.preview.permissionChange?`<p style="margin-top:12px">Mudança de permissões:</p>${list(i.preview.permissionChange)}`:''}<p style="margin-top:12px">Requisitos novos: nenhum informado no exemplo.</p></details></article>`).join(''):empty('Tudo em dia neste exemplo.','Não há atualizações elegíveis na demonstração.')}</section>${running.length?`<div class="queue-summary">${icon('clock',18)}<span>${running.length} solicitações aguardando resultado.</span><button class="text-link" data-action="updates-tab" data-id="queue">Acompanhar fila ${icon('arrow',14)}</button></div>`:''}`;
 else if(ui.updatesTab==='queue')content=running.length?running.map(operationCard).join(''):empty('Nenhuma operação em andamento.','As solicitações concluídas e as falhas ficam na aba Resultados.',btn('Ver resultados','updates-tab','history','quiet'));
 else content=finished.length?finished.map(operationCard).join(''):empty('Cada resultado tem sua história.','Conclusões, falhas e bloqueios desta sessão aparecerão aqui.');
 return `${head(...copy.updates,ui.updatesTab==='available'&&values.length?btn('Atualizar tudo','update-all','','','refresh',unavailable()||values.every(busy)):'')}<div class="filters">${views}</div>${info(ui.updatesTab==='available'?'Revise versões, mudanças e permissões antes de atualizar. Aceitar uma solicitação não significa concluir.':ui.updatesTab==='queue'?'A fila é sequencial. Solicitações podem ser canceladas antes da execução. Cada tipo de recurso tem suas próprias etapas.':'Resultados demonstrativos. Falhas de verificação preservam a versão anterior; não representam rollback físico.')}${content}`;
}

function renderDock(){const ops=activeOps(state);$('queue-dock').innerHTML=ops.length?`<div class="queue-bar">${icon('clock',20)}<div><strong>${ops.length} operações na demonstração</strong><small>${ui.scene==='offline'?'Fila pausada no modo offline':find(ops.at(-1).itemId)?.name??'Solicitação em andamento'}</small></div><button class="text-link" data-action="updates-tab" data-id="queue">Ver fila ${icon('arrow',14)}</button></div>`:'';}
function render(){
 const focus=document.activeElement;const focusAction=focus?.dataset?.action;const focusId=focus?.dataset?.id;const focusDomId=focus?.id;const focusHref=focus?.getAttribute?.('href');
 renderNav();renderDock();const i=ui.route==='detail'?find(ui.itemId):null;
 const known=['library','installed','updates'].includes(ui.route)||(i&&['installed','update-available','connected','enabled'].includes(status(i)));const missing=ui.scene==='error'||ui.scene==='loading';
 $('breadcrumb').textContent=ui.query||ui.type!=='all'?'Busca':i?.name??sections.find(s=>s.id===ui.route)?.label??'Coleção';document.title=`${$('breadcrumb').textContent} · Loja OrdaX`;
 if(ui.scene==='loading'&&!known){$('view').innerHTML=`${head('CATÁLOGO','Preparando suas próximas descobertas.','Estado de carregamento demonstrativo.')}<div class="loading-heading"></div><div class="app-grid">${Array.from({length:6},()=>'<div class="skeleton"></div>').join('')}</div><div style="margin-top:24px">${btn('Exibir catálogo','recover','','quiet')}</div>`;return;}
 if(ui.scene==='error'&&!known){$('view').innerHTML=`${head('CATÁLOGO','A Loja precisa de um novo contato.','O catálogo não pôde ser consultado neste cenário demonstrativo.')}${empty('Catálogo indisponível.','Nenhuma disponibilidade ou instalação é inferida dessa falha. Retente a consulta.',btn('Tentar novamente','recover','','','refresh'))}`;return;}
 const body=ui.query||ui.type!=='all'?searchPage():ui.route==='detail'&&i?details(i):ui.route==='discover'?discover():ui.route==='library'?library():ui.route==='installed'?installedPage():ui.route==='updates'?updatesPage():ui.route==='collection'?collectionPage():catalogPage(ui.route);
 const offline=missing&&known?`<div class="offline-banner">${icon('wifi',19)}<div><strong>Catálogo ${ui.scene==='loading'?'em consulta':'indisponível'}.</strong>Esta visão conserva apenas os recursos conhecidos na sessão demonstrativa. Novas ações ficam pausadas.</div>${btn('Tentar novamente','recover','','quiet')}</div>`:ui.scene==='offline'?`<div class="offline-banner">${icon('wifi',19)}<div><strong>Você está explorando no modo offline.</strong>Este cenário conserva o estado conhecido da sessão. Novas instalações e conexões ficam pausadas.</div>${btn('Reconectar','recover','','quiet')}</div>`:'';
 $('view').innerHTML=offline+body;
 if(focus&&!focus.isConnected){
  const match=focusDomId?$(focusDomId):focusAction?$('view').querySelector(`[data-action="${CSS.escape(focusAction)}"][data-id="${CSS.escape(focusId??'')}"]`):focusHref?$('navigation').querySelector(`a[href="${CSS.escape(focusHref)}"]`):null;
  if(match&&!match.disabled)match.focus({preventScroll:true});
 }
}
function notify(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function dispatch(a){state=storeReducer(state,a);render();}
function navigate(route,id=null){
 if(route==='detail'){
  if(ui.route!=='detail'||ui.query||ui.type!=='all')ui.returnContext={route:ui.route,hash:location.hash,query:ui.query,type:ui.type,category:ui.category,platform:ui.platform,sort:ui.sort,tab:ui.tab,modelTask:ui.modelTask,libraryTab:ui.libraryTab,updatesTab:ui.updatesTab,collection:ui.collection,scroll:window.scrollY,focusItem:id};
  ui.returnTo=ui.route==='detail'?ui.returnTo:ui.route;ui.detailTab='overview';state=storeReducer(state,{type:'visit',itemId:id});
  ui.query='';ui.type='all';$('search').value='';const target=`#item=${encodeURIComponent(id)}`;if(location.hash===target)readHash();else location.hash=target;
 }else{ui.query='';ui.type='all';ui.category='all';ui.platform='all';$('search').value='';const target=`#${route}`;if(location.hash===target)readHash();else location.hash=target;}
}

function showDialog(title,text,confirmLabel,onConfirm,content='',danger=false){
 dialogAction=onConfirm;dialogCancel=null;
 $('dialog-content').innerHTML=`${icon(danger?'alert':'shield',28)}<h2 id="dialog-title">${esc(title)}</h2><p id="dialog-description">${esc(text)}</p>${content}<div class="dialog-actions">${btn('Cancelar','close-dialog','','quiet')}${btn(confirmLabel,'confirm-dialog','',danger?'danger':'')}</div>`;
 $('confirmation').setAttribute('aria-describedby','dialog-description');$('confirmation').showModal();
}
function request(i,op){
 if(!i||unavailable()){notify('Esta ação precisa do catálogo disponível na demonstração.');return;}
 dispatch({type:'request',itemId:i.id,op,id:`preview-${crypto.randomUUID()}`});notify('Solicitação simulada criada. Acompanhe em Atualizações.');
}
function connect(i){
 if(!i||unavailable())return;
 if(status(i)!=='authorization-required')state=storeReducer(state,{type:'request',itemId:i.id,op:'connect',id:`preview-${crypto.randomUUID()}`});
 render();if(status(i)!=='authorization-required'){notify('Este provedor não está disponível no exemplo.');return;}
 showDialog(`Revisar acesso a ${i.name}`,'Revisão demonstrativa. Nenhum login externo, token ou chave será solicitado.','Simular autorização',()=>dispatch({type:'authorize',itemId:i.id,approve:true}),permissions(i));
 dialogCancel=()=>dispatch({type:'authorize',itemId:i.id,approve:false});
}
function handleAction(act,id){
 const i=find(id);
 if(act==='open'){navigate('detail',id);return;}
 if(act==='back'){
  if(ui.returnContext){ui.pendingReturn=ui.returnContext;ui.returnContext=null;const target=ui.pendingReturn.hash||'#discover';if(location.hash===target)readHash();else location.hash=target;}
  else navigate(ui.returnTo==='detail'?'discover':ui.returnTo);
  return;
 }
 if(act==='clear'){ui.query='';ui.type='all';ui.category='all';ui.platform='all';$('search').value='';render();return;}
 if(act==='recover'){$('scene').value='ready';ui.scene='ready';render();return;}
 if(act==='platform'){ui.platform=id;render();return;}
 if(act==='package-type'){ui.category=id;render();return;}
 if(act==='ai-tab'){ui.tab=id;render();return;}
 if(act==='updates-tab'){ui.updatesTab=id;if(ui.route!=='updates')navigate('updates');else render();return;}
 if(act==='library-tab'){ui.libraryTab=id;render();return;}
 if(act==='detail-tab'){ui.detailTab=id;render();return;}
 if(act==='favorite'){dispatch({type:'favorite',itemId:id});notify(state.favorites.includes(id)?'Guardado nos favoritos desta sessão.':'Removido dos favoritos.');return;}
 if(act==='remove'){showDialog(`Remover ${i.name}?`,'Somente o aplicativo será removido do exemplo. Os dados do usuário serão preservados. Excluir dados seria uma ação separada, autorizada pelo owner responsável.','Simular remoção',()=>request(i,'remove'),info('Dependências: nenhum impacto informado neste exemplo. Não há componente estrutural neste pedido.'),true);return;}
 if(act==='connect'){connect(i);return;}
 if(act==='disconnect'){showDialog(`Desconectar ${i.name}?`,'A autorização do exemplo será retirada. Nenhuma sessão real do serviço será alterada.','Simular desconexão',()=>request(i,'disconnect'));return;}
 if(act==='launch'){showDialog(i.name,'Aplicativo instalado somente no cenário demonstrativo. A página não abre nem executa o aplicativo real.','Continuar explorando',()=>{},appPreview(i));return;}
 if(act==='update'&&i?.preview.permissionChange){showDialog('Esta atualização pede revisão de acesso.','Revise as mudanças antes de simular a atualização. Nenhum acesso será concedido.','Simular atualização',()=>request(i,'update'),list(i.preview.permissionChange));return;}
 if(['install','update','apply','enable','disable'].includes(act)){request(i,act);return;}
 if(act==='update-all'){const values=updates().filter(i=>!busy(i));showDialog('Atualizar os recursos elegíveis?','A fila é sequencial. Cada atualização terá resultado próprio. Falhas preservam a versão anterior. Mudanças de acesso abaixo são demonstrativas.','Simular atualização de todos',()=>values.forEach(i=>request(i,'update')),list(values.map(i=>`${i.name}${i.preview.permissionChange?' · revisar acesso: '+i.preview.permissionChange.join(', '):''}`)));return;}
 if(act==='cancel'){const next=cancelRequest(state,ui.steps,id);if(next.cancelled){state=next.state;ui.steps=next.steps;render();notify('Solicitação cancelada antes da execução simulada.');}return;}
 if(act==='dismiss'){dispatch({type:'dismiss',id});return;}
 if(act==='retry'){const op=state.ops.find(o=>o.id===id);if(op)request(find(op.itemId),op.op);return;}
 if(act==='close-dialog'){const cb=dialogCancel;$('confirmation').close();dialogAction=null;dialogCancel=null;cb?.();return;}
 if(act==='confirm-dialog'){const cb=dialogAction;dialogAction=null;dialogCancel=null;$('confirmation').close();cb?.();return;}
}
function readHash(){
 let hash;try{hash=decodeURIComponent(location.hash.slice(1));}catch{hash='discover';}
 if(hash.startsWith('item=')&&find(hash.slice(5))){ui.route='detail';ui.itemId=hash.slice(5);ui.detailTab='overview';}
 else if(hash.startsWith('collection=')&&['daily','create'].includes(hash.slice(11))){ui.route='collection';ui.collection=hash.slice(11);ui.returnTo='discover';}
 else ui.route=sections.some(s=>s.id===hash)?hash:'discover';
 ui.query='';ui.type='all';ui.category='all';ui.platform='all';ui.modelTask='all';
 const saved=ui.pendingReturn;ui.pendingReturn=null;
 if(saved){for(const key of ['route','query','type','category','platform','sort','tab','modelTask','libraryTab','updatesTab','collection'])ui[key]=saved[key];}
 $('search').value=ui.query;
 $('sidebar').classList.remove('is-open');$('menu-toggle').setAttribute('aria-expanded','false');
 render();window.scrollTo({top:saved?.scroll??0,behavior:'instant'});
 const returnTarget=saved?.focusItem?$('view').querySelector(`[data-action="open"][data-id="${CSS.escape(saved.focusItem)}"]`):null;
 (returnTarget??$('content')).focus({preventScroll:true});
}
$('brand-symbol').className='brand-symbol';$('brand-symbol').style.setProperty('--logo',`url("${logo}")`);
$('search-icon').innerHTML=icon('search',17);$('menu-toggle').innerHTML=icon('menu',20);$('material-toggle').innerHTML=icon('moon',20);
$('material-toggle').addEventListener('click',()=>{const ink=document.documentElement.dataset.material!=='ink';document.documentElement.dataset.material=ink?'ink':'paper';$('material-toggle').innerHTML=icon(ink?'sun':'moon',20);$('material-toggle').setAttribute('aria-label',ink?'Usar material Argila':'Usar material Grafite');});
$('menu-toggle').addEventListener('click',()=>{const open=$('sidebar').classList.toggle('is-open');$('menu-toggle').setAttribute('aria-expanded',String(open));});
$('search').addEventListener('input',e=>{ui.query=e.target.value;ui.type='all';render();});
$('scene').addEventListener('change',e=>{ui.scene=e.target.value;render();});
$('reset').addEventListener('click',()=>showDialog('Reiniciar esta prévia?','Favoritos, histórico e operações simuladas voltarão ao estado inicial.','Reiniciar exemplo',()=>{state=structuredClone(initialStore);ui.removed.clear();ui.steps.clear();ui.scene='ready';$('scene').value='ready';navigate('discover');render();notify('Dados demonstrativos reiniciados.');}));
document.querySelector('.skip').addEventListener('click',e=>{e.preventDefault();$('content').focus();});
document.addEventListener('click',e=>{const t=e.target.closest('[data-action]');if(t&&!t.disabled)handleAction(t.dataset.action,t.dataset.id);});
document.addEventListener('change',e=>{if(e.target.id==='sort'){ui.sort=e.target.value;render();}if(e.target.id==='category'){ui.category=e.target.value;render();}if(e.target.id==='type'){ui.type=e.target.value;render();}if(e.target.id==='model-task'){ui.modelTask=e.target.value;render();}});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!$('confirmation').open){e.preventDefault();$('search').focus();}if(e.key==='Escape'){$('sidebar').classList.remove('is-open');$('menu-toggle').setAttribute('aria-expanded','false');}});
$('confirmation').addEventListener('cancel',()=>{const cb=dialogCancel;dialogAction=null;dialogCancel=null;cb?.();});
window.addEventListener('hashchange',readHash);
// Serial demonstration queue. All transitions use the existing session-only reducer.
function advancePreviewQueue(){
 if(ui.scene!=='ready')return;
 const next=advanceQueue(state,ui.steps,find);
 if(next.state===state&&next.steps===ui.steps)return;
 state=next.state;ui.steps=next.steps;
 const result=next.finished;
 if(result){
  if(result.state==='succeeded'&&result.op==='remove')ui.removed.add(result.itemId);
  if(result.state==='succeeded'&&result.op==='install')ui.removed.delete(result.itemId);
  notify(result.state==='failed'?'Falha simulada. A versão anterior foi mantida.':'Operação concluída na demonstração.');
 }
 render();
}

let timer=null;
function startQueue(){if(timer===null)timer=window.setInterval(advancePreviewQueue,1100);}
window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;clearTimeout(toastTimer);});
window.addEventListener('pageshow',startQueue);
startQueue();
readHash();
