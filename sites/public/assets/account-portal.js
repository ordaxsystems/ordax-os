/* Canonical Account presentation; the shared portal client owns Identity. */
(() => {
  "use strict";

  const root = document.getElementById("account-app");
  if (!root || document.body.dataset.page !== "conta") return;
  const i18n = window.OrdaXPublicI18n;
  if (!i18n || i18n.schema !== "prototype-ordax.public-site-localization-runtime/1") {
    throw new Error("public-site-localization-runtime-missing");
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const account = window.OrdaXPublicAccount;
  if (!account || account.schema !== "prototype-ordax.public-account-client/1") {
    throw new Error("public-account-client-missing");
  }
  const tx = source => esc(i18n.fromSource(source));
  const message = (id, variables) => esc(i18n.t(id, variables));
  const MARK = "/assets/ordax-symbol.png";
  const LANDSCAPE = "/assets/account-landscape.jpg";

  // One catalog owns routes, navigation, descriptions and unavailable service presentation.
  const sections = Object.freeze([
    { id: "visao-geral", title: "Visão geral", icon: "dashboard", description: "Sua identidade, assinatura e recursos em um só lugar." },
    { id: "dados-pessoais", title: "Dados pessoais", icon: "user", description: "Seu perfil e suas informações cadastrais.", owner: "Identidade OrdaX", capabilities: ["E-mail da conta", "Edição de dados cadastrais", "Foto de perfil"] },
    { id: "assinatura", title: "Plano e assinatura", icon: "crown", description: "Seu plano, benefícios e opções de assinatura.", owner: "Direitos e assinaturas OrdaX", capabilities: ["Plano contratado", "Catálogo oficial de planos", "Alteração e cancelamento"] },
    { id: "consumo", title: "Consumo e limites", icon: "chart", description: "Acompanhe seus recursos em todo o ecossistema OrdaX.", owner: "Medição de uso OrdaX", capabilities: ["Créditos de IA", "Armazenamento", "Chamadas de API", "Histórico por período"] },
    { id: "faturamento", title: "Pagamentos e faturas", icon: "card", description: "Métodos de pagamento, cobranças e documentos fiscais.", owner: "Faturamento OrdaX", capabilities: ["Métodos de pagamento", "Faturas e recibos", "Dados fiscais"] },
    { id: "seguranca", title: "Segurança e acesso", icon: "shield", description: "Proteja sua identidade e controle o acesso à sua conta.", owner: "Identidade OrdaX", capabilities: ["Sessão neste navegador", "Senha", "Verificação em duas etapas", "Recuperação", "Eventos de acesso"] },
    { id: "dispositivos", title: "Meus dispositivos", icon: "devices", description: "Dispositivos e sessões vinculados à sua conta.", owner: "Sessões e dispositivos OrdaX", capabilities: ["Sessões ativas", "Dispositivos OrdaX OS", "Encerramento remoto"] },
    { id: "privacidade", title: "Dados e privacidade", icon: "fingerprint", description: "Seus dados, suas escolhas. Você está no controle.", owner: "Privacidade OrdaX", capabilities: ["Exportação de dados", "Consentimentos", "Exclusão da conta"] },
    { id: "integracoes", title: "Integrações", icon: "globe", description: "Contas conectadas e autorizações de aplicativos.", owner: "Integrações OrdaX", capabilities: ["Conexões autorizadas", "Revogação de conexões"] },
    { id: "preferencias", title: "Preferências", icon: "sliders", description: "Personalize a experiência da sua conta." },
    { id: "atividade", title: "Atividade da conta", icon: "history", description: "Histórico de acesso e alterações importantes.", owner: "Auditoria da conta OrdaX", capabilities: ["Eventos de acesso", "Alterações de conta", "Filtros por período"] },
    { id: "suporte", title: "Central de ajuda", icon: "help", description: "Encontre respostas e cuide da sua experiência OrdaX." }
  ]);
  const byId = new Map(sections.map(section => [section.id, section]));
  const periods = Object.freeze({ month: "Este mês", week: "Últimos 7 dias", thirty: "Últimos 30 dias", year: "Este ano" });
  const resourceTabs = Object.freeze({ overview: "Visão geral", ai: "IA", storage: "Armazenamento", apis: "APIs" });
  const resources = Object.freeze([
    { id: "ai", name: "Créditos de IA", label: "Inteligência artificial", icon: "cpu", tone: "violet" },
    { id: "storage", name: "Armazenamento", label: "Armazenamento", icon: "disk", tone: "cyan" },
    { id: "apis", name: "APIs e serviços", label: "APIs e serviços", icon: "zap", tone: "mint" }
  ]);
  const faqs = Object.freeze([
    { q: "Onde encontro meu plano e minha assinatura?", a: "A seção Plano e assinatura reunirá seu plano e seus benefícios quando o serviço oficial estiver disponível." },
    { q: "Como acompanho meu consumo de IA?", a: "Os filtros da seção Consumo e limites já estão disponíveis para avaliação. Os valores dependem do serviço oficial de medição de uso." },
    { q: "Como acesso minhas faturas?", a: "Pagamentos e faturas reúne documentos fiscais e cobranças. Faturas e recibos poderão ser baixados quando o serviço de faturamento estiver integrado." },
    { q: "Como protejo minha conta?", a: "Segurança e acesso confirma a sessão deste navegador. Senha, verificação em duas etapas e lista de dispositivos aguardam serviços públicos específicos." },
    { q: "Posso exportar ou excluir meus dados?", a: "Os controles ficam em Dados e privacidade. Para sua proteção, a exportação e a exclusão exigem uma conta autenticada e o serviço de privacidade conectado." }
  ]);
  const state = { section: "visao-geral", period: "month", activityPeriod: "month", tab: "overview", faq: 0, helpQuery: "", searchQuery: "", dialog: null };
  let session = account.getSnapshot();
  let disposeMenu = () => {};
  const signedIn = () => session.status === "authenticated";
  const sessionKey = () => session.status === "authenticated" ? "active" : session.status;
  const sessionTitle = () => message(`account.session.${sessionKey()}.title`);

  function renderSession() {
    const trigger = document.getElementById("profile-menu-trigger");
    const focusWasInMenu = document.getElementById("ordax-profile-menu")?.contains(document.activeElement);
    if (session.status !== "leaving") {
      disposeMenu();
      disposeMenu = account.bindProfileMenu(trigger, { accountRoute: "/conta/" });
    }
    trigger.disabled = session.status === "leaving";
    document.getElementById("profile-menu-label").textContent = i18n.fromSource(signedIn() ? "Meu perfil" : "Sua conta");
    trigger.setAttribute("aria-label", i18n.fromSource(signedIn() ? "Opções da conta" : "Sua conta"));
    document.getElementById("account-session").dataset.status = session.status;
    document.getElementById("account-session").innerHTML = `<div class="session-information">${icon(signedIn() ? "shield" : "user")}<div><strong role="status" id="session-status-title" tabindex="-1">${sessionTitle()}</strong><p>${message(`account.session.${sessionKey()}.detail`)}</p>${signedIn() && session.email ? `<p class="session-email" translate="no">${esc(session.email)}</p>` : ""}</div></div><div class="session-actions">${["checking", "leaving"].includes(session.status) ? "" : action(signedIn() ? "Verificar sessão" : "Tentar novamente", "refresh", { disabled: false, small: true, data: 'data-refresh-session id="session-retry"' })}${!signedIn() && session.status !== "leaving" ? `<a href="/login/" class="button outline h-8">${tx("Entrar")}${icon("arrow-right")}</a>` : ""}</div>`;
    document.getElementById("session-footer-status").innerHTML = `<span></span>${sessionTitle()}`;
    if (focusWasInMenu && !trigger.disabled) trigger.focus({ preventScroll: true });
  }

  function sessionSection() {
    return `<section class="settings-section"><div class="setting-row">${icon("shield", "mint")}<div><h2>${tx("Sessão neste navegador")}</h2><p>${sessionTitle()}</p>${signedIn() && session.email ? `<p class="verified-email" translate="no">${esc(session.email)}</p>` : ""}<small>${tx("Esta consulta confirma apenas a sessão atual. Não lista outros dispositivos.")}</small></div>${action("Verificar sessão", "refresh", { disabled: !["authenticated", "anonymous", "unavailable"].includes(session.status), data: 'data-refresh-session id="security-session-retry"' })}</div>${signedIn() ? `<p class="session-help">${tx("Para encerrar esta sessão, abra seu perfil no cabeçalho e escolha Sair da conta.")}</p>` : ""}</section>`;
  }

  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    crown: '<path d="m2 8 5 4 5-9 5 9 5-4-3 12H5Z"/><path d="M5 21h14"/>',
    chart: '<path d="M3 3v18h18M7 14l4-4 4 3 5-7"/>',
    card: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20M6 15h3"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    devices: '<rect x="2" y="3" width="15" height="12" rx="2"/><path d="M6 20h6M9 15v5"/><rect x="16" y="10" width="6" height="12" rx="1"/>',
    fingerprint: '<path d="M12 11c-1.2 0-2 .9-2 2v3c0 1.4-.2 2.8-.7 4M14 13v2c0 2.4-.5 4.3-1.3 6M7 18v-5a5 5 0 0 1 10 0v2c0 1.8-.2 3.6-.7 5M4 16v-3a8 8 0 0 1 16 0v3M6 5a10 10 0 0 1 12 0"/>',
    sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1.2.8-1.8 1.3-1.8 2.8M12 17h.01"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "chevron-right": '<path d="m9 6 6 6-6 6"/>',
    "arrow-right": '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    "arrow-up-right": '<path d="M7 17 17 7M7 7h10v10"/>',
    "panel-close": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m7-13-4 4 4 4"/>',
    "panel-open": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m4-13 4 4-4 4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01"/>',
    dashed: '<path d="M21 12a9 9 0 0 0-.6-3.2M18.4 5.6A9 9 0 0 0 15 3.5M11 3a9 9 0 0 0-3.7 1.3M4.4 7A9 9 0 0 0 3 10.5M3.4 14.7A9 9 0 0 0 5.5 18M9 20.5a9 9 0 0 0 3 .5M16 20a9 9 0 0 0 3-2.5M20.6 14.7a9 9 0 0 0 .4-2.7"/>',
    pencil: '<path d="m15 5 4 4M3 21l4-1 13-13a2.8 2.8 0 0 0-4-4L3 16Z"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    disk: '<path d="m3 14 3-10h12l3 10v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 14h18M7 17h.01M11 17h.01"/>',
    zap: '<path d="m13 2-10 12h8l-1 8 11-12h-8Z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
    plug: '<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v5"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    camera: '<path d="M14 4h-4L8 7H3v14h18V7h-5Z"/><circle cx="12" cy="14" r="4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18"/>',
    refresh: '<path d="M3 10a9 9 0 0 1 15-6l3 3M21 3v4h-4M21 14a9 9 0 0 1-15 6l-3-3M3 21v-4h4"/>'
  };
  function icon(name, className = "") {
    return `<svg class="${esc(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
  }
  function hydrateIcons(scope = document) {
    scope.querySelectorAll("[data-icon]").forEach(node => { node.outerHTML = icon(node.dataset.icon); });
  }
  function link(id, label, className = "", inside = "") {
    return `<a href="#${esc(id)}" class="${esc(className)}" data-section="${esc(id)}">${inside}${label ? tx(label) : ""}</a>`;
  }
  function action(label, iconName, { disabled = true, variant = "outline", small = false, data = "" } = {}) {
    return `<button type="button" class="button ${esc(variant)}${small ? " h-8" : ""}"${disabled ? " disabled" : ""}${data ? ` ${data}` : ""}>${iconName ? icon(iconName) : ""}${tx(label)}</button>`;
  }
  function empty(title, description, iconName = "document") {
    return `<div class="empty-state"><span class="empty-icon">${icon(iconName)}</span><h3>${tx(title)}</h3><p>${tx(description)}</p><span class="unavailable-chip"><span></span>${tx("Serviços não conectados")}</span></div>`;
  }
  function field(label, placeholder, type = "text") {
    if (label === "E-mail" && signedIn()) {
      return `<label class="form-field"><span>${tx(label)}</span><input type="email" value="${esc(session.email)}" readonly autocomplete="off"><small>${message(session.email ? "account.session.active.title" : "account.session.emailUnavailable")}</small></label>`;
    }
    return `<label class="form-field"><span>${tx(label)}</span><input type="${esc(type)}" placeholder="${tx(placeholder)}" disabled><small>${tx("Disponível após conectar a conta")}</small></label>`;
  }
  function selectPeriod(id, value, all = true) {
    return `<label class="period-select"><span class="sr-only">${tx(id === "activity-period" ? "Período de atividade" : "Período de consumo")}</span><select id="${id}" data-period="${id}">${Object.entries(periods).filter(([key]) => all || key !== "year").map(([key, label]) => `<option value="${key}"${value === key ? " selected" : ""}>${tx(label)}</option>`).join("")}</select>${icon("chevron-down")}</label>`;
  }
  function chart(period = "month") {
    const translatedPeriod = (i18n?.fromSource(periods[period]) ?? periods[period]).toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR");
    return `<div class="usage-chart" role="img" aria-label="${tx("Seu consumo aparecerá aqui")}"><div class="chart-field"><div class="chart-grid" aria-hidden="true"></div><div class="chart-empty">${icon("chart")}<span>${tx("Seu consumo aparecerá aqui")}</span><small>${message("account.usage.unavailablePeriod", { period: translatedPeriod })}</small></div></div></div>`;
  }
  function integration(section) {
    if (!section.owner) return "";
    const available = capability => signedIn() && (capability === "Sessão neste navegador" || (capability === "E-mail da conta" && Boolean(session.email)));
    const partial = section.capabilities.some(available);
    return `<section class="integration-panel" aria-label="${tx("Prontidão da integração")}"><div class="integration-head"><span class="integration-icon">${icon("plug")}</span><div class="min-w-0"><small>${tx("FONTE OFICIAL DESTA SEÇÃO")}</small><h2>${tx(section.owner)}</h2></div><span class="integration-status${partial ? " ok" : ""}"><span></span>${tx(partial ? "Conexão parcial" : "Recursos pendentes")}</span></div><ul class="integration-caps">${section.capabilities.map(capability => `<li>${icon(available(capability) ? "shield" : "dashed")}<span>${tx(capability)}</span><em>${tx(available(capability) ? "Verificado" : "Aguardando serviço")}</em></li>`).join("")}</ul></section>`;
  }

  function overview() {
    return `<section class="overview-hero"><img class="hero-landscape" src="${LANDSCAPE}" width="1920" height="640" alt="${tx("Paisagem OrdaX com montanhas e um planeta luminoso")}"><div class="hero-shade"></div><div class="hero-content"><div class="eyebrow"><span></span>${tx("SEU UNIVERSO, CONECTADO")}</div><h1 tabindex="-1">${tx("Minha Conta")}<span>.</span></h1><p>${tx("Sua identidade, assinatura e recursos. Tudo em um só lugar.")}</p></div><span class="hero-caption">${tx("UMA CONTA. TODOS OS SEUS MUNDOS.")}</span></section>
      <section class="profile-banner"><div class="profile-identity"><div class="profile-avatar">${icon("user")}<span>${icon("dashed")}</span></div><div><div class="flex items-center gap-2"><h2>${tx(signedIn() ? "Conta autenticada" : "Sua conta OrdaX")}</h2><span class="profile-label">${tx("Pessoal")}</span></div><p class="verified-email" translate="no">${signedIn() && session.email ? esc(session.email) : tx("Uma identidade para todo o seu universo.")}</p>${link("dados-pessoais", "", "button outline h-8", `${icon("pencil")}${tx("Ver perfil")}${icon("chevron-right")}`)}</div></div><div class="profile-facts">${[{ icon: "calendar", tone: "", name: "Membro desde", value: "Não disponível" }, { icon: "crown", tone: "violet", name: "Plano atual", value: "Aguardando conexão" }, { icon: "shield", tone: "mint", name: "Status da conta", value: signedIn() ? "Sessão verificada" : "Não conectada" }].map(fact => `<div><span class="fact-icon ${fact.tone}">${icon(fact.icon)}</span><div><small>${tx(fact.name)}</small><strong${fact.tone === "mint" ? ' class="text-muted-foreground"' : ""}>${tx(fact.value)}</strong></div></div>`).join("")}</div></section>
      <div class="section-heading"><h2>${tx("Seu universo em resumo")}</h2><span>${tx("Visão geral da conta")}</span></div>
      <div class="summary-grid"><article class="account-card plan-card"><div class="card-title"><span class="icon-tile violet">${icon("crown")}</span><span>${tx("Seu plano")}</span><span class="tiny-label">${tx("ASSINATURA")}</span></div><div class="plan-body"><div><h3>${tx("Mais possibilidades.")}<br>${tx("Um só lugar.")}</h3><p>${tx("Seu plano e seus benefícios ficam disponíveis aqui.")}</p></div><img src="${MARK}" width="126" height="126" alt="${tx("Símbolo OrdaX")}"></div>${link("assinatura", "", "button plan-button", `${tx("Ver assinatura")}${icon("arrow-right")}`)}</article>
      <article class="account-card resource-card"><div class="card-title"><span class="icon-tile cyan">${icon("chart")}</span><span>${tx("Consumo de recursos")}</span><a href="#consumo" aria-label="${tx("Ver consumo")}">${icon("arrow-up-right")}</a></div><p class="card-subtitle">${tx("Seus recursos, na medida do seu universo.")}</p><div class="resource-rows">${resources.map(resource => `<div class="resource-row">${icon(resource.icon, resource.tone)}<span>${tx(resource.label)}</span><div class="resource-track"></div><span class="resource-value">—</span></div>`).join("")}</div><span class="data-note">${icon("dashed")}${tx("Aguardando dados de consumo")}</span></article>
      <article class="account-card billing-card"><div class="card-title"><span class="icon-tile cyan">${icon("card")}</span><span>${tx("Faturamento")}</span><a href="#faturamento" aria-label="${tx("Ver faturamento")}">${icon("arrow-up-right")}</a></div><div class="billing-content"><small>${tx("Próxima cobrança")}</small><h3>— <span>${tx("/ não disponível")}</span></h3><p>${tx("Nenhuma informação de cobrança conectada.")}</p></div>${link("faturamento", "", "card-bottom-link", `${icon("card")}${tx("Pagamentos e faturas")}${icon("chevron-right")}`)}</article></div>
      <div class="dashboard-grid"><section class="account-card chart-card"><div class="chart-heading"><div><h2>${icon("chart", "cyan")}${tx("Atividade de consumo")}</h2><p>${tx("Uma visão dos seus recursos ao longo do tempo.")}</p></div><span class="period-label">${icon("calendar")}${tx("Este mês")}</span></div><div class="chart-legend">${resources.map(resource => `<span><i class="legend-${resource.tone}"></i>${tx(resource.label)}</span>`).join("")}</div>${chart()}${link("consumo", "", "chart-detail", `${tx("Explorar consumo")}${icon("arrow-right")}`)}</section>
      <section class="account-card security-summary"><div class="card-title"><span class="icon-tile mint">${icon("shield")}</span><span>${tx("Sua segurança")}</span><a href="#seguranca" aria-label="${tx("Ver segurança")}">${icon("arrow-up-right")}</a></div><div class="security-emblem">${icon("shield")}</div><h3>${tx("Seu acesso. Seu controle.")}</h3><p>${tx("Mantenha sua identidade protegida em todos os seus dispositivos.")}</p><div class="security-row">${icon("lock")}<span>${tx("Verificação em duas etapas")}</span><span>—</span></div><div class="security-row">${icon("fingerprint")}<span>${tx("Sessões e dispositivos")}</span><span>—</span></div>${link("seguranca", "", "button outline", `${tx("Gerenciar segurança")}${icon("arrow-right")}`)}</section></div>
      <div class="section-heading management-heading"><h2>${tx("Gerencie sua conta")}</h2><span>${tx("Todo o controle, em um lugar.")}</span></div><section class="management-grid">${sections.filter(section => !["visao-geral", "assinatura", "suporte"].includes(section.id)).map(section => `<a href="#${section.id}" class="management-card"><span class="management-icon">${icon(section.icon)}</span><div><h3>${tx(section.title)}</h3><p>${tx(section.description)}</p></div>${icon("chevron-right")}</a>`).join("")}</section>
      <section class="connection-notice">${icon("info")}<div><strong>${tx("Sua identidade e seus serviços.")}</strong><p>${tx("A sessão usa o serviço oficial de identidade. Perfil completo, assinatura e consumo aguardam suas integrações.")}</p></div><span>${icon("sparkles")}${tx("O seu universo está pronto")}</span></section>`;
  }

  function personal() {
    return `<section class="settings-section"><div class="settings-title"><h2>${tx("Seu perfil")}</h2><p>${tx("Uma identidade em todo o ecossistema OrdaX.")}</p></div><div class="profile-edit"><span class="large-avatar">${icon("user")}</span><div><h3>${tx("Foto de perfil")}</h3><p>${tx("Sua imagem no OrdaX Web e OS.")}</p>${action("Alterar foto", "camera", { small: true })}</div></div><div class="form-grid">${field("Nome completo", "Seu nome")}${field("Nome de exibição", "Como você gostaria de ser chamado")}${field("E-mail", "Seu e-mail", "email")}${field("Telefone", "Seu telefone", "tel")}${field("País ou região", "Não disponível")}${field("Documento fiscal", "Não disponível")}</div><div class="form-actions"><span>${icon("lock")}${tx("Seus dados pessoais permanecem protegidos.")}</span>${action("Salvar alterações", null, { variant: "" })}</div></section>`;
  }
  function subscription() {
    return `<section class="subscription-banner"><img class="subscription-landscape" src="${LANDSCAPE}" width="1920" height="640" alt="${tx("Universo OrdaX")}"><div><span class="eyebrow">${icon("crown")}${tx("SUA ASSINATURA ORDAX")}</span><h2>${tx("Seu universo de possibilidades.")}</h2><p>${tx("Informações de plano, benefícios e renovação estarão reunidas aqui.")}</p><span class="profile-label">${tx("Plano não disponível")}</span></div><img class="subscription-mark" src="${MARK}" width="180" height="180" alt="${tx("Símbolo OrdaX")}"></section><section class="settings-section"><div class="settings-title"><h2>${tx("Detalhes da assinatura")}</h2><p>${tx("Sem plano ou cobrança presumidos.")}</p></div><div class="detail-facts">${["Plano contratado", "Ciclo de cobrança", "Próxima renovação", "Valor da assinatura"].map(label => `<div><span>${tx(label)}</span><strong>${tx("Não disponível")}</strong></div>`).join("")}</div><div class="form-actions">${action("Alterar plano")}${action("Cancelar assinatura", null, { variant: "ghost" })}</div></section><section class="settings-section"><h2>${tx("Planos e benefícios")}</h2>${document.getElementById("account-plan-catalog")?.innerHTML || ""}<p class="text-muted-foreground">${tx("Preços e limites comerciais")}: ${tx("Não disponível")}</p></section>`;
  }
  function consumption() {
    return `<div class="consumption-toolbar"><div class="segment-tabs" role="tablist" aria-label="${tx("Consumo e limites")}">${Object.entries(resourceTabs).map(([key, title]) => `<button type="button" class="button ghost${state.tab === key ? " selected" : ""}" role="tab" id="usage-tab-${key}" data-usage-tab="${key}" aria-selected="${state.tab === key}" aria-controls="usage-panel" tabindex="${state.tab === key ? "0" : "-1"}">${tx(title)}</button>`).join("")}</div>${selectPeriod("usage-period", state.period)}</div><div id="usage-panel" role="tabpanel" aria-labelledby="usage-tab-${state.tab}"><div class="consumption-stats">${resources.filter(resource => state.tab === "overview" || resource.id === state.tab).map(resource => `<article class="account-card stat-card">${icon(resource.icon)}<span>${tx(resource.name)}</span><strong>—</strong><small>${tx("Uso e limite indisponíveis")}</small><div class="resource-track"></div></article>`).join("")}</div><section class="account-card chart-card"><div class="chart-heading"><div><h2>${tx("Utilização")} · ${tx(resourceTabs[state.tab])}</h2><p>${tx(periods[state.period])} · ${tx("Sem dados conectados")}</p></div>${action("Exportar", "download", { small: true })}</div>${chart(state.period)}</section></div><div class="inline-notice">${icon("info")}${tx("Os filtros alteram o período de consulta. Nenhuma métrica é estimada sem dados oficiais.")}</div>`;
  }
  function billing() {
    return `<div class="billing-overview"><section class="account-card"><h2>${tx("Próxima cobrança")}</h2><h3 class="billing-large">—</h3><p class="text-muted-foreground text-sm">${tx("Valor e data não disponíveis")}</p></section><section class="account-card"><div class="flex items-center justify-between"><h2>${tx("Método de pagamento")}</h2>${icon("card", "cyan")}</div><p class="my-5 text-muted-foreground text-sm">${tx("Nenhum método disponível para consulta.")}</p>${action("Adicionar método")}</section></div><section class="settings-section"><div class="settings-title"><h2>${tx("Histórico de faturamento")}</h2>${action("Baixar faturas", "download", { small: true })}</div><div class="table-header">${["Documento", "Data", "Valor", "Status"].map(label => `<span>${tx(label)}</span>`).join("")}</div>${empty("Nenhuma fatura disponível", "Faturas, recibos e histórico de cobranças aparecerão após a conexão com o faturamento.")}</section><section class="settings-section"><h2>${tx("Dados fiscais")}</h2><div class="form-grid mt-6">${["Nome ou razão social", "CPF ou CNPJ", "Endereço de faturamento", "E-mail de faturamento"].map(label => field(label, "Não disponível", label === "E-mail de faturamento" ? "email" : "text")).join("")}</div><div class="mt-5">${action("Salvar dados fiscais", null, { variant: "" })}</div></section>`;
  }
  function security() {
    return `${sessionSection()}<section class="settings-section">${[{ icon: "lock", title: "Senha de acesso", description: "Altere a senha que protege sua conta.", action: "Alterar senha" }, { icon: "shield", title: "Verificação em duas etapas", description: "Uma camada extra de proteção para sua identidade.", action: "Configurar", status: true }, { icon: "mail", title: "Recuperação da conta", description: "Gerencie o e-mail de recuperação da sua conta.", action: "Gerenciar" }].map(row => `<div class="setting-row"><span class="management-icon">${icon(row.icon)}</span><div><h2>${tx(row.title)}</h2><p>${tx(row.description)}</p>${row.status ? `<small>${tx("Status não disponível")}</small>` : ""}</div>${action(row.action)}</div>`).join("")}</section><section class="settings-section"><h2>${tx("Histórico de acesso")}</h2>${empty("Histórico de segurança não disponível", "Os eventos de acesso serão consultados pelo serviço de identidade OrdaX.", "history")}</section>`;
  }
  function devices() {
    return `<section class="settings-section"><div class="settings-title"><div><h2>${tx("Dispositivos autorizados")}</h2><p>${tx("OrdaX OS, Web e dispositivos móveis.")}</p></div>${action("Encerrar outras sessões")}</div>${empty("Nenhuma sessão disponível para consulta", "A sessão atual não identifica todos os dispositivos. A lista depende do serviço público de dispositivos OrdaX.", "devices")}</section>`;
  }
  function privacy() {
    return `<section class="settings-section"><h2>${tx("Privacidade e consentimentos")}</h2>${[{ title: "Dados essenciais", description: "Dados necessários para o funcionamento e a segurança da conta." }, { title: "Análise de uso", description: "Consentimento para informações que ajudam a melhorar o OrdaX." }, { title: "Comunicações personalizadas", description: "Preferências de comunicação vinculadas à sua identidade." }].map(row => `<div class="setting-row">${icon("fingerprint")}<div><h3>${tx(row.title)}</h3><p>${tx(row.description)}</p></div><span class="text-muted-foreground text-xs">${tx("Não disponível")}</span></div>`).join("")}</section><section class="settings-section"><div class="setting-row">${icon("download", "cyan")}<div><h2>${tx("Exportar meus dados")}</h2><p>${tx("Uma cópia das suas informações pessoais e do histórico da conta.")}</p></div>${action("Solicitar exportação")}</div></section><section class="settings-section danger-section"><div class="setting-row">${icon("trash")}<div><h2>${tx("Excluir conta")}</h2><p>${tx("A exclusão permanente requer autenticação e confirmação da sua identidade.")}</p></div>${action("Excluir minha conta", null, { variant: "destructive" })}</div></section>`;
  }
  function preferences() {
    const locales = window.OrdaXPublicI18nCatalog?.supportedLocales ?? [];
    const choices = [{ id: "security", title: "Segurança da conta", description: "Alertas de acesso e alterações importantes." }, { id: "usage", title: "Consumo e assinatura", description: "Atualizações de recursos, limites e faturamento." }, { id: "news", title: "Novidades OrdaX", description: "Lançamentos e novidades do ecossistema." }];
    return `<section class="settings-section"><div class="setting-row">${icon("globe", "cyan")}<div><h2>${tx("Idioma e região")}</h2><p>${tx("O idioma deste navegador é salvo pelas preferências oficiais do site.")}</p></div><select id="account-locale" aria-label="${tx("Idioma preferido")}">${locales.map(locale => `<option value="${esc(locale)}"${i18n.getLocale() === locale ? " selected" : ""}>${message(`locale.selector.${locale}`)}</option>`).join("")}</select></div><div class="setting-row">${icon("devices", "cyan")}<div><h2>${tx("Aparência")}</h2><p>${tx("Identidade visual OrdaX.")}</p></div><span class="profile-label">${tx("Escuro")}</span></div></section><section class="settings-section"><h2>${tx("Notificações e comunicações")}</h2><p class="text-muted-foreground">${tx("Preferências da conta estarão disponíveis quando o serviço oficial estiver conectado.")}</p>${choices.map(choice => `<div class="setting-row">${icon("bell")}<div><h3>${tx(choice.title)}</h3><p>${tx(choice.description)}</p></div><span class="text-muted-foreground text-xs">${tx("Não disponível")}</span></div>`).join("")}</section>`;
  }
  function activity() {
    const period = (i18n?.fromSource(periods[state.activityPeriod]) ?? periods[state.activityPeriod]).toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR");
    const description = message("account.activity.period", { period });
    return `<section class="settings-section"><div class="settings-title"><h2>${tx("Histórico da conta")}</h2>${selectPeriod("activity-period", state.activityPeriod, false)}</div><div class="empty-state"><span class="empty-icon">${icon("history")}</span><h3>${tx("Nenhuma atividade disponível")}</h3><p>${description}</p><span class="unavailable-chip"><span></span>${tx("Serviços não conectados")}</span></div></section>`;
  }
  function faqContent() {
    const query = state.helpQuery.toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR").trim();
    const matches = faqs.map((faq, index) => ({ ...faq, index })).filter(faq => ((i18n?.fromSource(faq.q) ?? faq.q) + " " + (i18n?.fromSource(faq.a) ?? faq.a)).toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR").includes(query));
    return matches.length ? matches.map(faq => `<div><button type="button" class="button ghost" data-faq="${faq.index}" aria-expanded="${state.faq === faq.index}" aria-controls="faq-answer-${faq.index}">${tx(faq.q)}${icon("chevron-down")}</button><p id="faq-answer-${faq.index}"${state.faq === faq.index ? "" : " hidden"}>${tx(faq.a)}</p></div>`).join("") : `<p class="py-8 text-muted-foreground">${tx("Nenhuma resposta encontrada. Tente outro termo.")}</p>`;
  }
  function support() {
    return `<section class="help-search">${icon("help")}<h2>${tx("Como podemos ajudar?")}</h2><label class="search-field">${icon("search")}<input id="help-search" type="search" value="${esc(state.helpQuery)}" placeholder="${tx("Busque por assinatura, segurança, faturas...")}" aria-label="${tx("Buscar ajuda")}" autocomplete="off"></label></section><section class="settings-section"><h2>${tx("Perguntas frequentes")}</h2><div class="faq-list" id="faq-list">${faqContent()}</div></section><section class="support-contact"><span class="management-icon">${icon("mail")}</span><div><h2>${tx("Precisa de uma ajuda a mais?")}</h2><p>${tx("Atendimento dedicado à sua conta OrdaX.")}</p></div>${`<button type="button" class="button outline" data-open-dialog="support">${tx("Falar com o suporte")}${icon("chevron-right")}</button>`}</section>`;
  }
  const views = { integracoes: () => empty("Integrações não disponíveis", "As conexões autorizadas serão exibidas pelo serviço oficial de integrações.", "globe"), "visao-geral": overview, "dados-pessoais": personal, assinatura: subscription, consumo: consumption, faturamento: billing, seguranca: security, dispositivos: devices, privacidade: privacy, preferencias: preferences, atividade: activity, suporte: support };

  function renderNavigation() {
    document.getElementById("sidebar-navigation").innerHTML = sections.filter(section => section.id !== "suporte").map((section, index) => `<a href="#${section.id}" title="${tx(section.title)}" aria-label="${tx(section.title)}" class="sidebar-link${state.section === section.id ? " active" : ""}${index === 5 ? " nav-separator" : ""}" data-section="${section.id}"${state.section === section.id ? ' aria-current="page"' : ""}>${icon(section.icon)}<span>${tx(section.title)}</span>${state.section === section.id ? '<span class="active-dot"></span>' : ""}</a>`).join("");
    const mobile = [{ id: "visao-geral", label: "Resumo" }, { id: "assinatura", label: "Assinatura" }, { id: "consumo", label: "Consumo" }, { id: "seguranca", label: "Segurança" }];
    document.getElementById("mobile-navigation").innerHTML = mobile.map(item => `<a href="#${item.id}"${state.section === item.id ? ' class="active" aria-current="page"' : ""}>${icon(byId.get(item.id).icon)}<span>${tx(item.label)}</span></a>`).join("") + `<button type="button" class="button ghost${mobile.some(item => item.id === state.section) ? "" : " active"}" id="more-toggle" data-open-more aria-controls="more-dialog" aria-expanded="${moreDialog.open}">${icon("more")}<span>${tx("Mais")}</span></button>`;
    document.getElementById("more-navigation").innerHTML = sections.slice(1).map(section => `<a href="#${section.id}"${state.section === section.id ? ' aria-current="page"' : ""}>${icon(section.icon)}${tx(section.title)}${icon("chevron-right")}</a>`).join("");
    const supportLink = root.querySelector('.sidebar-bottom [data-section="suporte"]');
    supportLink.classList.toggle("active", state.section === "suporte");
    if (state.section === "suporte") supportLink.setAttribute("aria-current", "page"); else supportLink.removeAttribute("aria-current");
  }
  function renderContent({ focus = false } = {}) {
    const section = byId.get(state.section);
    const header = state.section === "visao-geral" ? "" : `<header class="detail-page-heading"><span class="detail-heading-icon">${icon(section.icon)}</span><div><div class="eyebrow">${tx("CENTRAL DA CONTA")}</div><h1 tabindex="-1">${tx(section.title)}</h1><p>${tx(section.description)}</p></div></header>`;
    const notice = !["visao-geral", "suporte", "preferencias"].includes(state.section) ? `<div class="inline-notice">${icon("info")}<span>${tx("Alguns recursos desta seção ainda dependem de serviços públicos OrdaX. Assinatura, pagamentos e consumo não são presumidos.")}</span></div>` : "";
    document.getElementById("account-content").innerHTML = header + notice + integration(section) + views[state.section]();
    const crumb = document.getElementById("section-crumb");
    crumb.hidden = state.section === "visao-geral";
    crumb.innerHTML = state.section === "visao-geral" ? "" : `${icon("chevron-right")}<span>${tx(section.title)}</span>`;
    document.title = `${i18n?.fromSource(state.section === "visao-geral" ? "Minha Conta" : section.title) ?? section.title} — OrdaX OS`;
    if (focus) document.querySelector("#account-content h1")?.focus({ preventScroll: true });
  }
  function route({ initial = false } = {}) {
    let requested = location.hash.slice(1);
    try { requested = decodeURIComponent(requested); } catch { requested = ""; }
    if (requested === "conteudo") { document.getElementById("conteudo").focus(); return; }
    if (!byId.has(requested)) requested = "visao-geral";
    const changed = requested !== state.section;
    state.section = requested;
    closeMore();
    if (dialog.open) dialog.close();
    renderNavigation();
    renderContent({ focus: !initial });
    if (changed) window.scrollTo({ top: 0, behavior: "instant" });
  }

  const dialog = document.getElementById("account-dialog");
  const moreDialog = document.getElementById("more-dialog");
  function searchResults() {
    const query = state.searchQuery.toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR").trim();
    const found = sections.filter(section => (i18n?.fromSource(section.title) ?? section.title).toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR").includes(query));
    return found.length ? found.map(section => `<a href="#${section.id}">${icon(section.icon)}${tx(section.title)}${icon("chevron-right")}</a>`).join("") : `<p>${tx("Nenhuma área encontrada.")}</p>`;
  }
  function renderDialog() {
    const kind = state.dialog;
    const title = kind === "search" ? "Buscar na minha conta" : kind === "support" ? "Atendimento não conectado" : "Notificações";
    const description = kind === "search" ? "Encontre uma área da sua conta." : kind === "support" ? "O canal oficial de suporte ainda não foi configurado. Nenhuma solicitação foi enviada." : "O serviço de notificações ainda não está conectado.";
    document.getElementById("dialog-title").textContent = i18n?.fromSource(title) ?? title;
    document.getElementById("dialog-description").textContent = i18n?.fromSource(description) ?? description;
    document.getElementById("dialog-content").innerHTML = kind === "search" ? `<label class="search-field">${icon("search")}<span class="sr-only">${tx("Buscar na minha conta")}</span><input id="dialog-search" type="search" value="${esc(state.searchQuery)}" placeholder="${tx("O que você está procurando?")}" autocomplete="off" autofocus></label><div class="search-results" id="search-results">${searchResults()}</div>` : kind === "support" ? action("Entendi", null, { disabled: false, data: "data-close-dialog" }) : `<div class="empty-state compact">${icon("bell")}<h3>${tx("Nenhuma notificação disponível")}</h3><p>${tx("As notificações serão exibidas quando o serviço oficial estiver disponível.")}</p></div>${action("Entendi", null, { disabled: false, data: "data-close-dialog" })}`;
  }
  function openDialog(kind) {
    closeMore();
    state.dialog = kind;
    renderDialog();
    if (!dialog.open) dialog.showModal();
    if (kind === "search") document.getElementById("dialog-search").focus();
  }
  function closeMore() {
    if (moreDialog.open) moreDialog.close();
    document.getElementById("more-toggle")?.setAttribute("aria-expanded", "false");
  }
  dialog.addEventListener("close", () => { state.dialog = null; });
  moreDialog.addEventListener("close", () => { document.getElementById("more-toggle")?.setAttribute("aria-expanded", "false"); });
  dialog.addEventListener("click", event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });

  document.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const control = event.target.closest("button, a");
    if (!control) return;
    if (control.matches("[data-refresh-session]")) { void account.refreshSession(); }
    else if (control.matches("[data-open-dialog]")) openDialog(control.dataset.openDialog);
    else if (control.matches("[data-close-dialog]")) dialog.close();
    else if (control.matches("[data-open-more]")) { if (moreDialog.open) closeMore(); else { moreDialog.showModal(); control.setAttribute("aria-expanded", "true"); } }
    else if (control.matches("[data-close-more]")) closeMore();
    else if (control.id === "sidebar-toggle") {
      const collapsed = root.classList.toggle("sidebar-collapsed");
      const label = i18n?.fromSource(collapsed ? "Expandir menu" : "Recolher menu") ?? (collapsed ? "Expandir menu" : "Recolher menu");
      control.setAttribute("aria-expanded", String(!collapsed)); control.setAttribute("aria-label", label); control.title = label; control.innerHTML = icon(collapsed ? "panel-open" : "panel-close");
    } else if (control.matches("[data-usage-tab]")) {
      state.tab = control.dataset.usageTab; renderContent(); document.getElementById(`usage-tab-${state.tab}`).focus({ preventScroll: true });
    } else if (control.matches("[data-faq]")) {
      const index = Number(control.dataset.faq); state.faq = state.faq === index ? null : index;
      document.querySelectorAll("[data-faq]").forEach(button => {
        const expanded = state.faq === Number(button.dataset.faq);
        button.setAttribute("aria-expanded", String(expanded));
        document.getElementById(button.getAttribute("aria-controls")).hidden = !expanded;
      });
    } else if (control.matches('a[href^="#"]')) {
      if (dialog.open) dialog.close(); closeMore();
      if (control.getAttribute("href") === location.hash) route();
    }
  });
  document.addEventListener("input", event => {
    if (event.target.id === "dialog-search") { state.searchQuery = event.target.value; document.getElementById("search-results").innerHTML = searchResults(); }
    else if (event.target.id === "help-search") { state.helpQuery = event.target.value; document.getElementById("faq-list").innerHTML = faqContent(); }
  });
  document.addEventListener("change", event => {
    if (event.target.id === "usage-period") { state.period = event.target.value; renderContent(); document.getElementById("usage-period").focus({ preventScroll: true }); }
    else if (event.target.id === "activity-period") { state.activityPeriod = event.target.value; renderContent(); document.getElementById("activity-period").focus({ preventScroll: true }); }
    else if (event.target.id === "account-locale") i18n.setLocale(event.target.value);
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openDialog("search"); }
    const tab = event.target.closest("[data-usage-tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const keys = Object.keys(resourceTabs); const index = keys.indexOf(state.tab);
      state.tab = event.key === "Home" ? keys[0] : event.key === "End" ? keys[keys.length - 1] : keys[(index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length];
      renderContent(); document.getElementById(`usage-tab-${state.tab}`).focus({ preventScroll: true });
    }
  });
  window.addEventListener("hashchange", () => route());
  window.matchMedia("(min-width: 761px)").addEventListener("change", event => { if (event.matches) closeMore(); });
  document.addEventListener("ordax:localechange", () => {
    const focused = document.activeElement?.id;
    renderNavigation(); renderContent(); renderSession(); if (dialog.open) renderDialog();
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  });
  hydrateIcons();
  route({ initial: true });
  account.subscribe(value => {
    const focused = document.activeElement?.id;
    session = value;
    renderSession();
    renderContent();
    if (focused && !document.activeElement?.id) (document.getElementById(focused) || document.getElementById("session-status-title"))?.focus({ preventScroll: true });
  });
  void account.readSession();
})();
