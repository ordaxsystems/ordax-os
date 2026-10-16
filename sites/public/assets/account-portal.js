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
  const searchText = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(i18n.getLocale());
  const matchesSearch = (source, query) => {
    const text = searchText(source);
    return searchText(query).trim().split(/\s+/).filter(Boolean).every(term => text.includes(term));
  };
  const LANDSCAPE = "/assets/account-landscape.jpg";
  const layoutPreview = ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get("preview") === "layout";


  // Presentation metadata only; availability is derived from the existing owners.
  const capabilityDefinitions = Object.freeze({
    "accountEmail": {
      "title": "E-mail da conta"
    },
    "profileEdit": {
      "title": "Edição de dados cadastrais"
    },
    "profilePhoto": {
      "title": "Foto de perfil"
    },
    "subscription": {
      "title": "Plano contratado"
    },
    "planCatalog": {
      "title": "Catálogo oficial de planos"
    },
    "subscriptionChange": {
      "title": "Alteração e cancelamento"
    },
    "aiUsage": {
      "title": "Créditos de IA"
    },
    "storageUsage": {
      "title": "Armazenamento"
    },
    "apiUsage": {
      "title": "Chamadas de API"
    },
    "usageHistory": {
      "title": "Histórico por período"
    },
    "usageExport": {
      "title": "Exportação de consumo"
    },
    "upcomingCharge": {
      "title": "Próxima cobrança"
    },
    "paymentMethods": {
      "title": "Métodos de pagamento"
    },
    "invoices": {
      "title": "Faturas e recibos"
    },
    "fiscalDetails": {
      "title": "Dados fiscais"
    },
    "browserSession": {
      "title": "Sessão neste navegador"
    },
    "password": {
      "title": "Senha",
      "viewTitle": "Senha de acesso",
      "description": "Senha usada para entrar na sua conta.",
      "iconName": "lock",
      "action": "Alterar senha"
    },
    "twoFactor": {
      "title": "Verificação em duas etapas",
      "description": "Uma camada extra de proteção para sua identidade.",
      "iconName": "shield",
      "action": "Configurar",
      "hint": "Status não disponível"
    },
    "recovery": {
      "title": "Recuperação",
      "viewTitle": "Recuperação da conta",
      "description": "Gerencie o e-mail de recuperação da sua conta.",
      "iconName": "mail",
      "action": "Gerenciar"
    },
    "accessEvents": {
      "title": "Eventos de acesso"
    },
    "deviceSessions": {
      "title": "Sessões ativas"
    },
    "osDevices": {
      "title": "Dispositivos OrdaX OS"
    },
    "remoteSignOut": {
      "title": "Encerramento remoto"
    },
    "dataExport": {
      "title": "Exportação de dados",
      "viewTitle": "Exportar meus dados",
      "description": "Uma cópia das suas informações pessoais e do histórico da conta.",
      "iconName": "download",
      "action": "Solicitar exportação",
      "hint": "A solicitação de exportação aguarda integração."
    },
    "consents": {
      "title": "Consentimentos"
    },
    "accountDeletion": {
      "title": "Exclusão da conta",
      "viewTitle": "Excluir conta",
      "description": "A exclusão permanente requer autenticação e confirmação da sua identidade.",
      "iconName": "trash",
      "action": "Excluir minha conta",
      "hint": "A exclusão da conta ainda não está disponível.",
      "destructive": true
    },
    "connections": {
      "title": "Conexões autorizadas"
    },
    "connectionRevocation": {
      "title": "Revogação de conexões",
      "viewTitle": "Revogar conexões",
      "description": "Controle o acesso de aplicativos e serviços à sua conta.",
      "iconName": "lock",
      "action": "Revogar conexões",
      "hint": "A revogação de conexões aguarda integração."
    },
    "supportChannel": {
      "title": "Atendimento da conta"
    },
    "accountChanges": {
      "title": "Alterações de conta"
    },
    "activityPeriod": {
      "title": "Filtros por período"
    },
    "portalLocale": {
      "title": "Idioma do portal",
      "local": true
    },
    "portalAppearance": {
      "title": "Aparência do portal",
      "local": true
    },
    "communications": {
      "title": "Preferências de comunicação"
    }
  });

  // One catalog owns routes, navigation, descriptions and unavailable service presentation.
  const sections = Object.freeze([
    { id: "visao-geral", sessionDependent: true, title: "Visão geral", icon: "dashboard", description: "Sua identidade, assinatura e recursos em um só lugar." },
    { id: "dados-pessoais", sessionDependent: true, title: "Dados pessoais", icon: "user", description: "Seu perfil e suas informações cadastrais.", owner: "Identidade OrdaX", capabilities: ["accountEmail", "profileEdit", "profilePhoto"] },
    { id: "assinatura", title: "Plano e assinatura", icon: "crown", description: "Seu plano, benefícios e opções de assinatura.", owner: "Direitos e assinaturas OrdaX", capabilities: ["subscription", "planCatalog", "subscriptionChange"] },
    { id: "consumo", title: "Consumo e limites", icon: "chart", description: "Acompanhe seus recursos em todo o ecossistema OrdaX.", owner: "Medição de uso OrdaX", capabilities: ["aiUsage", "storageUsage", "apiUsage", "usageHistory", "usageExport"] },
    { id: "faturamento", title: "Pagamentos e faturas", icon: "card", description: "Métodos de pagamento, cobranças e documentos fiscais.", owner: "Faturamento OrdaX", capabilities: ["upcomingCharge", "paymentMethods", "invoices", "fiscalDetails"] },
    { id: "seguranca", sessionDependent: true, title: "Segurança e acesso", icon: "shield", description: "Proteja sua identidade e controle o acesso à sua conta.", owner: "Identidade OrdaX", capabilities: ["browserSession", "password", "twoFactor", "recovery", "accessEvents"] },
    { id: "dispositivos", sessionDependent: true, title: "Meus dispositivos", icon: "devices", description: "Dispositivos e sessões vinculados à sua conta.", owner: "Sessões e dispositivos OrdaX", capabilities: ["deviceSessions", "osDevices", "remoteSignOut"] },
    { id: "privacidade", title: "Dados e privacidade", icon: "fingerprint", description: "Seus dados, suas escolhas. Você está no controle.", owner: "Privacidade OrdaX", capabilities: ["dataExport", "consents", "accountDeletion"] },
    { id: "integracoes", title: "Integrações", icon: "globe", description: "Contas conectadas e autorizações de aplicativos.", owner: "Integrações OrdaX", capabilities: ["connections", "connectionRevocation"] },
    { id: "preferencias", title: "Preferências", icon: "sliders", description: "Personalize a experiência da sua conta.", owner: "Preferências OrdaX", capabilities: ["portalLocale", "portalAppearance", "communications"] },
    { id: "atividade", title: "Atividade da conta", icon: "history", description: "Histórico de acesso e alterações importantes.", owner: "Auditoria da conta OrdaX", capabilities: ["accessEvents", "accountChanges", "activityPeriod"] },
    { id: "suporte", title: "Central de ajuda", icon: "help", description: "Encontre respostas e cuide da sua experiência OrdaX.", capabilities: ["supportChannel"] }
  ]);
  const byId = new Map(sections.map(section => [section.id, section]));
  const navigationGroups = Object.freeze([
    { title: "Minha conta", ids: ["visao-geral", "dados-pessoais"] },
    { title: "Plano e serviços", ids: ["assinatura", "consumo", "faturamento"] },
    { title: "Segurança e privacidade", ids: ["seguranca", "dispositivos", "privacidade"] },
    { title: "Preferências e conexões", ids: ["integracoes", "preferencias", "atividade"] }
  ]);
  const mobileSections = Object.freeze([{ id: "visao-geral", label: "Resumo" }, { id: "assinatura", label: "Assinatura" }, { id: "consumo", label: "Consumo" }, { id: "seguranca", label: "Segurança" }]);
  const mobileSectionIds = new Set(mobileSections.map(section => section.id));
  const periods = Object.freeze({ month: "Este mês", week: "Últimos 7 dias", thirty: "Últimos 30 dias", year: "Este ano" });
  const resourceTabs = Object.freeze({ overview: "Visão geral", ai: "IA", storage: "Armazenamento", apis: "APIs" });
  const resources = Object.freeze([
    { id: "ai", capabilityId: "aiUsage", name: "Créditos de IA", label: "Inteligência artificial", icon: "cpu", tone: "violet" },
    { id: "storage", capabilityId: "storageUsage", name: "Armazenamento", label: "Armazenamento", icon: "disk", tone: "cyan" },
    { id: "apis", capabilityId: "apiUsage", name: "APIs e serviços", label: "APIs e serviços", icon: "zap", tone: "mint" }
  ]);
  const privacyOptions = Object.freeze([
    { title: "Dados essenciais", description: "Dados necessários para o funcionamento e a segurança da conta.", iconName: "lock" },
    { title: "Análise de uso", description: "Consentimento para informações que ajudam a melhorar o OrdaX.", iconName: "chart" },
    { title: "Comunicações personalizadas", description: "Preferências de comunicação vinculadas à sua identidade.", iconName: "mail", related: "preferencias" }
  ]);
  const communicationOptions = Object.freeze([
    { title: "Segurança da conta", description: "Alertas de acesso e alterações importantes.", iconName: "shield" },
    { title: "Consumo e assinatura", description: "Atualizações de recursos, limites e faturamento.", iconName: "chart" },
    { title: "Novidades OrdaX", description: "Lançamentos e novidades do ecossistema.", iconName: "sparkles" }
  ]);
  const faqs = Object.freeze([
    { id: "plan", section: "assinatura", q: "Onde encontro meu plano e minha assinatura?", a: "A seção Plano e assinatura reunirá seu plano e seus benefícios quando o serviço oficial estiver disponível." },
    { id: "usage", section: "consumo", q: "Como acompanho meu consumo de IA?", a: "Em Consumo e limites, escolha o recurso e o período que deseja consultar. Os valores serão exibidos quando a medição de uso estiver conectada." },
    { id: "billing", section: "faturamento", q: "Como acesso minhas faturas?", a: "Pagamentos e faturas reúne documentos fiscais e cobranças. Faturas e recibos poderão ser baixados quando o serviço de faturamento estiver integrado." },
    { id: "security", section: "seguranca", q: "Como protejo minha conta?", a: "Consulte a sessão deste navegador em Segurança e acesso. Alteração de senha, verificação em duas etapas e recuperação ainda aguardam integração." },
    { id: "privacy", section: "privacidade", q: "Posso exportar ou excluir meus dados?", a: "Os controles ficam em Dados e privacidade. Para sua proteção, a exportação e a exclusão exigem uma conta autenticada e o serviço de privacidade conectado." }
  ]);
  const state = { section: "visao-geral", period: "month", activityPeriod: "month", tab: "overview", faq: "plan", helpQuery: "", searchQuery: "", dialog: null };
  let session = account.getSnapshot();
  let disposeMenu = () => {};
  const signedIn = () => !layoutPreview && session.status === "authenticated";
  const sessionKey = () => session.status === "authenticated" ? "active" : session.status;
  const sessionTitle = () => layoutPreview ? tx("Prévia local da Conta") : message(`account.session.${sessionKey()}.title`);

  function capabilityState(id) {
    const definition = capabilityDefinitions[id];
    if (!definition) throw new Error("public-account-capability-unknown");
    const verified = signedIn() && (id === "browserSession" || (id === "accountEmail" && Boolean(session.email)));
    const status = definition.local ? "local" : verified ? "verified" : "pending";
    return { ...definition, id, status };
  }
  function capabilityLabel(status, compact = false) {
    return status === "local" ? "Neste navegador" : status === "verified" ? "Verificado" : compact ? "Não disponível" : "Aguardando serviço";
  }
  function capabilityBadge(id) {
    const capability = capabilityState(id);
    return `<span class="status-tag${capability.status === "local" ? " is-local" : capability.status === "verified" ? " is-verified" : ""}">${tx(capabilityLabel(capability.status, true))}</span>`;
  }
  function panelHeading(title, { iconName = "", tone = "", end = "", id = "" } = {}) {
    return `<header class="panel-heading"><div>${iconName ? `<span class="icon-tile ${esc(tone)}">${icon(iconName)}</span>` : ""}<h2${id ? ` id="${esc(id)}"` : ""}>${tx(title)}</h2></div>${end}</header>`;
  }
  function settingRow({ title, description, iconName = "sliders", control = "", hint = "", status = "", id = "", destructive = false }) {
    return `<div class="setting-row${destructive ? " is-danger" : ""}"><span class="management-icon">${icon(iconName)}</span><div><div class="setting-title"><h3>${tx(title)}</h3>${status}</div><p>${tx(description)}</p>${hint ? `<small${id ? ` id="${esc(id)}-hint"` : ""}>${tx(hint)}</small>` : ""}</div>${control}</div>`;
  }

  function operationRow(id) {
    const definition = capabilityDefinitions[id];
    return settingRow({ ...definition, id, title: definition.viewTitle || definition.title, status: capabilityBadge(id), control: action(definition.action, null, { variant: definition.destructive ? "destructive" : "outline", describedBy: `${id}-hint` }) });
  }

  function renderSession() {
    const trigger = document.getElementById("profile-menu-trigger");
    if (layoutPreview) {
      // Preview is a presentation state, never an authenticated session model.
      disposeMenu();
      trigger.disabled = true;
      document.getElementById("profile-menu-label").textContent = i18n.fromSource("Prévia da conta");
      trigger.setAttribute("aria-label", i18n.fromSource("Prévia da conta"));
      const panel = document.getElementById("account-session");
      panel.dataset.status = "preview";
      panel.innerHTML = `<div class="session-information">${icon("info")}<div><strong role="status" id="session-status-title" tabindex="-1">${tx("Prévia local da Conta")}</strong><p>${tx("Somente visualização. Recursos pendentes estão sinalizados nas seções.")}</p></div></div><a href="/login/?preview=layout" class="button outline h-8">${tx("Ver tela de acesso")}${icon("arrow-right")}</a>`;
      const footer = document.getElementById("session-footer-status");
      footer.dataset.status = "preview";
      footer.innerHTML = `<span></span>${tx("Somente leitura")}`;
      return;
    }
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

  function sessionSection({ related = "dispositivos" } = {}) {
    const verified = capabilityState("browserSession").status === "verified";
    const status = verified ? "Sessão verificada" : layoutPreview ? "Somente leitura" : "Sessão não verificada";
    return `<section class="settings-section security-session" aria-labelledby="browser-session-heading">
      ${panelHeading("Sessão neste navegador", { id: "browser-session-heading", iconName: "globe", tone: "mint", end: `<span class="status-tag${verified ? " is-verified" : ""}">${tx(status)}</span>` })}
      <div class="current-session"><span class="session-device-icon" aria-hidden="true">${icon("globe")}</span><div><strong role="status" aria-live="polite" aria-atomic="true">${sessionTitle()}</strong>${verified && session.email ? `<p class="verified-email" translate="no">${esc(session.email)}</p>` : ""}<p>${tx(layoutPreview ? "A prévia não representa uma sessão autenticada." : "Esta consulta confirma apenas a sessão atual. Não lista outros dispositivos.")}</p></div></div>
      <p class="session-scope-note" id="browser-session-scope">${icon("info")}${tx("Esta sessão não informa o estado da senha, da verificação em duas etapas ou de outros acessos.")}</p>
      <div class="panel-actions">${action("Verificar sessão", "refresh", { disabled: layoutPreview || !["authenticated", "anonymous", "unavailable"].includes(session.status), data: 'data-refresh-session id="security-session-retry"', describedBy: "browser-session-scope" })}${link(related, "", "text-link", `${tx(byId.get(related).title)}${icon("arrow-right")}`)}</div>
      ${verified ? `<p class="session-help">${tx("Para encerrar esta sessão, abra seu perfil no cabeçalho e escolha Sair da conta.")}</p>` : ""}
    </section>`;
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
  function action(label, iconName, { disabled = true, variant = "outline", small = false, data = "", describedBy = "" } = {}) {
    return `<button type="button" class="button ${esc(variant)}${small ? " h-8" : ""}"${disabled ? " disabled" : ""}${describedBy ? ` aria-describedby="${esc(describedBy)}"` : ""}${data ? ` ${data}` : ""}>${iconName ? icon(iconName) : ""}${tx(label)}</button>`;
  }
  function empty(title, description, iconName = "document", compact = false) {
    return `<div class="empty-state${compact ? " compact" : ""}"><span class="empty-icon">${icon(iconName)}</span><h3>${tx(title)}</h3><p>${tx(description)}</p><span class="unavailable-chip"><span></span>${tx("Serviços não conectados")}</span></div>`;
  }
  function searchControl({ id, value, label, placeholder, resultsId, clearId = `${id}-clear`, clearLabel = "Limpar busca", describedBy = "" }) {
    return `<div class="account-search-control"><label class="search-field">${icon("search")}<span class="sr-only">${tx(label)}</span><input id="${esc(id)}" type="search" value="${esc(value)}" placeholder="${tx(placeholder)}" aria-controls="${esc(resultsId)}"${describedBy ? ` aria-describedby="${esc(describedBy)}"` : ""} autocomplete="off"></label><button type="button" class="button ghost icon-button search-clear" id="${esc(clearId)}" data-clear-search="${esc(id)}" aria-label="${tx(clearLabel)}" aria-controls="${esc(resultsId)}"${value ? "" : " hidden"}>${icon("close")}</button></div>`;
  }
  function pendingRecords({ caption, columns, title, description, iconName = "document" }) {
    return `<table class="records-table"><caption class="sr-only">${tx(caption)}</caption><thead><tr>${columns.map(label => `<th scope="col">${tx(label)}</th>`).join("")}</tr></thead><tbody><tr><td colspan="${columns.length}">${empty(title, description, iconName, true)}</td></tr></tbody></table>`;
  }
  function field(label, placeholder, type = "text", capabilityId = "", { id = "", hint = "" } = {}) {
    const emailAvailable = capabilityId === "accountEmail" && capabilityState(capabilityId).status === "verified";
    const note = emailAvailable ? "E-mail da sessão atual. A alteração ainda não está disponível." : hint;
    const labelId = id ? `${id}-label` : "";
    const hintId = id && note ? `${id}-hint` : "";
    const describedBy = [hintId, "account-resource-state"].filter(Boolean).join(" ");
    return `<label class="form-field"><span${labelId ? ` id="${esc(labelId)}"` : ""}>${tx(label)}</span><input${id ? ` id="${esc(id)}"` : ""} type="${esc(type)}"${emailAvailable ? ` value="${esc(session.email)}" readonly` : ` placeholder="${tx(placeholder)}" disabled`} autocomplete="off"${labelId ? ` aria-labelledby="${esc(labelId)}"` : ""} aria-describedby="${esc(describedBy)}">${note ? `<small${hintId ? ` id="${esc(hintId)}"` : ""}>${tx(note)}</small>` : ""}</label>`;
  }
  function selectPeriod(id, value, all = true) {
    return `<label class="period-filter"><span>${tx(id === "activity-period" ? "Período de atividade" : "Período de consumo")}</span><span class="period-select"><select id="${id}" data-period="${id}">${Object.entries(periods).filter(([key]) => all || key !== "year").map(([key, label]) => `<option value="${key}"${value === key ? " selected" : ""}>${tx(label)}</option>`).join("")}</select>${icon("chevron-down")}</span></label>`;
  }
  function chart(period = "month", resource = resourceTabs.overview) {
    const translatedPeriod = (i18n?.fromSource(periods[period]) ?? periods[period]).toLocaleLowerCase(i18n?.getLocale() ?? "pt-BR");
    return `<div class="usage-chart" role="img" aria-label="${message("account.usage.chartContext", { resource: i18n.fromSource(resource), period: translatedPeriod })}"><div class="chart-field"><div class="chart-grid" aria-hidden="true"></div><div class="chart-empty">${icon("chart")}<span>${tx("Seu consumo aparecerá aqui")}</span><small>${message("account.usage.unavailablePeriod", { period: translatedPeriod })}</small></div></div></div>`;
  }
  function integration(section) {
    if (!section.owner) return "";
    const capabilities = section.capabilities.map(capabilityState);
    const verified = capabilities.some(capability => capability.status === "verified");
    const local = capabilities.some(capability => capability.status === "local");
    const pending = capabilities.some(capability => capability.status === "pending");
    const label = verified ? pending ? "Conexão parcial" : "Recursos verificados" : local ? "Preferências locais" : "Recursos pendentes";
    const description = local ? "Os recursos marcados como pendentes ainda aguardam integração. As preferências locais valem somente neste navegador." : "Os recursos marcados como pendentes ainda aguardam integração.";
    return `<details class="integration-panel" open><summary class="integration-head"><span class="integration-icon">${icon("plug")}</span><span class="min-w-0"><small>${tx("RECURSOS DESTA SEÇÃO")}</small><strong class="integration-heading">${tx(section.owner)}</strong></span><span class="integration-status${verified ? " ok" : local ? " local" : ""}"><span></span>${tx(label)}</span><span class="integration-toggle" aria-hidden="true">${icon("chevron-down")}</span></summary><p class="integration-description" id="account-resource-state">${tx(description)}</p><ul class="integration-caps">${capabilities.map(capability => `<li>${icon(capability.status === "verified" ? "shield" : capability.status === "local" ? "devices" : "dashed")}<span>${tx(capability.title)}</span><em>${tx(capabilityLabel(capability.status))}</em></li>`).join("")}</ul></details>`;
  }

  function resourceTable({ showUsage = true } = {}) {
    const columns = showUsage ? ["Recurso", "Uso", "Limite"] : ["Recurso", "Limite"];
    return `<table class="resource-table"><caption class="sr-only">${tx(showUsage ? "Consumo e limites" : "Limites da conta")}</caption><thead><tr>${columns.map(title => `<th scope="col">${tx(title)}</th>`).join("")}</tr></thead><tbody>${resources.map(resource => `<tr><th scope="row"><span class="resource-name">${icon(resource.icon, resource.tone)}<span>${tx(resource.name)}</span></span></th>${columns.slice(1).map(() => `<td><span aria-label="${tx("Não disponível")}">—</span></td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function planCatalog() {
    const template = document.getElementById("account-plan-catalog");
    // Names come exclusively from the catalog inserted by the existing public builder.
    const names = Array.from(template?.content.querySelectorAll(".plan-catalog li") ?? [], node => node.textContent.trim()).filter(Boolean);
    if (!names.length) return empty("Catálogo de planos indisponível", "Os planos e benefícios serão exibidos aqui quando o catálogo oficial estiver disponível.", "crown", true);
    return `<ul class="plan-catalog">${names.map(name => `<li><span class="status-tag">${tx("Em preparação")}</span><h3 translate="no">${esc(name)}</h3><p class="plan-price">${tx("Preço não publicado")}</p><p class="plan-detail">${tx("Os benefícios e limites comerciais ainda não estão disponíveis para consulta.")}</p>${action("Selecionar plano", null, { small: true })}</li>`).join("")}</ul>`;
  }

  function overview() {
    const quickLinks = ["preferencias", "privacidade", "integracoes", "atividade"];
    return `<header class="account-intro"><div><h1 tabindex="-1">${tx("Minha Conta")}</h1><p>${tx("Seu perfil, seus serviços e suas escolhas.")}</p></div>${link("dados-pessoais", "", "button outline", `${icon("user")}${tx("Dados pessoais")}`)}</header>
      <section class="identity-card" aria-labelledby="overview-profile-title">
        <div class="identity-content"><span class="eyebrow">${tx("SEU PERFIL ORDAX")}</span><div class="identity-person"><span class="identity-avatar">${icon("user")}</span><div><h2 id="overview-profile-title">${tx("Sua conta OrdaX")}</h2><p class="verified-email"${signedIn() && session.email ? ' translate="no"' : ""}>${signedIn() && session.email ? esc(session.email) : tx("E-mail não disponível")}</p></div></div><div class="identity-bottom"><dl><div><dt>${tx("Tipo de conta")}</dt><dd>${tx("Não disponível")}</dd></div><div><dt>${tx("Membro desde")}</dt><dd>${tx("Não disponível")}</dd></div></dl>${link("dados-pessoais", "", "text-link", `${tx("Ver perfil")}${icon("arrow-right")}`)}</div></div>
        <div class="identity-art" aria-hidden="true"><img src="${LANDSCAPE}" width="1920" height="640" alt=""><span>${tx("Uma conta.")}<br>${tx("Todos os seus mundos.")}</span></div>
      </section>
      <div class="account-overview-grid"><div class="overview-primary">
        <section class="account-card account-services">${panelHeading("Plano e faturamento", { iconName: "crown", tone: "violet", end: `<span class="status-tag">${tx("Recursos pendentes")}</span>` })}<dl class="service-facts">${["Plano atual", "Próxima renovação", "Próxima cobrança"].map(label => `<div><dt>${tx(label)}</dt><dd>${tx("Não disponível")}</dd></div>`).join("")}</dl><div class="panel-actions">${link("assinatura", "", "button", `${tx("Ver assinatura")}${icon("arrow-right")}`)}${link("faturamento", "", "text-link", `${tx("Pagamentos e faturas")}${icon("chevron-right")}`)}</div></section>
        <section class="account-card account-usage">${panelHeading("Consumo de recursos", { iconName: "chart", tone: "cyan", end: `${link("consumo", "", "text-link", `${tx("Ver detalhes")}${icon("arrow-up-right")}`)}` })}${resourceTable()}<p class="data-note">${icon("info")}${tx("Aguardando dados de consumo")}</p><details class="usage-history"><summary>${icon("history")}<span>${tx("Histórico de consumo")}</span>${icon("chevron-down")}</summary><div class="chart-legend">${resources.map(resource => `<span><i class="legend-${resource.tone}"></i>${tx(resource.label)}</span>`).join("")}</div>${chart()}${link("consumo", "", "text-link", `${tx("Explorar consumo")}${icon("arrow-right")}`)}</details></section>
      </div><aside class="overview-aside" aria-label="${tx("Acesso e preferências")}">
        <section class="account-card account-safety">${panelHeading("Segurança e acesso", { iconName: "shield", tone: "mint" })}<p class="panel-description">${tx("Cuide do acesso à sua conta e dos dispositivos conectados.")}</p><dl class="safety-facts"><div><dt>${tx("Verificação em duas etapas")}</dt><dd>${tx("Não disponível")}</dd></div><div><dt>${tx("Sessões e dispositivos")}</dt><dd>${tx("Não disponível")}</dd></div></dl>${link("seguranca", "", "button outline", `${tx("Gerenciar segurança")}${icon("arrow-right")}`)}${link("dispositivos", "", "text-link", `${tx("Meus dispositivos")}${icon("chevron-right")}`)}</section>
        <section class="account-card quick-links"><h2>${tx("Preferências e dados")}</h2><nav aria-label="${tx("Preferências e dados")}">${quickLinks.map(id => { const section = byId.get(id); return link(id, "", "quick-link", `${icon(section.icon)}<span>${tx(section.title)}</span>${icon("chevron-right")}`); }).join("")}</nav></section>
      </aside></div>
      <section class="account-help-strip">${icon("help")}<div><h2>${tx("Precisa de ajuda?")}</h2><p>${tx("Encontre respostas sobre sua conta, assinatura e segurança.")}</p></div>${link("suporte", "", "text-link", `${tx("Central de ajuda")}${icon("arrow-right")}`)}</section>`;
  }

  function personal() {
    return `<section class="settings-section personal-photo" aria-labelledby="personal-photo-heading">
      ${panelHeading("Seu perfil", { id: "personal-photo-heading", iconName: "user", tone: "cyan", end: capabilityBadge("profilePhoto") })}
      <div class="profile-edit"><span class="large-avatar" aria-hidden="true">${icon("user")}</span><div><h3>${tx(capabilityDefinitions.profilePhoto.title)}</h3><p>${tx("Uma imagem para identificar seu perfil nos serviços OrdaX.")}</p><small id="profile-photo-status">${tx("A alteração da foto aguarda integração.")}</small></div>${action("Alterar foto", "camera", { small: true, describedBy: "profile-photo-status" })}</div>
    </section>
    <section class="settings-section personal-info" aria-labelledby="personal-info-heading">
      ${panelHeading("Informações pessoais", { id: "personal-info-heading", iconName: "user", tone: "cyan", end: capabilityBadge("profileEdit") })}<p class="panel-description">${tx("Como você se identifica nos serviços OrdaX.")}</p>
      <div class="form-grid">${field("Nome completo", "Não disponível", "text", "", { id: "profile-full-name" })}${field("Nome de exibição", "Não disponível", "text", "", { id: "profile-display-name", hint: "Nome pelo qual você prefere ser chamado." })}${field("País ou região", "Não disponível", "text", "", { id: "profile-country" })}${field("Documento fiscal", "Não disponível", "text", "", { id: "profile-tax-document" })}</div>
    </section>
    <section class="settings-section personal-contact" aria-labelledby="personal-contact-heading">
      ${panelHeading("Contato", { id: "personal-contact-heading", iconName: "mail", tone: "cyan" })}<p class="panel-description">${tx("Seu e-mail de acesso e suas informações de contato.")}</p>
      <div class="form-grid">${field("E-mail", "Não disponível", "email", "accountEmail", { id: "profile-email", hint: "O e-mail será exibido quando a consulta da conta estiver disponível." })}${field("Telefone", "Não disponível", "tel", "", { id: "profile-phone", hint: "A consulta e a edição do telefone aguardam integração." })}</div>
    </section>
    <div class="form-actions personal-actions"><span id="profile-edit-status">${icon("info")}${tx("As alterações de perfil e contato ainda não estão disponíveis.")}</span>${action("Salvar alterações", null, { variant: "", describedBy: "profile-edit-status" })}</div>
    ${relatedAreas(["seguranca", "privacidade"], "Segurança e privacidade do perfil")}`;
  }
  function subscription() {
    return `<section class="settings-section subscription-summary" aria-labelledby="subscription-heading">${panelHeading("Assinatura atual", { id: "subscription-heading", iconName: "crown", tone: "violet", end: capabilityBadge("subscription") })}<div class="subscription-plan"><span>${tx(capabilityDefinitions.subscription.title)}</span><h3>${tx("Plano não disponível")}</h3><p>${tx("Seu plano será exibido quando os dados da assinatura estiverem disponíveis.")}</p></div><dl class="subscription-facts">${["Ciclo de cobrança", "Próxima renovação", "Valor da assinatura"].map(label => `<div><dt>${tx(label)}</dt><dd>${tx("Não disponível")}</dd></div>`).join("")}</dl><div class="panel-actions subscription-actions"><p>${icon("info")}${tx("Alterações e cancelamento aguardam a conexão com o serviço de assinatura.")}</p><div>${action("Alterar plano", "crown")}${action("Cancelar assinatura", null, { variant: "ghost" })}</div></div></section>
      <section class="settings-section subscription-limits">${panelHeading("Limites da conta", { iconName: "chart", tone: "cyan", end: link("consumo", "", "text-link", `${tx("Ver consumo")}${icon("arrow-right")}`) })}<p class="panel-description">${tx("Consulte a capacidade disponível para cada recurso da sua conta.")}</p>${resourceTable({ showUsage: false })}<p class="data-note">${icon("info")}${tx("Os limites serão exibidos quando os benefícios da conta estiverem conectados.")}</p></section>
      <section class="settings-section subscription-catalog">${panelHeading("Planos e benefícios", { iconName: "sparkles", tone: "cyan" })}<p class="panel-description">${tx("Compare as opções quando o catálogo oficial estiver disponível.")}</p>${planCatalog()}<div class="catalog-availability"><p>${icon("info")}${tx("Assinaturas pagas ainda não estão disponíveis.")}</p><p><span>${tx("Preços e limites comerciais")}</span><strong>${tx("Não disponível")}</strong></p></div></section>${relatedAreas(["consumo", "faturamento"], "Consumo e faturamento")}`;
  }
  function consumption() {
    const selectedResources = resources.filter(resource => state.tab === "overview" || resource.id === state.tab);
    return `<section class="settings-section usage-workbench" aria-labelledby="usage-heading">
      <header class="usage-controls"><div><h2 id="usage-heading">${tx("Recursos da conta")}</h2><p>${tx("Consulte o uso e os limites de cada recurso.")}</p></div>${selectPeriod("usage-period", state.period)}</header>
      <div class="segment-tabs" role="tablist" aria-label="${tx("Consumo e limites")}">${Object.entries(resourceTabs).map(([key, title]) => `<button type="button" class="button ghost${state.tab === key ? " selected" : ""}" role="tab" id="usage-tab-${key}" data-usage-tab="${key}" aria-selected="${state.tab === key}" aria-controls="usage-panel" tabindex="${state.tab === key ? "0" : "-1"}">${tx(title)}</button>`).join("")}</div>
      <div id="usage-panel" role="tabpanel" aria-labelledby="usage-tab-${state.tab}" tabindex="0">
        <div class="usage-summary${selectedResources.length === 1 ? " is-single" : ""}">${selectedResources.map(resource => `<article class="usage-stat"><div class="usage-stat-heading">${icon(resource.icon, resource.tone)}<h3>${tx(resource.name)}</h3></div><dl>${["Uso", "Limite"].map(label => `<div><dt>${tx(label)}</dt><dd aria-label="${tx("Não disponível")}">—</dd></div>`).join("")}</dl>${capabilityBadge(resource.capabilityId)}</article>`).join("")}</div>
        <section class="usage-chart-panel" aria-labelledby="usage-history-heading"><header class="chart-heading"><div><h3 id="usage-history-heading">${tx("Histórico de utilização")}</h3><p>${tx(resourceTabs[state.tab])} · ${tx(periods[state.period])}</p></div><div class="chart-actions">${capabilityBadge("usageHistory")}${action("Exportar", "download", { small: true, describedBy: "usage-data-status" })}</div></header><div class="chart-legend">${selectedResources.map(resource => `<span><i class="legend-${resource.tone}"></i>${tx(resource.label)}</span>`).join("")}</div>${chart(state.period, resourceTabs[state.tab])}</section>
      </div><p class="usage-data-note" id="usage-data-status">${icon("info")}${tx("Selecione um recurso e um período. Os valores serão exibidos quando a medição estiver conectada.")}</p>
    </section>${relatedAreas(["assinatura", "faturamento"], "Plano e pagamentos")}`;
  }
  function billing() {
    return `<section class="settings-section billing-summary" aria-labelledby="billing-summary-heading">
      ${panelHeading("Resumo de pagamento", { id: "billing-summary-heading", iconName: "card", tone: "cyan", end: capabilityBadge("upcomingCharge") })}
      <div class="billing-overview">
        <article class="billing-next"><h3>${tx(capabilityDefinitions.upcomingCharge.title)}</h3><p class="billing-large">${tx("Valor não disponível")}</p><dl class="billing-due"><div><dt>${tx("Vencimento")}</dt><dd>${tx("Não disponível")}</dd></div></dl>${link("assinatura", "", "text-link", `${tx("Ver assinatura")}${icon("arrow-right")}`)}</article>
        <article class="payment-method"><h3>${tx(capabilityDefinitions.paymentMethods.title)}</h3><div class="payment-preview"><span class="management-icon">${icon("card")}</span><div><strong>${tx("Métodos não disponíveis")}</strong><p>${tx("Os métodos cadastrados aparecerão quando o serviço de pagamentos estiver conectado.")}</p></div></div>${action("Adicionar método", "card", { describedBy: "billing-summary-note" })}</article>
      </div><p class="billing-summary-note" id="billing-summary-note">${icon("info")}${tx("A consulta e as alterações de pagamento aguardam integração.")}</p>
    </section>
    <section class="settings-section billing-history" aria-labelledby="billing-history-heading">
      ${panelHeading("Histórico de faturamento", { id: "billing-history-heading", iconName: "document", tone: "cyan", end: action("Baixar faturas", "download", { small: true, describedBy: "billing-documents-note" }) })}
      <p class="panel-description">${tx("Consulte e baixe suas faturas, recibos e documentos de cobrança.")}</p>
      ${pendingRecords({ caption: capabilityDefinitions.invoices.title, columns: ["Documento", "Data", "Valor", "Status"], title: "Documentos ainda não disponíveis", description: "Faturas, recibos e histórico de cobranças aparecerão após a conexão com o faturamento." })}
      <p class="billing-history-note" id="billing-documents-note">${icon("info")}${tx("O histórico indisponível não confirma a ausência de cobranças.")}</p>
    </section>
    <section class="settings-section fiscal-details" aria-labelledby="fiscal-heading">
      ${panelHeading(capabilityDefinitions.fiscalDetails.title, { id: "fiscal-heading", iconName: "document", tone: "cyan", end: capabilityBadge("fiscalDetails") })}<p class="panel-description">${tx("Informações usadas nos documentos de cobrança.")}</p>
      <fieldset class="profile-field-group"><legend>${tx("Identificação fiscal")}</legend><div class="form-grid">${field("Nome ou razão social", "Não disponível")}${field("CPF ou CNPJ", "Não disponível")}</div></fieldset>
      <fieldset class="profile-field-group"><legend>${tx("Contato e endereço")}</legend><div class="form-grid fiscal-contact">${field("E-mail de faturamento", "Não disponível", "email")}<div class="fiscal-address">${field("Endereço de faturamento", "Não disponível")}</div></div></fieldset>
      <div class="form-actions"><span id="fiscal-edit-status">${icon("info")}${tx("A edição aguarda a integração deste recurso.")}</span>${action("Salvar dados fiscais", null, { variant: "", describedBy: "fiscal-edit-status" })}</div>
    </section>${relatedAreas(["assinatura", "consumo"], "Assinatura e consumo")}`;
  }
  function security() {
    return `${sessionSection()}
    <section class="settings-section security-protection" aria-labelledby="protection-heading">
      ${panelHeading("Proteção da conta", { id: "protection-heading", iconName: "shield", tone: "mint" })}
      <p class="panel-description" id="protection-status-note">${tx("Os controles de proteção aguardam integração. Não é possível confirmar sua configuração atual.")}</p>
      ${["password", "twoFactor", "recovery"].map(id => {
        const row = capabilityDefinitions[id];
        return settingRow({ ...row, title: row.viewTitle || row.title, hint: "", status: capabilityBadge(id), control: action(row.action, null, { describedBy: "protection-status-note" }) });
      }).join("")}
    </section>
    <section class="settings-section security-history" aria-labelledby="security-history-heading">${panelHeading("Histórico de acesso", { id: "security-history-heading", iconName: "history", tone: "cyan", end: link("atividade", "", "text-link", `${tx(byId.get("atividade").title)}${icon("arrow-right")}`) })}${empty("Histórico de segurança não disponível", "Os eventos de acesso serão consultados pelo serviço de identidade OrdaX.", "history", true)}</section>
    ${relatedAreas(["dispositivos", "privacidade"], "Acesso e privacidade")}`;
  }
  function devices() {
    return `${sessionSection({ related: "seguranca" })}
    <section class="settings-section device-list" aria-labelledby="devices-heading">
      ${panelHeading("Dispositivos autorizados", { id: "devices-heading", iconName: "devices", tone: "cyan", end: capabilityBadge("deviceSessions") })}
      <p class="panel-description">${tx("Consulte os acessos vinculados à sua conta e gerencie outras sessões.")}</p>
      <ul class="device-scope" aria-label="${tx("Tipos de acesso")}"><li>${icon("devices")}${tx("OrdaX OS")}</li><li>${icon("globe")}${tx("OrdaX Web")}</li><li>${icon("devices")}${tx("Dispositivos móveis")}</li></ul>
      ${pendingRecords({ caption: "Dispositivos autorizados", columns: ["Dispositivo", "Última atividade", "Status"], title: "Dispositivos ainda não disponíveis", description: "A sessão atual não identifica todos os dispositivos. A lista depende do serviço público de dispositivos OrdaX.", iconName: "devices" })}
      <p class="device-revoke-note" id="device-revoke-note">${icon("info")}${tx("A lista e o encerramento remoto de sessões aguardam integração.")}</p>
      <div class="panel-actions device-actions">${action("Encerrar outras sessões", null, { describedBy: "device-revoke-note" })}${link("atividade", "", "text-link", `${tx(byId.get("atividade").title)}${icon("arrow-right")}`)}</div>
    </section>${relatedAreas(["seguranca", "atividade"], "Proteção e histórico da conta")}`;
  }
  function privacy() {
    return `<section class="settings-section consent-settings" aria-labelledby="consent-heading">
      ${panelHeading(capabilityDefinitions.consents.title, { id: "consent-heading", iconName: "fingerprint", tone: "cyan" })}
      <p class="panel-description" id="consent-state">${tx("Os estados de uso de dados ainda não estão disponíveis. Nenhuma escolha é alterada nesta tela.")}</p>
      ${privacyOptions.map(option => settingRow({ ...option, status: capabilityBadge("consents"), control: option.related ? link(option.related, "", "text-link", `${tx("Ver preferências")}${icon("arrow-right")}`) : "" })).join("")}
    </section>
    <section class="settings-section privacy-data" aria-labelledby="privacy-data-heading">
      ${panelHeading("Gerenciar meus dados", { id: "privacy-data-heading", iconName: "disk", tone: "cyan" })}<p class="panel-description">${tx("Solicite uma cópia dos dados ou gerencie a exclusão da conta.")}</p>
      <div class="data-operations">${["dataExport", "accountDeletion"].map(operationRow).join("")}</div>
    </section>${relatedAreas(["preferencias", "integracoes"], "Preferências e acesso aos dados")}`;
  }
  function preferences() {
    const locales = window.OrdaXPublicI18nCatalog?.supportedLocales ?? [];
    const material = document.body.dataset.material === "ink" ? "Escuro" : "Claro";
    return `<section class="settings-section portal-preferences" aria-labelledby="portal-preferences-heading">
      ${panelHeading("Preferências do portal", { id: "portal-preferences-heading", iconName: "sliders", tone: "cyan" })}<p class="panel-description">${tx("Idioma e aparência se referem ao navegador atual.")}</p>
      <div class="preferences-grid"><article class="preference-panel"><div class="preference-heading"><h3>${tx(capabilityDefinitions.portalLocale.title)}</h3>${capabilityBadge("portalLocale")}</div><p class="preference-description" id="account-locale-hint">${tx("Escolha o idioma usado neste portal. Esta escolha vale para este navegador.")}</p><label class="locale-field" for="account-locale"><span>${tx("Idioma preferido")}</span><select id="account-locale" aria-describedby="account-locale-hint">${locales.map(locale => `<option value="${esc(locale)}"${i18n.getLocale() === locale ? " selected" : ""}>${message(`locale.selector.${locale}`)}</option>`).join("")}</select></label></article>
        <article class="preference-panel"><div class="preference-heading"><h3>${tx("Aparência")}</h3>${capabilityBadge("portalAppearance")}</div><p class="preference-description">${tx("Esta é a aparência atual deste portal.")}</p><div class="appearance-option"><div class="appearance-preview" aria-hidden="true"><span class="appearance-preview-bar"></span><span class="appearance-preview-rail"></span><span class="appearance-preview-content"><i></i><i></i><i></i></span></div><div class="appearance-current"><span>${tx("Visual atual")}</span><strong>${tx(material)}</strong></div></div></article></div>
    </section>
    <section class="settings-section communication-settings" aria-labelledby="communications-heading">${panelHeading("Notificações e comunicações", { id: "communications-heading", iconName: "bell", tone: "cyan" })}<p class="panel-description">${tx("Preferências da conta estarão disponíveis quando o serviço oficial estiver conectado.")}</p>${communicationOptions.map(option => settingRow({ ...option, status: capabilityBadge("communications") })).join("")}<div class="panel-actions communication-actions">${link("privacidade", "", "text-link", `${tx(byId.get("privacidade").title)}${icon("arrow-right")}`)}</div></section>
    ${relatedAreas(["dados-pessoais", "suporte"], "Perfil e ajuda")}`;
  }
  function integrations() {
    return `<section class="settings-section connection-settings" aria-labelledby="connections-heading">
      ${panelHeading("Conexões da conta", { id: "connections-heading", iconName: "plug", tone: "cyan", end: capabilityBadge("connections") })}<p class="panel-description">${tx("Consulte os aplicativos autorizados e as permissões de cada conexão.")}</p>
      ${pendingRecords({ caption: capabilityDefinitions.connections.title, columns: ["Aplicativo ou serviço", "Permissões", "Status"], title: "Conexões ainda não disponíveis", description: "As conexões autorizadas serão exibidas pelo serviço oficial de integrações.", iconName: "globe" })}
      <p class="connection-state-note" id="connections-state">${icon("info")}${tx("Sem a consulta, não é possível confirmar quais conexões estão autorizadas.")}</p>
      <div class="panel-actions connection-actions">${action("Gerenciar conexões", "plug", { describedBy: "connections-state" })}${link("seguranca", "", "text-link", `${tx(byId.get("seguranca").title)}${icon("arrow-right")}`)}</div>
    </section>
    <section class="settings-section connection-permissions" aria-labelledby="connection-permissions-heading">
      ${panelHeading("Acesso dos aplicativos", { id: "connection-permissions-heading", iconName: "shield", tone: "mint" })}${operationRow("connectionRevocation")}
    </section>${relatedAreas(["seguranca", "privacidade"], "Acesso e dados da conta")}`;
  }
  function relatedAreas(ids, label) {
    return `<nav class="related-areas" aria-label="${tx(label)}">${ids.map(id => {
      const section = byId.get(id);
      return link(id, "", "related-area", `<span class="management-icon">${icon(section.icon)}</span><span><strong>${tx(section.title)}</strong><small>${tx(section.description)}</small></span>${icon("arrow-right")}`);
    }).join("")}</nav>`;
  }
  function activity() {
    const period = i18n.fromSource(periods[state.activityPeriod]);
    return `<section class="settings-section activity-history">${panelHeading("Histórico da conta", { iconName: "history", tone: "cyan", end: capabilityBadge("accessEvents") })}<div class="activity-controls"><p class="panel-description">${tx("Acessos e alterações da sua conta, organizados por período.")}</p>${selectPeriod("activity-period", state.activityPeriod, false)}</div><div role="status" aria-live="polite" aria-atomic="true">${empty("Histórico ainda não disponível", i18n.t("account.activity.period", { period }), "history", true)}</div><p class="activity-note">${icon("info")}${tx("Sem acesso ao histórico, não é possível confirmar a ausência de eventos neste período.")}</p></section><section class="activity-related"><h2>${tx("Acesso e proteção")}</h2>${relatedAreas(["seguranca", "dispositivos"], "Acesso e proteção")}</section>`;
  }
  function matchingFaqs() {
    return faqs.filter(faq => matchesSearch([faq.q, faq.a, byId.get(faq.section).title].map(source => i18n.fromSource(source)).join(" "), state.helpQuery));
  }
  function faqContent() {
    const matches = matchingFaqs();
    return matches.length ? matches.map(faq => `<article class="faq-item"><h3><button type="button" class="button ghost" id="faq-question-${faq.id}" data-faq="${faq.id}" aria-expanded="${state.faq === faq.id}" aria-controls="faq-answer-${faq.id}">${tx(faq.q)}${icon("chevron-down")}</button></h3><div class="faq-answer" id="faq-answer-${faq.id}" aria-labelledby="faq-question-${faq.id}"${state.faq === faq.id ? "" : " hidden"}><p>${tx(faq.a)}</p>${link(faq.section, "", "text-link", `${tx(byId.get(faq.section).title)}${icon("arrow-right")}`)}</div></article>`).join("") : `<div class="help-empty">${icon("search")}<h3>${tx("Nenhuma resposta encontrada")}</h3><p>${tx("Tente buscar por plano, fatura, senha ou dados.")}</p><button type="button" class="button outline h-8" data-reset-help>${tx("Ver todas as perguntas")}</button></div>`;
  }
  function updateHelpResults() {
    document.getElementById("faq-list").innerHTML = faqContent();
    document.getElementById("help-result-count").textContent = i18n.t("account.help.resultCount", { count: matchingFaqs().length });
    document.getElementById("help-clear").hidden = !state.helpQuery;
  }
  function support() {
    return `<section class="settings-section help-search">${panelHeading("Como podemos ajudar?", { iconName: "help", tone: "cyan" })}<p class="panel-description">${tx("Busque uma resposta ou vá direto à área da sua conta.")}</p>${searchControl({ id: "help-search", value: state.helpQuery, label: "Buscar ajuda", placeholder: "Busque por assinatura, segurança, faturas...", resultsId: "faq-list", clearId: "help-clear", clearLabel: "Limpar busca de ajuda" })}</section>${relatedAreas(["assinatura", "seguranca", "faturamento"], "Atalhos de ajuda")}<div class="help-workbench"><section class="settings-section help-questions" aria-labelledby="faq-heading">${panelHeading("Perguntas frequentes", { id: "faq-heading", end: `<span class="help-result-count" id="help-result-count" role="status" aria-live="polite" aria-atomic="true">${message("account.help.resultCount", { count: matchingFaqs().length })}</span>` })}<div class="faq-list" id="faq-list">${faqContent()}</div></section><aside class="settings-section support-contact" aria-labelledby="support-heading"><span class="management-icon">${icon("mail")}</span><h2 id="support-heading">${tx("Atendimento OrdaX")}</h2>${capabilityBadge("supportChannel")}<p id="support-availability">${tx("O canal de atendimento ainda não está conectado. Por enquanto, nenhuma solicitação pode ser enviada por aqui.")}</p><button type="button" class="button outline" data-open-dialog="support" aria-controls="account-dialog" aria-haspopup="dialog" aria-describedby="support-availability">${tx("Consultar atendimento")}${icon("arrow-right")}</button></aside></div>`;
  }
  const views = { integracoes: integrations, "visao-geral": overview, "dados-pessoais": personal, assinatura: subscription, consumo: consumption, faturamento: billing, seguranca: security, dispositivos: devices, privacidade: privacy, preferencias: preferences, atividade: activity, suporte: support };

  function navigationEntry(section, className = "sidebar-link") {
    return `<a href="#${section.id}" title="${tx(section.title)}" aria-label="${tx(section.title)}" class="${className}${state.section === section.id ? " active" : ""}" data-section="${section.id}"${state.section === section.id ? ' aria-current="page"' : ""}>${icon(section.icon)}<span>${tx(section.title)}</span></a>`;
  }
  function renderSidebarToggle() {
    const control = document.getElementById("sidebar-toggle");
    const collapsed = root.classList.contains("sidebar-collapsed");
    const label = i18n.fromSource(collapsed ? "Expandir menu" : "Recolher menu");
    control.setAttribute("aria-expanded", String(!collapsed));
    control.setAttribute("aria-label", label);
    control.title = label;
    control.innerHTML = icon(collapsed ? "panel-open" : "panel-close");
  }
  function renderNavigation() {
    renderSidebarToggle();
    document.getElementById("sidebar-navigation").innerHTML = navigationGroups.map(group => `<div class="nav-group"><p class="nav-group-label">${tx(group.title)}</p>${group.ids.map(id => navigationEntry(byId.get(id))).join("")}</div>`).join("");
    document.getElementById("mobile-navigation").innerHTML = mobileSections.map(item => `<a href="#${item.id}"${state.section === item.id ? ' class="active" aria-current="page"' : ""}>${icon(byId.get(item.id).icon)}<span>${tx(item.label)}</span></a>`).join("") + `<button type="button" class="button ghost${mobileSectionIds.has(state.section) ? "" : " active"}" id="more-toggle" data-open-more aria-controls="more-dialog" aria-expanded="${moreDialog.open}">${icon("more")}<span>${tx("Mais")}</span></button>`;
    document.getElementById("more-navigation").innerHTML = navigationGroups.map(group => `<div class="nav-group"><p class="nav-group-label">${tx(group.title)}</p>${group.ids.map(id => navigationEntry(byId.get(id), "more-link")).join("")}</div>`).join("") + navigationEntry(byId.get("suporte"), "more-link");
    const supportLink = root.querySelector('.sidebar-bottom [data-section="suporte"]');
    supportLink.classList.toggle("active", state.section === "suporte");
    if (state.section === "suporte") supportLink.setAttribute("aria-current", "page"); else supportLink.removeAttribute("aria-current");
  }
  function renderContent({ focus = false } = {}) {
    const section = byId.get(state.section);
    const header = state.section === "visao-geral" ? "" : `<header class="detail-page-heading"><span class="detail-heading-icon">${icon(section.icon)}</span><div><h1 tabindex="-1">${tx(section.title)}</h1><p>${tx(section.description)}</p></div></header>`;
    const availability = integration(section);
    document.getElementById("account-content").innerHTML = state.section === "visao-geral" ? overview() : `${header}<div class="account-detail-layout${availability ? " has-aside" : ""}"><div class="account-detail-body">${views[state.section]()}</div>${availability ? `<aside class="account-detail-aside" aria-label="${tx("Disponibilidade dos recursos")}">${availability}<a class="detail-help-link" href="#suporte">${icon("help")}<span>${tx("Dúvidas sobre esta área?")}</span>${icon("arrow-right")}</a></aside>` : ""}</div>`;
    const crumb = document.getElementById("section-crumb");
    crumb.hidden = state.section === "visao-geral";
    crumb.innerHTML = state.section === "visao-geral" ? "" : `${icon("chevron-right")}<span aria-current="page">${tx(section.title)}</span>`;
    document.title = `${i18n?.fromSource(state.section === "visao-geral" ? "Minha Conta" : section.title) ?? section.title} — OrdaX OS`;
    if (focus) document.querySelector("#account-content h1")?.focus({ preventScroll: true });
  }
  function route({ initial = false } = {}) {
    let requested = location.hash.slice(1);
    try { requested = decodeURIComponent(requested); } catch { requested = ""; }
    const contentAnchor = requested === "conteudo";
    if (contentAnchor) requested = state.section;
    if (!byId.has(requested)) requested = "visao-geral";
    const changed = requested !== state.section;
    state.section = requested;
    closeMore();
    if (dialog.open) dialog.close();
    renderNavigation();
    renderContent({ focus: !initial });
    if (changed || !initial) window.scrollTo({ top: 0, behavior: "instant" });
    if (contentAnchor) document.getElementById("conteudo").focus({ preventScroll: true });
  }

  const dialog = document.getElementById("account-dialog");
  const moreDialog = document.getElementById("more-dialog");
  let dialogReturnTarget = null;
  function matchingSections() {
    return sections.filter(section => matchesSearch([section.title, section.description, ...(section.capabilities ?? []).map(id => capabilityDefinitions[id].title)].map(source => i18n.fromSource(source)).join(" "), state.searchQuery));
  }
  function searchResults() {
    const found = matchingSections();
    return found.length ? found.map(section => `<a href="#${section.id}">${icon(section.icon)}<span><strong>${tx(section.title)}</strong><small>${tx(section.description)}</small></span>${icon("chevron-right")}</a>`).join("") : `<div class="search-empty">${icon("search")}<strong>${tx("Nenhuma área encontrada.")}</strong><p>${tx("Tente buscar por senha, faturas, perfil ou dispositivos.")}</p></div>`;
  }
  function updateSearchStatus() {
    const status = document.getElementById("search-status");
    const count = matchingSections().length;
    if (status) status.textContent = i18n.t(count === 1 ? "account.refinement.searchSingle" : "account.refinement.searchCount", { count });
    const clear = document.getElementById("dialog-search-clear");
    if (clear) clear.hidden = !state.searchQuery;
  }
  function renderDialog() {
    const kind = state.dialog;
    const title = kind === "search" ? "Buscar na minha conta" : kind === "support" ? "Atendimento não conectado" : "Notificações";
    const description = kind === "search" ? "Encontre uma área da sua conta." : kind === "support" ? "O canal oficial de suporte ainda não foi configurado. Nenhuma solicitação foi enviada." : "O serviço de notificações ainda não está conectado.";
    document.getElementById("dialog-title").textContent = i18n?.fromSource(title) ?? title;
    document.getElementById("dialog-description").textContent = i18n?.fromSource(description) ?? description;
    document.getElementById("dialog-content").innerHTML = kind === "search" ? `${searchControl({ id: "dialog-search", value: state.searchQuery, label: "Buscar na minha conta", placeholder: "O que você está procurando?", resultsId: "search-results", describedBy: "search-shortcuts" })}<p class="search-shortcuts" id="search-shortcuts">${tx("Use as setas para navegar e Enter para abrir.")}</p><p class="search-caption" id="search-status" role="status" aria-live="polite" aria-atomic="true"></p><nav class="search-results" id="search-results" aria-label="${tx("Áreas da conta")}">${searchResults()}</nav>` : kind === "support" ? action("Entendi", null, { disabled: false, data: "data-close-dialog" }) : `${empty("Notificações ainda não disponíveis", "As notificações serão exibidas quando o serviço oficial estiver disponível.", "bell", true)}${action("Entendi", null, { disabled: false, data: "data-close-dialog" })}`;
  }
  function openDialog(kind) {
    if (!dialog.open) dialogReturnTarget = moreDialog.open ? document.getElementById("more-toggle") : document.activeElement;
    closeMore();
    state.dialog = kind;
    renderDialog();
    if (!dialog.open) dialog.showModal();
    if (kind === "search") { updateSearchStatus(); document.getElementById("dialog-search").focus(); }
  }
  function closeMore() {
    if (moreDialog.open) moreDialog.close();
    document.getElementById("more-toggle")?.setAttribute("aria-expanded", "false");
  }
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    state.dialog = null;
    const active = document.activeElement;
    if (dialogReturnTarget?.isConnected && !dialogReturnTarget.disabled && (active === document.body || dialog.contains(active))) {
      dialogReturnTarget.focus({ preventScroll: true });
    }
    dialogReturnTarget = null;
  });
  moreDialog.addEventListener("close", () => { document.getElementById("more-toggle")?.setAttribute("aria-expanded", "false"); });
  dialog.addEventListener("click", event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });

  document.addEventListener("click", event => {
    if (event.defaultPrevented) return;
    const control = event.target.closest("button, a");
    if (!control) return;
    if (control.matches('a[href="#conteudo"]')) {
      event.preventDefault();
      document.getElementById("conteudo").focus();
      return;
    }
    if (control.matches("[data-refresh-session]")) { if (!layoutPreview) void account.refreshSession(); }
    else if (control.matches("[data-open-dialog]")) openDialog(control.dataset.openDialog);
    else if (control.matches("[data-close-dialog]")) dialog.close();
    else if (control.matches("[data-open-more]")) { if (moreDialog.open) closeMore(); else { moreDialog.showModal(); control.setAttribute("aria-expanded", "true"); } }
    else if (control.matches("[data-close-more]")) closeMore();
    else if (control.id === "sidebar-toggle") {
      root.classList.toggle("sidebar-collapsed");
      renderSidebarToggle();
    } else if (control.matches("[data-usage-tab]")) {
      state.tab = control.dataset.usageTab; renderContent(); document.getElementById(`usage-tab-${state.tab}`).focus({ preventScroll: true });
    } else if (control.matches("[data-faq]")) {
      const id = control.dataset.faq; state.faq = state.faq === id ? null : id;
      document.querySelectorAll("[data-faq]").forEach(button => {
        const expanded = state.faq === button.dataset.faq;
        button.setAttribute("aria-expanded", String(expanded));
        document.getElementById(button.getAttribute("aria-controls")).hidden = !expanded;
      });
    } else if (control.matches("[data-clear-search]")) {
      const input = document.getElementById(control.dataset.clearSearch);
      input.value = "";
      if (input.id === "dialog-search") {
        state.searchQuery = "";
        document.getElementById("search-results").innerHTML = searchResults();
        updateSearchStatus();
      } else {
        state.helpQuery = "";
        updateHelpResults();
      }
      input.focus();
    } else if (control.matches('a[href^="#"]')) {
      if (dialog.open) dialog.close(); closeMore();
      if (control.getAttribute("href") === location.hash) route();
    }
  });
  document.addEventListener("input", event => {
    if (event.target.id === "dialog-search") { state.searchQuery = event.target.value; document.getElementById("search-results").innerHTML = searchResults(); updateSearchStatus(); }
    else if (event.target.id === "help-search") { state.helpQuery = event.target.value; updateHelpResults(); }
  });
  document.addEventListener("change", event => {
    if (event.target.id === "usage-period") { state.period = event.target.value; renderContent(); document.getElementById("usage-period").focus({ preventScroll: true }); }
    else if (event.target.id === "activity-period") { state.activityPeriod = event.target.value; renderContent(); document.getElementById("activity-period").focus({ preventScroll: true }); }
    else if (event.target.id === "account-locale") i18n.setLocale(event.target.value);
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openDialog("search"); }
    if (state.dialog === "search" && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      const results = [...document.querySelectorAll("#search-results > a")];
      const input = document.getElementById("dialog-search");
      const fromInput = event.target === input;
      const result = event.target.closest("#search-results > a");
      if (fromInput && event.key === "Enter" && results.length === 1) {
        event.preventDefault(); results[0].click();
      } else if (results.length && event.key !== "Enter" && (fromInput || result)) {
        event.preventDefault();
        const index = fromInput ? (event.key === "ArrowDown" ? 0 : results.length - 1) : results.indexOf(result) + (event.key === "ArrowDown" ? 1 : -1);
        (index < 0 ? input : results[Math.min(index, results.length - 1)]).focus();
      }
    }
    const tab = event.target.closest("[data-usage-tab]");
    if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const keys = Object.keys(resourceTabs); const index = keys.indexOf(state.tab);
      state.tab = event.key === "Home" ? keys[0] : event.key === "End" ? keys[keys.length - 1] : keys[(index + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length];
      renderContent(); document.getElementById(`usage-tab-${state.tab}`).focus({ preventScroll: true });
    }
  });
  window.addEventListener("hashchange", () => route());
  window.matchMedia("(min-width: 641px)").addEventListener("change", event => { if (event.matches) closeMore(); });
  document.addEventListener("ordax:localechange", () => {
    const focused = document.activeElement?.id;
    renderNavigation(); renderContent(); renderSession(); if (dialog.open) { renderDialog(); updateSearchStatus(); }
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  });
  hydrateIcons();
  route({ initial: true });
  if (layoutPreview) {
    renderSession();
  } else {
    account.subscribe(value => {
      const focused = document.activeElement?.id;
      session = value;
      renderSession();
      // Revalidation must clear personal data, but not replace unrelated controls
      // while someone is typing in Help or changing presentation preferences.
      if (byId.get(state.section).sessionDependent) renderContent();
      if (focused && !document.activeElement?.id) (document.getElementById(focused) || document.getElementById("session-status-title"))?.focus({ preventScroll: true });
    });
    void account.readSession();
  }
})();
