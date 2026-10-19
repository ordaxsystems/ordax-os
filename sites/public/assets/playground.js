/* Public marketing simulation only. No product imports, persistence, network or identity. */
(() => {
  "use strict";
  const root = document.querySelector(".playground");
  if (!root) return;
  const i18n = window.OrdaXPublicI18n;
  if (!i18n || i18n.schema !== "prototype-ordax.public-site-localization-runtime/1") {
    throw new Error("public-site-localization-runtime-missing");
  }
  const t = (messageId, variables) => i18n.t(messageId, variables);
  const local = source => i18n.fromSource(source);
  const deviceLabel = device => local(device === "phone" ? "telefone" : "notebook");
  const fixtureNode = document.querySelector("#playground-fixture");
  let fixture;
  try {
    fixture = JSON.parse(fixtureNode?.textContent ?? "");
    if (fixture?.$schema !== "prototype-ordax.public-playground-fixture/1") throw new Error("schema");
  } catch {
    const status = root.querySelector(".demo-status");
    if (status) status.textContent = "A demonstração está indisponível enquanto a fixture pública é atualizada.";
    return;
  }
  const screens = [...root.querySelectorAll("[data-device]")];
  const defaultNote = () => ({
    title: t("playground.note.initialTitle"),
    body: t("playground.note.initialBody"),
  });
  let noteDefaults = defaultNote();
  const initial = () => ({theme: "light", title: noteDefaults.title, body: noteDefaults.body, done: false, analysis: "idle", accepted: false});
  let state = initial();
  const views = new Map(screens.map(screen => [screen, {app: "home", folder: "", file: ""}]));
  const previewTriggers=new WeakMap();
  let noticeTimer;
  const announce = message => {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      const status = root.querySelector(".demo-status");
      const copy = status?.querySelector(".demo-status-copy");
      if (copy) copy.textContent = message;
      else if (status) status.textContent = message;
    }, 250);
  };
  const appRecords = new Map(fixture.apps.map(app => [app.id, app]));
  const names = Object.fromEntries(fixture.apps.map(app => [app.id, app.display_title ?? app.title]));
  const icons = Object.fromEntries(fixture.apps.map(app => [app.id, app.monogram]));
  names.home = "Início";
  names.projects = "Projetos";
  icons.home = "⌂";
  names.intelligence = "Intelligence";
  names.context = "Contexto";
  const iconPaths = {
    home: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10",
    files: "M3 7h7l2 3h9v10H3ZM3 7V4h7l2 3h9v3",
    intelligence: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3ZM19 2v4M17 4h4",
    context: "M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5",
    projects: "M3 5h7v6H3ZM14 5h7v6h-7ZM3 15h7v6H3ZM14 15h7v6h-7Z",
    notes: "M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5",
    internet: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18",
    settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
    account: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
    system: "M3 4h18v13H3ZM8 21h8M12 17v4"
  };
  const appIds = ["home", ...fixture.home.rail_apps];
  const displayHome = fixture.home;
  document.querySelectorAll("[data-fixture-app]").forEach(node => {
    const label = node.querySelector("[data-fixture-label]");
    const name = names[node.dataset.fixtureApp];
    if (label && name) label.textContent = name;
  });
  const appDetails = {
    internet: ["NAVEGAÇÃO", names.internet, appRecords.get("internet")?.description ?? ""],
    account: ["CONTINUIDADE", names.account, appRecords.get("account")?.description ?? ""],
    system: ["ESTADO DO SISTEMA", names.system, appRecords.get("system")?.description ?? ""]
  };
  const fixtures = {
    "Boas-vindas.txt": "Seu espaço começa com uma ideia.\n\nEsta é uma demonstração interativa do OrdaX. Explore as pastas, escreva uma nota e escolha seu tema. Nada aqui acessa os arquivos do seu dispositivo.",
    "Meu projeto.txt": "Um projeto, muitas possibilidades.\n\n1. Guardar referências\n2. Escrever a primeira ideia\n3. Escolher o próximo passo",
    "Referências.txt": "Referências de exemplo\n\nLuz natural. Materiais simples. Espaço para criar.\n\nNo OrdaX, a visão é aproximar conteúdo e contexto de trabalho."
  };
  function button(label, action, value, className = "") {
    const node = document.createElement("button");
    node.type = "button"; node.textContent = label; node.dataset.action = action;
    if (value !== undefined) node.dataset.value = value;
    node.className = className;
    return node;
  }
  const surface = fixture.surface;
  const routeLabels = { 'Início':'home', 'Aura':'intelligence', 'Espaços':'spaces', 'Aplicativos':'apps', 'Perfis profissionais':'profiles', 'Dispositivos':'devices', 'Loja':'store', 'Projetos':'projects', 'Arquivos':'files', 'Internet':'internet', 'Ajustes':'settings', 'Configurações':'settings', 'Minha conta':'account', 'Conta e identidade':'account', 'Atividades':'activity', 'Continuidade':'continuity', 'Notificações':'notifications' };
  for (const [label,id] of Object.entries(routeLabels)) names[id]=label;
  names.concept='Aurora';
  names['example-files']='Arquivos de exemplo';
  function recipeApp(control) { return control.dataset.recipe === 'projects' ? 'concept' : control.dataset.recipe === 'theme' ? 'settings' : control.dataset.recipe; }
  function mountCurrentSurface(screen, previousContent) {
    if (!surface?.chrome || !surface.views?.home) return;
    const view=views.get(screen);
    screen.classList.add('demo-native');
    // Trusted, source-hashed build artifact. No user text enters this markup.
    screen.innerHTML=surface.chrome;
    const host=screen.querySelector('[data-public-demo-content]');
    if (surface.views[view.app]) host.innerHTML=surface.views[view.app];
    else host.replaceChildren(previousContent);
    host.querySelector('h1,h2,h3')?.setAttribute('tabindex','-1');
    const activeLocale=i18n.getLocale();
    const welcome=host.querySelector('.meridian-welcome h1');if(welcome){const hour=new Date().getHours();welcome.textContent=local(hour<12?'Bom dia.':hour<18?'Boa tarde.':'Boa noite.');}
    const date=host.querySelector('.meridian-welcome time');
    if(date) {const now=new Date();date.dateTime=now.toISOString();date.textContent=new Intl.DateTimeFormat(activeLocale,{weekday:'long',day:'numeric',month:'long'}).format(now);}
    const prefix='public-'+screen.dataset.device+'-';
    for(const element of screen.querySelectorAll('[id]')) element.id=prefix+element.id;
    for(const element of screen.querySelectorAll('[for],[aria-labelledby],[aria-describedby],[aria-controls]')) for(const attr of ['for','aria-labelledby','aria-describedby','aria-controls']) if(element.hasAttribute(attr)) element.setAttribute(attr,element.getAttribute(attr).split(' ').map(id=>prefix+id).join(' '));
    for(const input of host.querySelectorAll('input,textarea,select')) input.disabled=true;
    for(const link of screen.querySelectorAll('a[href]')) { link.removeAttribute('href'); link.setAttribute('aria-disabled','true'); }
    const title=screen.querySelector('.meridian-system-location>span');
    if(title) title.textContent=surface.navigation.find(item=>routeLabels[item.name]===view.app)?.target??(view.app==='account'?'Minha conta':names[view.app]??'Início');
    for(const control of screen.querySelectorAll('button')) {
      if(control.dataset.action) continue;
      const label=control.getAttribute('aria-label')??control.textContent.trim();
      const route=routeLabels[label];
      if(route) {control.dataset.action='app';control.dataset.value=route;control.setAttribute('aria-pressed',String(view.app===route));control.dataset.active=String(view.app===route);if(view.app===route)control.setAttribute('aria-current','page');else control.removeAttribute('aria-current');}
      else if(control.matches('[data-navigation-trigger],.meridian-mobile-menu,.meridian-nav-more') || /Mais/.test(label)) control.dataset.action='public-menu';
      else if(control.matches('.meridian-brand-home,[data-window-home]')) {control.dataset.action='app';control.dataset.value='home';}
      else if(control.matches('.meridian-rail-space,.meridian-system-location>button:not(.meridian-mobile-menu)')) {control.dataset.action='app';control.dataset.value='spaces';}
      else if(label==='Ajustes rápidos do sistema') {control.dataset.action='app';control.dataset.value='settings';}
      else if(control.matches('.desktop-task')) { const name=control.querySelector('.meridian-dock-label')?.textContent; if(routeLabels[name]) {control.dataset.action='app';control.dataset.value=routeLabels[name];} }
      else if(control.closest('.meridian-project')) {control.dataset.action='app';control.dataset.value='concept';}
      else control.dataset.action='public-planned';
    }
    const menu=document.createElement('nav');menu.className='public-demo-menu';menu.hidden=true;menu.setAttribute('aria-label',local('Aplicativos e navegação'));
    for(const item of surface.navigation) menu.append(button(item.name,routeLabels[item.name]?'app':'public-planned',routeLabels[item.name]));
    menu.append(button(local('Minha conta'),'app','account'));
    menu.append(button(local('Arquivos de exemplo'),'app','example-files'));
    menu.id=prefix+'navigation';
    for(const trigger of screen.querySelectorAll('[data-action="public-menu"]')) {
      trigger.setAttribute('aria-controls',menu.id);
      trigger.setAttribute('aria-expanded','false');
    }
    screen.querySelector('.window-workspace').append(menu);
    const notice=document.createElement('aside');notice.className='public-demo-notice';notice.hidden=true;
    const copy=document.createElement('p');copy.setAttribute('role','status');copy.setAttribute('aria-live','polite');
    const dismiss=button(local('Fechar aviso'),'public-dismiss');
    notice.append(copy,dismiss);screen.querySelector('.window-workspace').append(notice);
  }
  function explainPreview(screen,trigger) {
    previewTriggers.set(screen,trigger.closest('.public-demo-menu')?menuTriggers.get(screen):trigger);
    const message=local('Esta ação não é executada na demonstração. Nenhuma alteração foi aplicada.');
    const notice=screen.querySelector('.public-demo-notice');
    if(notice) {
      notice.hidden=false;
      notice.querySelector('p').textContent=message;
    }
    announce(message);
  }
  function dismissPreview(screen) {
    const notice=screen.querySelector('.public-demo-notice');
    if(!notice || notice.hidden) return false;
    notice.hidden=true;
    const trigger=previewTriggers.get(screen);
    const destination=trigger?.isConnected?trigger:screen.querySelector('[data-public-demo-content] h1,[data-public-demo-content] h2,[data-public-demo-content] h3');
    destination?.focus({preventScroll:true});
    return true;
  }
  function render(screen) {
    const view = views.get(screen);
    const device = screen.dataset.device;
    screen.dataset.theme = state.theme;
    screen.dataset.app = view.app;
    // This template contains constants only; user text is assigned through value/textContent below.
    screen.innerHTML = `<div class="demo-topbar"><b>OrdaX</b><span>DEMONSTRAÇÃO</span><span class="demo-system-icons" aria-hidden="true">▣ &nbsp; ◉ &nbsp; ▰</span></div><div class="demo-workspace"><nav class="demo-dock" aria-label="${t("playground.appsOnDevice", {device: deviceLabel(device)})}"></nav><div class="demo-window"><div class="demo-windowbar"><strong></strong><span>Dados de exemplo</span></div><div class="demo-content"></div></div></div>`;
    const dock = screen.querySelector(".demo-dock");
    for (const app of ["home", "projects", "context", "intelligence", "files", "settings", "system"]) {
      const tab = button("", "app", app);
      tab.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths[app] ?? iconPaths.system}"></path></svg><span></span>`;
      tab.querySelector("span").textContent = names[app];
      tab.setAttribute("aria-label", t("playground.appOnDevice", {
        app: local(names[app]),
        device: deviceLabel(device),
      }));
      tab.setAttribute("aria-pressed", String(view.app === app));
      dock.append(tab);
    }
    screen.querySelector(".demo-windowbar strong").textContent = names[view.app] ?? "Início";
    const content = screen.querySelector(".demo-content");
    if (view.app === "home") {
      // The current Central is rendered from its actual components at build time.
    } else if (["concept", "intelligence", "context"].includes(view.app)) {
      const complete = state.analysis === "ready";
      content.innerHTML = `<div class="project-demo"><header class="project-heading"><div><p class="demo-eyebrow">ESPAÇO CRIATIVO / PROJETO DE EXEMPLO</p><h3>Aurora<span class="project-desktop-subtitle"> / Direção criativa</span></h3><p>Projetos que conectam pessoas e futuros.</p></div><span class="project-badge">CONCEITO INTERATIVO</span></header><div class="project-tabs"></div><div class="project-body"></div><p class="concept-disclosure">Exemplo fictício · IA predefinida · Nenhum modelo está sendo executado.</p></div>`;
      const tabs = content.querySelector(".project-tabs");
      for (const [app,label] of [["concept","Visão geral"],["intelligence","✧ Intelligence"],["context","Contexto"]]) {
        const item = button(label,"app",app); item.setAttribute("aria-pressed",String(view.app === app)); tabs.append(item);
      }
      const body = content.querySelector(".project-body");
      if (view.app === "projects") {
        body.innerHTML = `<div class="project-overview"><div class="project-main"><div class="project-cover"><span>Ideias<br>em movimento<br>para um amanhã<br>mais humano.</span><strong>Aurora</strong><small>DIREÇÃO CRIATIVA · EXEMPLO</small></div><section class="project-brief"><h4>Brief do projeto</h4><p>Explorar uma nova linguagem visual para a Aurora, conectando tecnologia, natureza e pessoas em uma mesma narrativa.</p></section><section class="project-milestones"><h4>Marcos principais</h4><div><span class="milestone-check">✓</span><span>Pesquisa e referências</span><small>Concluído no exemplo</small></div><div><span class="milestone-check pending"></span><span>Direção criativa</span><small>Em andamento</small></div><div><span class="milestone-check pending"></span><span>${state.accepted ? "Validar contraste da paleta" : "Apresentação conceitual"}</span><small>Próximo passo</small></div></section></div><aside class="project-ai"><div class="project-ai-title"><span class="ai-blue-dot"></span>Intelligence</div><span class="response-label">Análise de exemplo</span><h4>A direção está clara.<br>Falta validar.</h4><p>O conceito comunica os pilares do projeto. Antes da entrega, vale revisar o contraste e a legibilidade nas aplicações.</p><div class="project-review-action"></div><div class="project-ai-points"><span>Pontos de atenção</span><ul><li>Verificar contraste da paleta</li><li>Revisar hierarquia tipográfica</li><li>Validar a mensagem</li></ul></div><div class="project-ai-footnote"><span>✧</span><p>Uma perspectiva para o projeto.<br>A decisão continua com você.</p></div></aside></div>`;
        body.querySelector(".project-review-action").append(button("Revisar sugestão ↗","app","intelligence","intelligence-cta"));
      } else if (view.app === "context") {
        body.innerHTML = `<div class="context-intro"><h4>O contexto vem primeiro.</h4><p>Uma análise consultiva parte de referências explícitas. Abra os documentos deste exemplo.</p></div><div class="context-documents"></div>`;
        for (const [id,title,detail] of [["brief","Brief do projeto","Objetivo, público e critérios"],["direction","Direção visual","Paleta, materiais e tipografia"],["review","Revisão de entrega","Pendências e critérios de aceite"]]) {
          const card = button("","context-document",id,"context-document");
          const heading = document.createElement("strong"); heading.textContent=title;
          const description = document.createElement("span"); description.textContent=detail;
          card.append(heading,description);body.querySelector(".context-documents").append(card);
        }
        const detail = document.createElement("p");detail.className="context-detail";detail.textContent=view.document === "brief" ? "Objetivo: tornar a Aurora reconhecível e acessível. Público: estúdios independentes. Critério: legibilidade em telas pequenas." : view.document === "direction" ? "Direção: mineral, grafite e cobre. Usar espaços generosos e testar contraste antes de fechar a paleta." : view.document === "review" ? "Aceite: confirmar contraste, aprovar duas aplicações e registrar a decisão final. Nenhuma entrega aprovada neste exemplo." : "Selecione uma referência para consultar seu conteúdo.";body.append(detail);
      } else {
        body.innerHTML = `<div class="intelligence-layout"><div class="intelligence-intro"><div class="intelligence-orb" aria-hidden="true">✧</div><p class="demo-eyebrow">ORDA X INTELLIGENCE</p><h4>Uma perspectiva.<br>Você decide.</h4><p>Analise o contexto do projeto e revise a sugestão antes de levá-la ao seu plano.</p><span class="ai-context-tag">3 referências de exemplo</span></div><div class="intelligence-response" aria-live="polite"><span class="response-label">${complete ? "ANÁLISE ILUSTRATIVA" : "CONSULTA DE EXEMPLO"}</span><h4>${complete ? "A direção está clara. Falta validar." : "O que merece atenção antes da entrega?"}</h4><p>${complete ? "O brief pede legibilidade, mas a direção visual ainda não registra uma verificação de contraste. Essa é a primeira pendência a revisar." : "Explore como o contexto poderia orientar uma resposta consultiva. Esta prévia usa uma resposta predefinida."}</p>${complete ? '<div class="analysis-finding"><b>01</b><div><strong>Validar contraste da paleta</strong><p>Compare texto, fundo e elementos interativos antes de aprovar as aplicações.</p></div></div><small>Referências: Brief do projeto · Direção visual</small>' : ''}<div class="analysis-actions"></div></div></div>`;
        const actions=body.querySelector(".analysis-actions");
        const action=button(complete ? state.accepted ? "Adicionado ao plano de exemplo ✓" : "Adicionar ao plano de exemplo" : "Explorar análise de exemplo →",complete ? "accept-analysis" : "analyze",undefined,"intelligence-cta");
        action.disabled=complete && state.accepted;actions.append(action);
        if(complete) actions.append(button("Consultar referências","app","context","context-link"));
      }
    } else if (view.app === "notes") {
      content.innerHTML = `<p class="demo-eyebrow">MEU ESPAÇO / NOTA PESSOAL</p><label class="sr-only" for="${device}-title">${t("playground.noteTitleOnDevice", {device: deviceLabel(device)})}</label><input id="${device}-title" class="demo-title" data-field="title" maxlength="70"><div class="demo-note-meta">Uma ideia, nas duas telas <span aria-hidden="true">↔</span></div><label class="sr-only" for="${device}-body">${t("playground.noteBodyOnDevice", {device: deviceLabel(device)})}</label><textarea id="${device}-body" data-field="body" maxlength="1800" spellcheck="true"></textarea><label class="demo-check"><input type="checkbox" data-field="done">Experimentar algo novo hoje</label><p class="demo-local">↔ Compartilhado nesta demonstração</p>`;
    } else if (view.app === "settings") {
      content.innerHTML = `<p class="demo-eyebrow">APARÊNCIA</p><h3>Do seu jeito.</h3><p class="demo-description">Uma pequena mudança faz diferença. Escolha a luz do seu espaço.</p><div class="theme-options"></div><p class="demo-local">O tema muda nas duas telas.</p>`;
      for (const [value,label] of [["light","☀ Claro"],["dark","☾ Escuro"]]) {
        const option = button(label,"theme",value,`theme-choice theme-${value}`);
        option.setAttribute("aria-pressed",String(state.theme === value));
        content.querySelector(".theme-options").append(option);
      }
    } else if (appDetails[view.app]) {
      const [eyebrow, title, description] = appDetails[view.app];
      content.innerHTML = `<p class="demo-eyebrow">${eyebrow}</p><h3>${title}</h3><p class="demo-description">${description}</p><div class="demo-app-placeholder"><span>${icons[view.app]}</span><strong>${title} na Surface</strong><small>Esta área é uma demonstração local do app principal.</small></div><p class="demo-local">Volte à Home para continuar explorando.</p>`;
    } else {
      const trail = document.createElement("div"); trail.className = "demo-breadcrumb";
      trail.append(button("Meu espaço", "folder", ""));
      if (view.folder) trail.append(document.createTextNode(` / ${view.folder}`));
      content.append(trail);
      if (view.file) {
        content.append(button("← Voltar aos arquivos", "back"));
        const title = document.createElement("h3"); title.textContent = view.file;
        const text = document.createElement("p"); text.className = "demo-file-text"; text.textContent = fixtures[view.file];
        content.append(title,text);
      } else {
        const heading = document.createElement("h3"); heading.textContent = view.folder || "Tudo tem seu lugar."; content.append(heading);
        const grid = document.createElement("div"); grid.className = "demo-file-grid";
        if (!view.folder) for (const folder of ["Documentos","Projetos"]) grid.append(button(`▰\n${folder}`,"folder",folder,"demo-file folder"));
        const files = view.folder === "Projetos" ? ["Meu projeto.txt","Referências.txt"] : ["Boas-vindas.txt"];
        for (const file of files) grid.append(button(`▤\n${file}`,"file",file,"demo-file"));
        content.append(grid);
      }
    }
    mountCurrentSurface(screen, content);
    sync();
    updateRecipes();
  }
  function updateRecipes() {
    root.querySelectorAll("[data-recipe]").forEach(control => {
      const app = recipeApp(control);
      control.setAttribute("aria-pressed", String(screens.every(screen => views.get(screen).app === app)));
    });
  }
  function sync(source) {
    for (const screen of screens) {
      screen.dataset.theme = state.theme;
      for (const input of screen.querySelectorAll("[data-field]")) {
        if (input === source) continue;
        if (input.type === "checkbox") input.checked = state.done;
        else input.value = state[input.dataset.field];
      }
      for (const option of screen.querySelectorAll('[data-action="theme"]')) option.setAttribute("aria-pressed",String(option.dataset.value === state.theme));
    }
  }
  const menuTriggers=new WeakMap();
  function closeNavigation(screen, restoreFocus=false) {
    const menu=screen.querySelector('.public-demo-menu');
    if(!menu || menu.hidden) return;
    menu.hidden=true;
    screen.querySelectorAll('[data-action="public-menu"]').forEach(trigger=>trigger.setAttribute('aria-expanded','false'));
    if(restoreFocus) menuTriggers.get(screen)?.focus({preventScroll:true});
  }
  document.addEventListener('pointerdown',event=>{
    for(const screen of screens) if(!screen.querySelector('.public-demo-menu')?.contains(event.target) && !event.target.closest('[data-action="public-menu"]')) closeNavigation(screen);
  });
  for (const screen of screens) {
    render(screen);
    screen.addEventListener('submit',event=>event.preventDefault());
    screen.addEventListener('keydown',event=>{
      if(event.key==='Escape') {
        const menu=screen.querySelector('.public-demo-menu');
        if(menu && !menu.hidden) {
          event.preventDefault();event.stopPropagation();closeNavigation(screen,true);
        } else if(dismissPreview(screen)) {
          event.preventDefault();event.stopPropagation();
        }
        return;
      }
      const menu=event.target.closest('.public-demo-menu');
      if(!menu || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      const items=Array.from(menu.querySelectorAll('button'));
      const index=items.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      event.preventDefault();items[next]?.focus({preventScroll:true});items[next]?.scrollIntoView({block:'nearest'});
    });
    screen.addEventListener('focusout',event=>{
      if(event.target.closest('.public-demo-menu') && event.relatedTarget && !screen.querySelector('.public-demo-menu')?.contains(event.relatedTarget)) closeNavigation(screen);
    });
    screen.addEventListener("input", event => {
      const field = event.target.dataset.field;
      if (!["title","body","done"].includes(field)) return;
      state[field] = field === "done" ? event.target.checked : event.target.value;
      sync(event.target);
      announce(t("playground.changeOnDevice", {device: deviceLabel(screen.dataset.device)}));
    });
    screen.addEventListener("click",event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const {action,value} = control.dataset;
      const view = views.get(screen);
      if (action === 'public-menu') {
        const menu=screen.querySelector('.public-demo-menu');
        if(!menu.hidden) {closeNavigation(screen,true);return;}
        screens.forEach(other=>closeNavigation(other));
        menuTriggers.set(screen,control);menu.hidden=false;
        control.setAttribute('aria-expanded','true');menu.querySelector('button')?.focus({preventScroll:true});return;
      }
      closeNavigation(screen);
      if(action==='public-dismiss') {dismissPreview(screen);return;}
      if(action?.startsWith('spaces-') || action==='public-planned') {explainPreview(screen,control);return;}
      if (action === "analyze" || action === "accept-analysis") {
        if(action === "analyze") state.analysis = "ready";
        else state.accepted = true;
        screens.forEach(render);
        screen.querySelector(".analysis-actions button")?.focus({preventScroll:true});
        announce(action === "analyze" ? "Análise de exemplo disponível. Resposta predefinida, sem inferência real." : "Sugestão adicionada ao plano fictício do projeto Aurora.");
        return;
      }
      if (action === "context-document") view.document=value;
      if (action === "theme") { state.theme = value; sync(); announce(local("Tema alterado nas duas telas.")); return; }
      if (action === "launcher") {
        const launcher = screen.querySelector("[data-home-launcher]");
        if (launcher) {
          const open = launcher.hidden;
          launcher.hidden = !open;
          control.setAttribute("aria-expanded", String(open));
        }
        return;
      }
      if (action === "app" && names[value]) {
        if(!surface.views[value]&&!['concept','intelligence','context','notes','system','example-files'].includes(value)) {explainPreview(screen,control);return;}
        view.app = value;
      }
      if (action === "folder") { view.app = "example-files"; view.folder = value; view.file = ""; }
      if (action === "file" && Object.hasOwn(fixtures,value)) view.file = value;
      if (action === "back") view.file = "";
      render(screen);
      const focusTarget = action === "app" ? screen.querySelector(`[data-action="app"][data-value="${view.app}"]`) : screen.querySelector(".demo-content button");
      focusTarget?.focus({preventScroll:true});
    });
  }
  // Fixed virtual viewports keep the notebook in desktop geometry on every host size.
  const sizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const screen = entry.target.querySelector("[data-device]");
      const width = screen.dataset.device === "laptop" ? 1120 : 340;
      screen.style.setProperty("--screen-scale", String(entry.contentRect.width / width));
    }
  });
  screens.forEach(screen => sizeObserver.observe(screen.parentElement));

  const dialog = root.querySelector(".demo-expanded");
  let expandedDevice=null;
  const expandedCopy=()=>{
    const phone=expandedDevice?.device==='phone';
    dialog.querySelector('h2').textContent=local(phone?'Explore o OrdaX no telefone':'Explore a área de trabalho');
    dialog.querySelector('.expanded-header p').textContent=local(phone?'Abra o menu para navegar entre os aplicativos. Os dados são de exemplo.':'Em telas pequenas, deslize na horizontal para explorar o notebook.');
  };
  root.querySelectorAll('[data-expand]').forEach(trigger=>trigger.addEventListener('click',()=>{
    if(expandedDevice) return;
    const device=trigger.dataset.expand==='phone'?'phone':'laptop';
    const node=root.querySelector(device==='phone'?'.phone-device':'.laptop-device');
    const anchor=document.createComment('device position');
    expandedDevice={node,anchor,trigger,device};
    screens.forEach(screen=>closeNavigation(screen));
    node.replaceWith(anchor);
    dialog.dataset.expandedDevice=device;
    dialog.querySelector('[data-expanded-mount]').append(node);
    expandedCopy();dialog.showModal();
    dialog.querySelector('[data-close-expanded]').focus();
  }));
  dialog.querySelector('[data-close-expanded]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    if(!expandedDevice) return;
    const {node,anchor,trigger}=expandedDevice;
    screens.forEach(screen=>closeNavigation(screen));
    anchor.replaceWith(node);expandedDevice=null;
    trigger.focus({preventScroll:true});
  });
  root.querySelector("[data-reset]").addEventListener("click",() => {
    state = initial();
    screens.forEach(screen => { views.set(screen,{app:"home",folder:"",file:""}); render(screen); });
    announce("Demonstração reiniciada. Os dados de exemplo foram restaurados.");
  });
  root.querySelectorAll("[data-recipe]").forEach(control => control.addEventListener("click",() => {
    const app = recipeApp(control);
    screens.forEach(screen => { views.get(screen).app = app; render(screen); });
    screens[0].querySelector(".demo-content input, .demo-content button")?.focus({preventScroll:true});
    screens[0].scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"center"});
    announce(local(app === "home" ? "A Home do OrdaX reúne seus apps e espaços de trabalho." : app === "concept" ? "Projeto Aurora: objetivos, referências e próximos passos de exemplo." : app === "intelligence" ? "Explore uma análise predefinida. Esta página não executa inferência." : "Consulte as referências fictícias que sustentam a análise."));
  }));

  document.addEventListener("ordax:localechange", () => {
    const previousDefaults = noteDefaults;
    noteDefaults = defaultNote();
    if (state.title === previousDefaults.title) state.title = noteDefaults.title;
    if (state.body === previousDefaults.body) state.body = noteDefaults.body;
    screens.forEach(render);
    if(expandedDevice) expandedCopy();
  });
})();
