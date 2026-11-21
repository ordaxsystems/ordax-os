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
    { id: "visao-geral", navigationGroup: "account", mobileLabel: "Resumo", sessionDependent: true, title: "Visão geral", icon: "dashboard", description: "Sua identidade, assinatura e recursos em um só lugar." },
    { id: "dados-pessoais", navigationGroup: "account", sessionDependent: true, title: "Dados pessoais", icon: "user", description: "Seu perfil e suas informações cadastrais.", owner: "Identidade OrdaX", capabilities: ["accountEmail", "profileEdit", "profilePhoto"] },
    { id: "assinatura", navigationGroup: "services", mobileLabel: "Plano", sessionDependent: true, title: "Plano e assinatura", icon: "crown", description: "Seu plano, benefícios e opções de assinatura.", owner: "Direitos e assinaturas OrdaX", capabilities: ["subscription", "planCatalog", "subscriptionChange"] },
    { id: "consumo", navigationGroup: "services", mobileLabel: "Consumo", title: "Consumo e limites", icon: "chart", description: "Acompanhe seus recursos em todo o ecossistema OrdaX.", owner: "Medição de uso OrdaX", capabilities: ["aiUsage", "storageUsage", "apiUsage", "usageHistory", "usageExport"] },
    { id: "faturamento", navigationGroup: "services", title: "Pagamentos e faturas", icon: "card", description: "Métodos de pagamento, cobranças e documentos fiscais.", owner: "Faturamento OrdaX", capabilities: ["upcomingCharge", "paymentMethods", "invoices", "fiscalDetails"] },
    { id: "seguranca", navigationGroup: "security", mobileLabel: "Segurança", sessionDependent: true, title: "Segurança e acesso", icon: "shield", description: "Proteja sua identidade e controle o acesso à sua conta.", owner: "Identidade OrdaX", capabilities: ["browserSession", "password", "twoFactor", "recovery", "accessEvents"] },
    { id: "dispositivos", navigationGroup: "security", sessionDependent: true, title: "Meus dispositivos", icon: "devices", description: "Dispositivos e sessões vinculados à sua conta.", owner: "Sessões e dispositivos OrdaX", capabilities: ["deviceSessions", "osDevices", "remoteSignOut"] },
    { id: "privacidade", navigationGroup: "security", title: "Dados e privacidade", icon: "fingerprint", description: "Seus dados, suas escolhas. Você está no controle.", owner: "Privacidade OrdaX", capabilities: ["dataExport", "consents", "accountDeletion"] },
    { id: "integracoes", navigationGroup: "preferences", title: "Integrações", icon: "globe", description: "Contas conectadas e autorizações de aplicativos.", owner: "Integrações OrdaX", capabilities: ["connections", "connectionRevocation"] },
    { id: "preferencias", navigationGroup: "preferences", sessionDependent: true, title: "Preferências", icon: "sliders", description: "Personalize a experiência da sua conta.", owner: "Preferências OrdaX", capabilities: ["portalLocale", "portalAppearance", "communications"] },
    { id: "atividade", navigationGroup: "preferences", title: "Atividade da conta", icon: "history", description: "Histórico de acesso e alterações importantes.", owner: "Auditoria da conta OrdaX", capabilities: ["accessEvents", "accountChanges", "activityPeriod"] },
    { id: "suporte", mobileOverflow: true, title: "Central de ajuda", icon: "help", description: "Encontre respostas e cuide da sua experiência OrdaX.", capabilities: ["supportChannel"] }
  ]);
  const byId = new Map(sections.map(section => [section.id, section]));
  const navigationGroupDefinitions = Object.freeze([
    { id: "account", title: "Minha conta" },
    { id: "services", title: "Plano e serviços" },
    { id: "security", title: "Segurança e privacidade" },
    { id: "preferences", title: "Preferências e conexões" }
  ]);
  const navigationGroups = Object.freeze(navigationGroupDefinitions.map(group => ({
    ...group,
    ids: sections.filter(section => section.navigationGroup === group.id).map(section => section.id),
  })).filter(group => group.ids.length));
  const mobileSections = Object.freeze(sections.filter(section => section.mobileLabel));
  const mobileSectionIds = new Set(mobileSections.map(section => section.id));
  const mobileOverflowSections = Object.freeze(sections.filter(section => section.mobileOverflow));
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
  const githubReturn = (() => {
    const url = new URL(window.location.href);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const challenges = url.searchParams.getAll("mcp_github_challenge");
    const statuses = url.searchParams.getAll("mcp_github");
    const challenge = challenges.length === 1 && uuid.test(challenges[0]) ? challenges[0] : null;
    const status = statuses.length === 1 && ["erro","indisponivel"].includes(statuses[0])
      ? statuses[0] : null;
    if (challenges.length || statuses.length) {
      url.searchParams.delete("mcp_github_challenge");
      url.searchParams.delete("mcp_github");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
    return { challenge, status };
  })();
  let session = account.getSnapshot();
  // Pending profile mutations never move across an account-session boundary.
  let profileSaveBusy = false;
  let profileSaveNotice = "";
  let localeSaveBusy = false;
  let localeSaveNotice = "";
  let localeFromAccountApplied = false;
  let accountExportBusy = false;
  let accountExportNotice = "";
  let communicationsDraft = null;
  let communicationsDraftSession = null;
  let communicationsSaveBusy = false;
  let communicationsNotice = "";
  let disposeMenu = () => {};
  // Observational data only. Never an entitlement, quota or invoice.
  let subscriptionView = null;
  let subscriptionStatus = "unavailable";
  let subscriptionSession = null;
  let subscriptionRevision = 0;
  let mcpUsage = null;
  let mcpUsageStatus = "unavailable";
  // Identity is the immutable published session snapshot, not a public email.
  // Every revalidation invalidates cached private usage even for the same email.
  let mcpUsageSession = null;
  let mcpUsageRevision = 0;
  let mcpDevices = null;
  let mcpDevicesStatus = "unavailable";
  let mcpDevicesSession = null;
  let mcpDevicesRevision = 0;
  let mcpAuthority = null;
  let mcpAuthorityDevice = null;
  let mcpAuthorityStatus = "unavailable";
  let mcpAuthorityRevision = 0;
  let mcpRevoking = false;
  let mcpRevocationNotice = "";

  let mcpProjectOnboarding = null;
  let mcpProjectDevice = null;
  let mcpProjectStatus = "unavailable";
  let mcpProjectRevision = 0;
  let mcpProjectCreating = false;
  let mcpProjectBinding = false;
  let mcpProjectBindingIntent = null;
  let mcpProjectGrantCreating = false;
  let mcpProjectGrantRevision = 0;
  let mcpProjectNotice = "";

  let mcpGithubChallenge = githubReturn.challenge;
  let mcpGithubCandidates = null;
  let mcpGithubStatus = githubReturn.challenge ? "unavailable" : "idle";
  let mcpGithubRevision = 0;
  let mcpGithubConnecting = false;
  let mcpGithubSelecting = false;
  let mcpGithubSession = null;
  let mcpGithubNotice = githubReturn.status === "erro"
    ? "A autorização GitHub não foi confirmada. Nenhuma conexão foi criada automaticamente."
    : githubReturn.status === "indisponivel"
      ? "A conexão GitHub ainda não está disponível."
      : "";

  let mcpCentralClient = null;
  let mcpCentralTargets = null;
  let mcpCentralSelections = null;
  let mcpCentralStatus = "unavailable";
  let mcpCentralRevision = 0;
  let mcpCentralSelecting = false;
  let mcpCentralNotice = "";

  function resetMcpProjectOnboarding() {
    mcpProjectRevision += 1;
    mcpProjectOnboarding = null;
    mcpProjectDevice = null;
    mcpProjectStatus = "unavailable";
    mcpProjectCreating = false;
    mcpProjectBinding = false;
    mcpProjectBindingIntent = null;
    mcpProjectGrantCreating = false;
    mcpProjectGrantRevision += 1;
    mcpProjectNotice = "";
  }

  function resetMcpGithubSession() {
    mcpGithubRevision += 1;
    mcpGithubCandidates = null;
    mcpGithubStatus = mcpGithubChallenge ? "unavailable" : "idle";
    mcpGithubConnecting = false;
    mcpGithubSelecting = false;
  }

  async function loadMcpGithubCandidates(challengeId = mcpGithubChallenge) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (!signedIn() || mcpGithubConnecting || mcpGithubSelecting
        || !uuid.test(challengeId || "")) return;
    const revision = ++mcpGithubRevision, owner = session;
    mcpGithubChallenge = challengeId;
    mcpGithubCandidates = null;
    mcpGithubStatus = "loading";
    if (state.section === "dispositivos") renderContent();
    try {
      const value = await account.readMcpGithubCandidates(challengeId);
      if (revision !== mcpGithubRevision || session !== owner || !signedIn()
          || mcpGithubChallenge !== challengeId) return;
      mcpGithubCandidates = value;
      mcpGithubStatus = "ready";
      mcpGithubNotice = value.repositories.length
        ? "GitHub verificado. Escolha um dos repositórios confirmados pela Platform."
        : "A autorização GitHub não retornou repositórios disponíveis para este projeto.";
    } catch {
      if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
      mcpGithubCandidates = null;
      mcpGithubStatus = "unavailable";
      mcpGithubNotice = "Os repositórios GitHub verificados não puderam ser consultados. Nenhuma seleção foi feita.";
    }
    if (state.section === "dispositivos") renderContent();
  }

  async function startMcpGithubAuthorization(control) {
    if (mcpGithubConnecting || mcpGithubSelecting || mcpProjectCreating || mcpProjectBinding
        || mcpProjectGrantCreating
        || !signedIn() || mcpProjectStatus !== "ready" || !mcpProjectOnboarding
        || mcpProjectOnboarding.onboarding_availability?.github_authorization_configured !== true) return;
    const projectId = control.dataset.mcpGithubConnect;
    const project = mcpProjectOnboarding.projects.find(item => item.project_id === projectId);
    if (!project || !["needs_github_installation","needs_repository_selection"].includes(project.next_state))
      return;
    const revision = ++mcpGithubRevision, owner = session;
    mcpGithubConnecting = true;
    mcpGithubNotice = "";
    renderContent();
    try {
      const result = await account.startMcpGithubAuthorization(projectId);
      if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
      // Navigation only after the Account port has independently validated the
      // fixed github.com OAuth URL, callback, state and PKCE parameters.
      window.location.assign(result.authorization_url);
    } catch {
      if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
      mcpGithubNotice = "A autorização GitHub não foi iniciada. O projeto continua sem conexão.";
      mcpGithubStatus = mcpGithubChallenge ? "unavailable" : "idle";
      mcpGithubConnecting = false;
      if (state.section === "dispositivos") renderContent();
    }
  }

  async function selectMcpGithubRepository(form) {
    if (mcpGithubSelecting || mcpGithubConnecting || mcpProjectBinding || mcpProjectGrantCreating
        || !signedIn()
        || mcpGithubStatus !== "ready" || !mcpGithubCandidates || !mcpGithubChallenge
        || mcpProjectOnboarding?.onboarding_availability?.github_authorization_configured !== true)
      return;
    const repositoryId = String(new FormData(form).get("repository_id") ?? "");
    const candidate = mcpGithubCandidates.repositories.find(
      item => item.repository_id === repositoryId);
    if (!candidate) return;
    const revision = ++mcpGithubRevision, owner = session;
    const challengeId = mcpGithubChallenge;
    const projectId = mcpGithubCandidates.project_id;
    const deviceId = mcpProjectDevice;
    mcpGithubSelecting = true;
    mcpGithubNotice = "";
    renderContent();
    try {
      const selected = await account.selectMcpGithubRepository({
        challenge_id:challengeId, repository_id:repositoryId, confirm:"select_repository",
      });
      if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
      if (selected.project_id !== projectId
          || selected.repository_full_name !== candidate.repository_full_name
          || selected.next_state !== "needs_device_binding")
        throw new Error("mcp-github-selection-unconfirmed");
      // If a device-scoped Project view is already open, reconcile against the
      // canonical onboarding read. Never infer device binding from selection.
      if (deviceId && deviceId === mcpAuthorityDevice) {
        const confirmed = await account.readMcpProjectOnboarding(deviceId);
        if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
        const project = confirmed.projects.find(item => item.project_id === projectId);
        if (!project || project.repository_full_name !== candidate.repository_full_name
            || project.next_state !== "needs_device_binding")
          throw new Error("mcp-github-selection-not-reflected");
        mcpProjectOnboarding = confirmed;
        mcpProjectStatus = "ready";
      }
      mcpGithubCandidates = null;
      mcpGithubStatus = "selected";
      mcpGithubNotice = "Repositório GitHub verificado e conectado. O vínculo do dispositivo continua uma etapa separada.";
    } catch {
      if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
      // Never replay an uncertain repository-selection POST. When a device
      // scope is available, reconcile only through the canonical Project read.
      if (deviceId && deviceId === mcpAuthorityDevice) {
        try {
          const reconciled = await account.readMcpProjectOnboarding(deviceId);
          if (revision !== mcpGithubRevision || session !== owner || !signedIn()) return;
          mcpProjectOnboarding = reconciled;
          mcpProjectStatus = "ready";
        } catch { /* The uncertainty remains visible below. */ }
      }
      mcpGithubStatus = "unavailable";
      mcpGithubNotice = "A seleção do repositório não foi confirmada. Consulte o projeto antes de tentar outra seleção.";
    } finally {
      if (revision === mcpGithubRevision && session === owner && signedIn()) {
        mcpGithubSelecting = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  function resetMcpCentral() {
    mcpCentralRevision += 1;
    mcpCentralClient = null;
    mcpCentralTargets = null;
    mcpCentralSelections = null;
    mcpCentralStatus = "unavailable";
    mcpCentralSelecting = false;
    mcpCentralNotice = "";
  }

  async function loadMcpCentralClient(clientId) {
    if (!signedIn() || mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating
        || mcpAuthorityStatus !== "ready" || !mcpAuthority
        || !mcpAuthority.clients.some(c => c.client_id === clientId)
        || !mcpAuthority.grant_groups.some(g => g.client_id === clientId
          && g.client_consent_active && (!g.valid_until
            || Date.parse(g.valid_until) > Date.now()))) return;
    const revision = ++mcpCentralRevision, owner = session;
    mcpCentralClient = clientId;
    mcpCentralTargets = null;
    mcpCentralSelections = null;
    mcpCentralStatus = "loading";
    mcpCentralNotice = "";
    renderContent();
    try {
      const [targets, selections] = await Promise.all([
        account.readMcpCentralTargets(clientId),
        account.readMcpCentralSelections(clientId),
      ]);
      if (revision !== mcpCentralRevision || session !== owner || !signedIn()
          || mcpAuthorityDevice !== mcpAuthority?.device_id) return;
      mcpCentralTargets = targets;
      mcpCentralSelections = selections;
      mcpCentralStatus = "ready";
    } catch {
      if (revision !== mcpCentralRevision || session !== owner || !signedIn()) return;
      mcpCentralTargets = null;
      mcpCentralSelections = null;
      mcpCentralStatus = "unavailable";
    }
    if (state.section === "dispositivos") renderContent();
  }

  async function selectMcpCentralDevice(control) {
    if (mcpCentralSelecting || mcpRevoking || !signedIn()
        || mcpAuthorityStatus !== "ready" || !mcpAuthority
        || mcpCentralStatus !== "ready" || !mcpCentralTargets || !mcpCentralSelections
        || mcpCentralClient !== control.dataset.mcpCentralSelect
        || mcpCentralTargets.client_id !== mcpCentralClient
        || mcpCentralSelections.client_id !== mcpCentralClient
        || mcpCentralSelections.count !== 1) return;
    const deviceId = mcpAuthorityDevice;
    const ticket = mcpCentralSelections.pending_selections[0];
    const available = mcpCentralTargets.targets.some(t =>
      t.device_id === deviceId && t.reported_online && t.runtime_ready);
    // expires_at belongs only to this pending Owner challenge. A confirmed
    // conversation -> device binding is persistent in Platform and is never
    // renewed, expired or auto-switched here because of heartbeat/offline state.
    if (!available || !ticket || Date.parse(ticket.expires_at) <= Date.now()) return;
    const device = mcpDevices?.find(d => d.device_id === deviceId);
    const client = mcpAuthority.clients.find(c => c.client_id === mcpCentralClient);
    // The challenge belongs to this conversation, not simply any OAuth client.
    // Show the exact code and endpoint in the *first-party* Owner confirmation.
    // No user reply inside ChatGPT is a device-selection authorization.
    if (!window.confirm(
      `${tx("Autorizar esta conversa para o dispositivo ou instalação OrdaX")} — ${client?.client_name || mcpCentralClient}
      / ${device?.name || deviceId} (${deviceId})?\n\n${tx("Confira se este desafio é exatamente o mostrado pelo ChatGPT")}:
      ${ticket.challenge_id}\n\n${tx("O Runtime precisará confirmar o vínculo. Esta ação não concede novas permissões. Depois da confirmação, a instalação escolhida não muda automaticamente quando fica offline ou reinicia.")}`
    )) return;
    const revision = ++mcpCentralRevision, owner = session;
    const clientId = mcpCentralClient;
    mcpCentralSelecting = true;
    mcpCentralNotice = "";
    renderContent();
    try {
      const selected = await account.selectMcpCentralDevice({
        client_id:clientId, challenge_id:ticket.challenge_id,
        device_id:deviceId, confirm:"selecionar",
      });
      if (revision !== mcpCentralRevision || session !== owner || !signedIn()
          || mcpAuthorityDevice !== deviceId) return;
      if (selected.status !== "pending" || selected.attested !== false
          || selected.dispatch_authorized !== false)
        throw new Error("mcp-central-unconfirmed");
      mcpCentralNotice = "Vínculo solicitado. Aguarde confirmação do Runtime; controle remoto ainda não atestado.";
      mcpCentralStatus = "pending";
    } catch {
      if (revision !== mcpCentralRevision || session !== owner || !signedIn()) return;
      mcpCentralTargets = null;
      mcpCentralSelections = null;
      mcpCentralStatus = "unavailable";
      mcpCentralNotice = "Seleção não confirmada. Consulte novamente antes de outra tentativa.";
    } finally {
      if (revision === mcpCentralRevision && session === owner && signedIn()) {
        mcpCentralSelecting = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  async function loadMcpAuthority(deviceId) {
    // A denied/late selection must not invalidate an in-flight revocation.
    // Advancing revision first would strand mcpRevoking=true in its finally.
    if (!signedIn() || mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating
        || mcpDevicesStatus !== "ready"
        || !mcpDevices?.some(d => d.device_id === deviceId)) return;
    const revision = ++mcpAuthorityRevision;
    resetMcpCentral();
    mcpAuthorityDevice = deviceId;
    mcpAuthority = null;
    mcpAuthorityStatus = "loading";
    mcpRevocationNotice = "";
    if (state.section === "dispositivos") renderContent();
    try {
      const value = await account.readMcpAuthority(deviceId);
      if (revision !== mcpAuthorityRevision || !signedIn()
          || mcpAuthorityDevice !== deviceId) return;
      mcpAuthority = value;
      mcpAuthorityStatus = "ready";
    } catch {
      if (revision !== mcpAuthorityRevision || !signedIn()) return;
      mcpAuthority = null;
      mcpAuthorityStatus = "unavailable";
    }
    if (state.section === "dispositivos") renderContent();
  }

  async function loadMcpProjectOnboarding(deviceId) {
    if (!signedIn() || mcpProjectCreating || mcpProjectBinding || mcpProjectGrantCreating
        || mcpDevicesStatus !== "ready"
        || !mcpDevices?.some(d => d.device_id === deviceId)) return;
    const revision = ++mcpProjectRevision;
    const owner = session;
    mcpProjectDevice = deviceId;
    mcpProjectOnboarding = null;
    mcpProjectStatus = "loading";
    mcpProjectNotice = "";
    if (state.section === "dispositivos") renderContent();
    try {
      const value = await account.readMcpProjectOnboarding(deviceId);
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()
          || mcpProjectDevice !== deviceId) return;
      mcpProjectOnboarding = value;
      mcpProjectStatus = "ready";
      if (mcpProjectBindingIntent) {
        const pending = value.projects.find(item =>
          item.project_id === mcpProjectBindingIntent.project_id);
        if (!pending || pending.next_state !== "needs_device_binding") {
          mcpProjectBindingIntent = null;
        }
      }
    } catch {
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()) return;
      mcpProjectOnboarding = null;
      mcpProjectStatus = "unavailable";
    }
    if (state.section === "dispositivos") renderContent();
  }

  async function createMcpProject(form) {
    if (mcpProjectCreating || mcpProjectBinding || mcpProjectGrantCreating
        || !signedIn() || mcpProjectStatus !== "ready"
        || !mcpProjectOnboarding || !mcpProjectDevice
        || mcpProjectDevice !== mcpAuthorityDevice) return;
    const data = new FormData(form);
    const spaceId = String(data.get("space_id") ?? "");
    const name = String(data.get("name") ?? "").trim();
    const kind = String(data.get("kind") ?? "");
    const kinds = new Set(["general","development","creative","legal","business","research"]);
    if (!mcpProjectOnboarding.spaces.some(space => space.space_id === spaceId)
        || name.length < 1 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)
        || !kinds.has(kind)) return;
    if (!window.confirm(
      `${tx("Criar projeto MCP")} — ${name}?\n\n${tx("Criar o projeto não conecta GitHub, não vincula o dispositivo e não concede permissões.")}`
    )) return;

    const revision = ++mcpProjectRevision;
    const owner = session;
    const deviceId = mcpProjectDevice;
    mcpProjectCreating = true;
    mcpProjectNotice = "";
    renderContent();
    let posted = false;
    try {
      posted = true;
      const created = await account.createMcpProject({
        space_id:spaceId, name, kind, confirm:"create_project",
      });
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()
          || mcpProjectDevice !== deviceId) return;
      const confirmed = await account.readMcpProjectOnboarding(deviceId);
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()) return;
      if (!confirmed.projects.some(project => project.project_id === created.project_id
          && project.space_id === spaceId))
        throw new Error("mcp-owner-project-create-not-reflected");
      mcpProjectOnboarding = confirmed;
      mcpProjectStatus = "ready";
      mcpProjectNotice = "Projeto criado e verificado. O próximo passo continua sendo conectar um repositório GitHub verificado.";
    } catch {
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()) return;
      if (posted) {
        // Safe reconciliation only. Never replay an uncertain Project POST.
        try {
          const reconciled = await account.readMcpProjectOnboarding(deviceId);
          if (revision !== mcpProjectRevision || session !== owner || !signedIn()) return;
          mcpProjectOnboarding = reconciled;
          mcpProjectStatus = "ready";
          mcpProjectNotice = "O resultado da criação não foi confirmado. O estado foi consultado novamente; revise os projetos antes de tentar outra criação.";
        } catch {
          mcpProjectOnboarding = null;
          mcpProjectStatus = "unavailable";
          mcpProjectNotice = "A criação não foi confirmada e o estado atual não pôde ser consultado. Nenhuma nova tentativa será feita automaticamente.";
        }
      }
    } finally {
      if (revision === mcpProjectRevision && session === owner && signedIn()) {
        mcpProjectCreating = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  async function requestMcpProjectDeviceBinding(control) {
    if (mcpProjectBinding || mcpProjectCreating || mcpProjectGrantCreating
        || mcpGithubConnecting || mcpGithubSelecting
        || !signedIn() || mcpProjectStatus !== "ready" || !mcpProjectOnboarding
        || !mcpProjectDevice || mcpProjectDevice !== mcpAuthorityDevice
        || mcpProjectOnboarding.onboarding_availability?.project_device_binding_enabled !== true) return;
    const projectId = control.dataset.mcpProjectBind;
    const project = mcpProjectOnboarding.projects.find(item => item.project_id === projectId);
    if (!project || project.next_state !== "needs_device_binding"
        || !project.repository_full_name) return;
    const deviceId = mcpProjectDevice;
    const device = mcpDevices?.find(item => item.device_id === deviceId);
    if (!device) return;
    if (!window.confirm(
      `${tx("Solicitar vínculo do projeto")} — ${project.name} / ${device.name}?\n\n${tx("A Conta apenas solicita o vínculo. O Runtime deste dispositivo precisa confirmar o projeto local; nenhuma permissão é concedida agora.")}`
    )) return;

    const revision = ++mcpProjectRevision;
    const owner = session;
    mcpProjectBinding = true;
    mcpProjectNotice = "";
    renderContent();
    let posted = false;
    try {
      posted = true;
      const intent = await account.requestMcpProjectDeviceBinding({
        project_id:projectId,
        device_id:deviceId,
        confirm:"bind_project_device",
      });
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()
          || mcpProjectDevice !== deviceId) return;
      mcpProjectBindingIntent = intent;
      mcpProjectNotice = "Pedido de vínculo confirmado. O Runtime precisa reconhecer o projeto local e concluir o vínculo antes de qualquer grant.";
    } catch {
      if (revision !== mcpProjectRevision || session !== owner || !signedIn()) return;
      if (posted) {
        // Safe reconciliation only. Never replay an uncertain binding POST.
        try {
          const reconciled = await account.readMcpProjectOnboarding(deviceId);
          if (revision !== mcpProjectRevision || session !== owner || !signedIn()) return;
          mcpProjectOnboarding = reconciled;
          mcpProjectStatus = "ready";
          const current = reconciled.projects.find(item => item.project_id === projectId);
          if (current?.next_state === "ready_without_grants") {
            mcpProjectBindingIntent = null;
            mcpProjectNotice = "Vínculo do dispositivo confirmado pela Platform. As autorizações de projeto continuam uma etapa explícita e separada.";
          } else {
            mcpProjectBindingIntent = null;
            mcpProjectNotice = "O pedido de vínculo não foi confirmado. O estado foi consultado novamente; revise o projeto antes de outra tentativa.";
          }
        } catch {
          mcpProjectOnboarding = null;
          mcpProjectStatus = "unavailable";
          mcpProjectBindingIntent = null;
          mcpProjectNotice = "O pedido de vínculo não foi confirmado e o estado atual não pôde ser consultado. Nenhuma nova tentativa será feita automaticamente.";
        }
      }
    } finally {
      if (revision === mcpProjectRevision && session === owner && signedIn()) {
        mcpProjectBinding = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  async function createMcpProjectGrant(form) {
    if (mcpProjectGrantCreating || mcpProjectCreating || mcpProjectBinding
        || mcpRevoking || mcpCentralSelecting || mcpGithubConnecting || mcpGithubSelecting
        || !signedIn() || mcpProjectStatus !== "ready" || !mcpProjectOnboarding
        || mcpAuthorityStatus !== "ready" || !mcpAuthority
        || !mcpProjectDevice || mcpProjectDevice !== mcpAuthorityDevice) return;
    const projectId = form.dataset.mcpProjectGrantForm;
    const spaceId = form.dataset.mcpProjectSpace;
    const project = mcpProjectOnboarding.projects.find(item =>
      item.project_id === projectId && item.space_id === spaceId);
    if (!project || project.next_state !== "ready_without_grants"
        || project.space_device_execute !== true || project.project_device_bound !== true
        || !project.repository_full_name) return;

    const data = new FormData(form);
    const clientId = String(data.get("client_id") ?? "");
    const profileKey = String(data.get("profile_key") ?? "");
    const unbounded = data.get("unbounded") === "on";
    const localExpiry = String(data.get("valid_until") ?? "").trim();
    const client = mcpAuthority.clients.find(item => item.client_id === clientId);
    if (!client || !["project-native-terminal","project-native-process","project-blender-control"].includes(profileKey))
      return;
    let validUntil = null;
    if (!unbounded) {
      if (!localExpiry) {
        mcpProjectNotice = "Escolha uma data de expiração ou marque Sem expiração.";
        renderContent();
        return;
      }
      const timestamp = Date.parse(localExpiry);
      const now = Date.now();
      if (!Number.isFinite(timestamp) || timestamp <= now
          || timestamp > now + 365 * 24 * 60 * 60 * 1000) {
        mcpProjectNotice = "A validade precisa estar no futuro e dentro de um ano.";
        renderContent();
        return;
      }
      validUntil = new Date(timestamp).toISOString();
    }

    const device = mcpDevices?.find(item => item.device_id === mcpProjectDevice);
    const profileLabel = profileKey === "project-native-terminal"
      ? tx("Terminal do projeto") : profileKey === "project-native-process"
        ? tx("Processos do projeto") : tx("Blender do projeto");
    const expiryLabel = validUntil
      ? new Date(validUntil).toLocaleString(i18n.getLocale()) : tx("Sem expiração");
    if (!window.confirm(
      `${tx("Autorizar ações do projeto")} — ${project.name}?\n\n${client.client_name} · ${profileLabel}\n${tx("Validade")}: ${expiryLabel}\n${device?.name || mcpProjectDevice}`
    )) return;

    const revision = ++mcpProjectGrantRevision;
    const owner = session;
    const deviceId = mcpProjectDevice;
    mcpProjectGrantCreating = true;
    mcpProjectNotice = "";
    renderContent();
    const expected = {
      device_id:deviceId, client_id:clientId, space_id:spaceId, project_id:projectId,
      profile_key:profileKey, valid_until:validUntil,
    };
    try {
      const receipt = await account.createMcpProjectGrant({
        ...expected, confirm:"authorize_project",
      });
      if (revision !== mcpProjectGrantRevision || session !== owner || !signedIn()
          || mcpProjectDevice !== deviceId) return;
      const confirmed = await account.readMcpAuthority(deviceId);
      if (revision !== mcpProjectGrantRevision || session !== owner || !signedIn()) return;
      const exact = confirmed.grant_groups.filter(group =>
        group.grant_group_id === receipt.grant_group_id
          && group.client_id === clientId && group.profile_key === profileKey
          && group.scope_kind === "project" && group.space_id === spaceId
          && group.project_id === projectId && group.client_consent_active
          && (validUntil === null ? group.valid_until === null
            : group.valid_until !== null
              && Date.parse(group.valid_until) === Date.parse(validUntil)));
      if (exact.length !== 1) throw new Error("mcp-project-grant-not-reflected");
      mcpAuthority = confirmed;
      mcpAuthorityStatus = "ready";
      resetMcpCentral();
      mcpProjectNotice = "Autorização do projeto criada e verificada na Platform.";
    } catch {
      if (revision !== mcpProjectGrantRevision || session !== owner || !signedIn()) return;
      // Never replay an uncertain grant POST. Reconcile only by reading the
      // canonical authority and accept success only for one exact scoped grant.
      try {
        const reconciled = await account.readMcpAuthority(deviceId);
        if (revision !== mcpProjectGrantRevision || session !== owner || !signedIn()) return;
        const matching = reconciled.grant_groups.filter(group =>
          group.client_id === clientId && group.profile_key === profileKey
            && group.scope_kind === "project" && group.space_id === spaceId
            && group.project_id === projectId && group.client_consent_active
            && (validUntil === null ? group.valid_until === null
              : group.valid_until !== null
                && Date.parse(group.valid_until) === Date.parse(validUntil)));
        mcpAuthority = reconciled;
        mcpAuthorityStatus = "ready";
        resetMcpCentral();
        mcpProjectNotice = matching.length === 1
          ? "A resposta do POST foi incerta, mas a autorização exata foi confirmada pela leitura canônica."
          : "A autorização não foi confirmada. O estado foi consultado novamente; revise antes de tentar outra ação.";
      } catch {
        mcpAuthority = null;
        mcpAuthorityStatus = "unavailable";
        mcpProjectNotice = "A autorização não foi confirmada e o estado atual não pôde ser consultado. Nenhuma nova tentativa será feita automaticamente.";
      }
    } finally {
      if (revision === mcpProjectGrantRevision && session === owner && signedIn()) {
        mcpProjectGrantCreating = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  async function reauthorizeMcpDeviceGrant(control) {
    if (mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating
        || !signedIn() || mcpAuthorityStatus !== "ready" || !mcpAuthority) return;
    const deviceId = control.dataset.mcpDevice;
    const clientId = control.dataset.mcpClient;
    const groupId = control.dataset.mcpGroup;
    const grant = mcpAuthority.grant_groups.find(g => g.grant_group_id === groupId
      && g.client_id === clientId && g.scope_kind === "device"
      && g.client_consent_active === true);
    if (deviceId !== mcpAuthorityDevice || deviceId !== mcpAuthority.device_id || !grant) return;
    const device = mcpDevices?.find(d => d.device_id === deviceId);
    const client = mcpAuthority.clients.find(c => c.client_id === clientId);
    const clientName = client?.client_name || clientId;
    if (!window.confirm(`${tx("Reautorizar perfil")} — ${clientName} / ${device?.name || deviceId}?\n\n${tx("A Platform aplicará novamente o mesmo perfil canônico atual. Nenhuma capability é escolhida no navegador.")}`)) return;
    const revision = ++mcpAuthorityRevision;
    mcpRevoking = true;
    mcpRevocationNotice = "";
    renderContent();
    try {
      const receipt = await account.reauthorizeMcpGrant({
        device_id:deviceId, client_id:clientId, grant_group_id:groupId, confirm:"reauthorize",
      });
      if (revision !== mcpAuthorityRevision || !signedIn()
          || mcpAuthorityDevice !== deviceId) return;
      const confirmed = await account.readMcpAuthority(deviceId);
      if (revision !== mcpAuthorityRevision || !signedIn()) return;
      const replacement = confirmed.grant_groups.find(g =>
        g.grant_group_id === receipt.grant_group_id && g.client_id === clientId
          && g.profile_key === receipt.profile_key && g.scope_kind === "device");
      if (!replacement || (receipt.grant_group_id !== groupId
          && confirmed.grant_groups.some(g => g.grant_group_id === groupId)))
        throw new Error("mcp-owner-reauthorize-not-reflected");
      mcpAuthority = confirmed;
      mcpAuthorityStatus = "ready";
      resetMcpCentral();
      mcpRevocationNotice = "Perfil reautorizado e verificado pela autoridade canônica.";
    } catch {
      if (revision !== mcpAuthorityRevision || !signedIn()) return;
      mcpAuthority = null;
      mcpAuthorityStatus = "unavailable";
      mcpRevocationNotice = "A reautorização não foi confirmada. Consulte novamente antes de tentar outra ação.";
    } finally {
      if (revision === mcpAuthorityRevision && signedIn()) {
        mcpRevoking = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  async function revokeMcpDeviceGrant(control) {
    if (mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating
        || !signedIn() || mcpAuthorityStatus !== "ready" || !mcpAuthority) return;
    const deviceId = control.dataset.mcpDevice;
    const clientId = control.dataset.mcpClient;
    const groupId = control.dataset.mcpGroup;
    if (deviceId !== mcpAuthorityDevice || deviceId !== mcpAuthority.device_id
        || !mcpAuthority.grant_groups.some(g => g.grant_group_id === groupId
          && g.client_id === clientId)) return;
    const device = mcpDevices?.find(d => d.device_id === deviceId);
    const client = mcpAuthority.clients.find(c => c.client_id === clientId);
    const clientName = client?.client_name || clientId;
    // Native browser confirmation: the user, not a model or stale device row,
    // initiates the exact grant mutation. No optimistic revoke or DELETE replay.
    if (!window.confirm(`${tx("Revogar autorização")} — ${clientName} / ${device?.name || deviceId}?`)) return;
    const revision = ++mcpAuthorityRevision;
    mcpRevoking = true;
    mcpRevocationNotice = "";
    renderContent();
    try {
      await account.revokeMcpGrant({
        device_id:deviceId, client_id:clientId, grant_group_id:groupId, confirm:"revogar",
      });
      if (revision !== mcpAuthorityRevision || !signedIn()
          || mcpAuthorityDevice !== deviceId) return;
      // Read back every group from the Platform. Never hide a row merely
      // because the POST returned 200.
      const confirmed = await account.readMcpAuthority(deviceId);
      if (revision !== mcpAuthorityRevision || !signedIn()) return;
      if (confirmed.grant_groups.some(g => g.grant_group_id === groupId && g.client_id === clientId))
        throw new Error("mcp-owner-revoke-not-reflected");
      mcpAuthority = confirmed;
      mcpAuthorityStatus = "ready";
      resetMcpCentral();
      mcpRevocationNotice = "Autorização revogada e verificada.";
    } catch {
      if (revision !== mcpAuthorityRevision || !signedIn()) return;
      mcpAuthority = null;
      mcpAuthorityStatus = "unavailable";
      mcpRevocationNotice = "A revogação não foi confirmada. Consulte novamente antes de tentar outra ação.";
    } finally {
      if (revision === mcpAuthorityRevision && signedIn()) {
        mcpRevoking = false;
        if (state.section === "dispositivos") renderContent();
      }
    }
  }

  async function loadMcpDevices() {
    const revision = ++mcpDevicesRevision;
    if (!signedIn()) return;
    mcpDevicesStatus = "loading";
    if (state.section === "dispositivos") renderContent();
    try {
      const result = await account.readMcpDevices();
      if (revision !== mcpDevicesRevision || !signedIn()) return;
      mcpDevices = result.devices;
      mcpDevicesStatus = "ready";
    } catch {
      if (revision !== mcpDevicesRevision || !signedIn()) return;
      mcpDevices = null;
      mcpDevicesStatus = "unavailable";
    }
    if (state.section === "dispositivos") renderContent();
  }

  async function loadSubscription() {
    const revision = ++subscriptionRevision;
    if (!signedIn()) return;
    subscriptionStatus = "loading";
    if (["assinatura", "visao-geral"].includes(state.section)) renderContent();
    try {
      const value = await account.readSubscription();
      if (revision !== subscriptionRevision || !signedIn()) return;
      subscriptionView = value;
      subscriptionStatus = "ready";
    } catch {
      if (revision !== subscriptionRevision || !signedIn()) return;
      subscriptionView = null;
      subscriptionStatus = "unavailable";
    }
    if (["assinatura", "visao-geral"].includes(state.section)) renderContent();
  }

  function subscriptionPresentation() {
    const view = subscriptionStatus === "ready" ? subscriptionView : null;
    const recorded = view && view.status !== "unverified";
    const name = recorded ? "OrdaX " + view.planId.charAt(0).toUpperCase()
      + view.planId.slice(1) : "Plano não disponível";
    const lifecycleNames = {
      trialing: "Em avaliação", active: "Ativa", past_due: "Pagamento pendente",
      unpaid: "Pagamento não confirmado", canceled: "Cancelada",
      incomplete: "Incompleta", expired: "Expirada",
    };
    const status = recorded
      ? view.status === "stale" ? "Vigência não confirmada"
        : lifecycleNames[view.lifecycle]
      : subscriptionStatus === "loading" ? "Consultando assinatura"
        : view ? "Nenhuma assinatura confirmada no registro"
        : "Assinatura indisponível";
    const period = recorded && view.currentPeriodEnd
      ? new Intl.DateTimeFormat(i18n.getLocale(), { dateStyle: "medium" })
        .format(new Date(view.currentPeriodEnd))
      : "Não disponível";
    return { name, status, period, recorded, view };
  }

  async function loadMcpUsage() {
    const revision = ++mcpUsageRevision;
    if (!signedIn()) return;
    mcpUsageStatus = "loading";
    if (state.section === "consumo") renderContent();
    try {
      const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(10000) : undefined;
      const value = await account.readMcpUsage(signal);
      if (!value || value.ok !== true || value.schema !== "ordax.product-mcp-usage/1"
          || value.billable !== false || value.observed_only !== true
          || value.coverage !== "partial_observational"
          || typeof value.collection_active_now !== "boolean"
          || value.quota !== null || value.charge !== null
          || !/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(value.current_month)
          || !/^\d{4}-(?:0[1-9]|1[0-2])-01$/.test(value.previous_month)
          || !Array.isArray(value.entries) || value.entries.length > 256
          || !value.entries.every(row => row && (row.month === value.current_month || row.month === value.previous_month)
            && /^[a-z][a-z0-9._-]{1,95}$/.test(row.tool_name)
            && Number.isSafeInteger(row.tool_calls) && row.tool_calls >= 0)) {
        throw new Error("mcp-usage-invalid");
      }
      if (revision !== mcpUsageRevision || !signedIn()) return;
      mcpUsage = value;
      mcpUsageStatus = "ready";
    } catch {
      if (revision !== mcpUsageRevision || !signedIn()) return;
      mcpUsage = null;
      mcpUsageStatus = "unavailable";
    }
    if (state.section === "consumo") renderContent();
  }

  function mcpUsagePanel() {
    const title = tx("Chamadas MCP observadas");
    let measurement = tx("Medição ainda não disponível");
    if (mcpUsageStatus === "loading") measurement = tx("Consultando registros");
    if (mcpUsageStatus === "ready" && mcpUsage) {
      const rows = mcpUsage.entries.filter(item => item.month === mcpUsage.current_month);
      const total = rows.reduce((value, item) => value + item.tool_calls, 0);
      measurement = rows.length && Number.isSafeInteger(total)
        ? esc(new Intl.NumberFormat(i18n.getLocale()).format(total))
        : tx("Nenhuma amostra disponível");
    }
    return `<section class="settings-section usage-mcp-panel" aria-label="${title}">
      <div class="panel-heading"><div><span class="icon-tile cyan">${icon("activity")}</span><h3>${title}</h3></div></div>
      <p class="billing-large" aria-live="polite">${measurement}</p>
      <p class="panel-description">${tx("Somente registros observados no mês UTC. Não representam franquia, cobrança ou uso completo.")}</p>
      ${mcpUsageStatus === "ready" && mcpUsage && !mcpUsage.collection_active_now
        ? `<p class="data-note">${tx("A coleta MCP está desativada neste momento.")}</p>` : ""}
      <p class="data-note">${tx("Os demais recursos e limites continuam indisponíveis até a integração dos serviços oficiais.")}</p>
    </section>`;
  }

  const signedIn = () => !layoutPreview && session.status === "authenticated";
  const sessionKey = () => session.status === "authenticated" ? "active" : session.status;
  const sessionTitle = () => layoutPreview ? tx("Prévia local da Conta") : message(`account.session.${sessionKey()}.title`);

  function capabilityState(id) {
    const definition = capabilityDefinitions[id];
    if (!definition) throw new Error("public-account-capability-unknown");
    const verified = signedIn() && ((id === "portalLocale"
        && Boolean(session.preferredLocale) && session.preferredLocale === i18n.getLocale())
      || id === "browserSession"
      || (id === "accountEmail" && Boolean(session.email))
      || (id === "dataExport" && session.dataExportEnabled === true)
      || (id === "subscription" && subscriptionStatus === "ready"
        && subscriptionView?.status === "verified"));
    const status = verified ? "verified" : definition.local ? "local" : "pending";
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
    const exportReady = id === "dataExport" && signedIn() && session.dataExportEnabled === true;
    const exportControl = id === "dataExport";
    return settingRow({ ...definition, id, title: definition.viewTitle || definition.title,
      status: capabilityBadge(id),
      hint: exportReady ? "A cópia contém dados pessoais. O transporte admite até 2 MiB; arquivos maiores exigem outra forma de exportação." : definition.hint,
      control: action(definition.action, null, {
        variant: definition.destructive ? "destructive" : "outline",
        describedBy: `${id}-hint`,
        disabled: exportControl ? !exportReady || accountExportBusy : true,
        data: exportControl ? "data-account-export" : "",
      }),
    });
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
  function mcpDeviceRecords() {
    if (mcpDevicesStatus !== "ready" || !mcpDevices) {
      return pendingRecords({ caption: "Computadores OrdaX MCP", columns: ["Dispositivo", "Última atividade", "Estado", "Autorizações"],
        title: mcpDevicesStatus === "loading" ? "Consultando computadores" : "Computadores indisponíveis",
        description: mcpDevicesStatus === "loading" ? "Consultando a Platform." : "O cadastro não pôde ser verificado. Nenhum resultado será presumido.", iconName: "devices" });
    }
    if (!mcpDevices.length) return empty("Nenhum computador registrado", "A Platform confirmou que esta conta não tem dispositivos cadastrados.", "devices", true);
    return `<table class="records-table"><caption class="sr-only">${tx("Computadores OrdaX MCP")}</caption><thead><tr>${["Dispositivo", "Última atividade", "Estado", "Autorizações"].map(x => `<th scope="col">${tx(x)}</th>`).join("")}</tr></thead><tbody>${mcpDevices.map(device => {
      const state = device.online ? device.runtime_ready ? "Online · Runtime pronto" : "Online · Runtime não confirmado" : "Offline";
      const seen = device.last_seen_at ? new Date(device.last_seen_at).toLocaleString(i18n.getLocale()) : "Sem atividade registrada";
      return `<tr><th scope="row"><strong>${esc(device.name)}</strong><small translate="no">${esc(device.device_id)}</small></th><td>${esc(seen)}</td><td><span class="status-tag${device.online && device.runtime_ready ? " is-verified" : ""}">${tx(state)}</span></td><td>${action("Autorizações", null, { disabled:mcpRevoking || mcpCentralSelecting || mcpProjectCreating || mcpProjectBinding || mcpProjectGrantCreating, small:true, data:`data-mcp-device="${esc(device.device_id)}"` })}</td></tr>`;
    }).join("")}</tbody></table>`;
  }
  function mcpProjectPanel() {
    if (!mcpAuthorityDevice) return "";
    const device = mcpDevices?.find(d => d.device_id === mcpAuthorityDevice);
    if (!device) return "";
    const notice = mcpProjectNotice
      ? `<p class="device-revoke-note" role="status">${icon("info")}${tx(mcpProjectNotice)}</p>` : "";
    if (mcpProjectDevice !== mcpAuthorityDevice || mcpProjectStatus !== "ready"
        || !mcpProjectOnboarding) {
      const label = mcpProjectStatus === "loading" && mcpProjectDevice === mcpAuthorityDevice
        ? "Consultando projetos" : "Projetos indisponíveis";
      return `<section class="settings-section" aria-labelledby="mcp-projects-heading">
        <h3 id="mcp-projects-heading">${tx("Projetos MCP")} · ${esc(device.name)}</h3>
        <p role="status">${tx(label)}</p>${notice}</section>`;
    }

    const value = mcpProjectOnboarding;
    const githubConfigured = value.onboarding_availability.github_authorization_configured === true;
    const bindingEnabled = value.onboarding_availability.project_device_binding_enabled === true;
    const stateLabels = {
      needs_github_installation:"GitHub ainda não conectado",
      needs_repository_selection:"Repositório ainda não selecionado",
      needs_device_binding:"Dispositivo ainda não vinculado ao projeto",
      ready_without_grants:"Pronto para autorizações explícitas",
    };
    const rows = value.projects.map(project => {
      const githubReady = mcpGithubStatus === "ready"
        && mcpGithubCandidates?.project_id === project.project_id;
      const canAuthorize = ["needs_github_installation","needs_repository_selection"].includes(
        project.next_state) && !githubReady;
      const githubControl = canAuthorize
        ? `<button type="button" class="button outline h-8"
            data-mcp-github-connect="${esc(project.project_id)}"
            ${!githubConfigured || mcpGithubConnecting || mcpGithubSelecting || mcpProjectCreating || mcpProjectBinding || mcpProjectGrantCreating ? "disabled" : ""}>
            ${icon("globe")}${tx(project.next_state === "needs_repository_selection"
              ? "Verificar GitHub novamente" : "Conectar GitHub")}</button>`
        : "";
      const pendingBinding = project.next_state === "needs_device_binding"
        && mcpProjectBindingIntent?.project_id === project.project_id
        && mcpProjectBindingIntent.device_id === mcpProjectDevice
        && Date.parse(mcpProjectBindingIntent.expires_at) > Date.now();
      const bindingControl = project.next_state === "needs_device_binding"
        ? `<button type="button" class="button outline h-8"
            data-mcp-project-bind="${esc(project.project_id)}"
            ${mcpProjectBinding || mcpProjectCreating || mcpProjectGrantCreating
              || mcpGithubConnecting || mcpGithubSelecting || pendingBinding || !bindingEnabled ? "disabled" : ""}>
            ${icon("devices")}${tx(pendingBinding ? "Aguardando Runtime" : "Vincular a este dispositivo")}</button>`
        : "";
      const activeProjectGrants = mcpAuthorityStatus === "ready" && mcpAuthority
        ? mcpAuthority.grant_groups.filter(group =>
          group.scope_kind === "project"
            && group.space_id === project.space_id
            && group.project_id === project.project_id
            && group.client_consent_active
            && (group.valid_until === null || Date.parse(group.valid_until) > Date.now()))
        : [];
      const grantNames = activeProjectGrants.map(group =>
        group.profile_key === "project-native-terminal" ? tx("Terminal do projeto")
          : group.profile_key === "project-native-process" ? tx("Processos do projeto")
            : group.profile_key === "project-blender-control" ? tx("Blender do projeto")
              : esc(group.profile_key));
      const grantSummary = grantNames.length
        ? `<small class="device-revoke-note">${tx("Autorizações ativas")}: ${grantNames.join(" · ")}</small>`
        : "";
      const grantClients = mcpAuthorityStatus === "ready" && mcpAuthority
        ? mcpAuthority.clients : [];
      const clientOptions = grantClients.map(client =>
        `<option value="${esc(client.client_id)}">${esc(client.client_name)}</option>`).join("");
      const grantForm = project.next_state === "ready_without_grants" && clientOptions
        ? `<form data-mcp-project-grant-form="${esc(project.project_id)}"
            data-mcp-project-space="${esc(project.space_id)}" class="profile-field-group">
            <div class="form-grid">
              <label class="form-field"><span>${tx("Cliente OAuth")}</span>
                <select name="client_id" required>${clientOptions}</select></label>
              <label class="form-field"><span>${tx("Perfil de acesso")}</span>
                <select name="profile_key" required>
                  <option value="project-native-terminal">${tx("Terminal do projeto")}</option>
                  <option value="project-native-process">${tx("Processos do projeto")}</option>
                  <option value="project-blender-control">${tx("Blender do projeto")}</option>
                </select></label>
              <label class="form-field"><span>${tx("Validade")}</span>
                <input name="valid_until" type="datetime-local" autocomplete="off"></label>
              <label class="form-field"><span>${tx("Sem expiração")}</span>
                <input name="unbounded" type="checkbox"></label>
            </div>
            <button type="submit" class="button outline h-8"
              ${mcpProjectGrantCreating || mcpProjectCreating || mcpProjectBinding
                || mcpGithubConnecting || mcpGithubSelecting || mcpRevoking ? "disabled" : ""}>
              ${icon("shield")}${tx(mcpProjectGrantCreating ? "Autorizando" : "Autorizar ações")}</button>
          </form>`
        : project.next_state === "ready_without_grants"
          ? `<small class="device-revoke-note">${tx("Nenhum cliente OAuth consentido está disponível para receber um grant de projeto.")}</small>`
          : "";
      return `<tr>
        <th scope="row"><strong>${esc(project.name)}</strong><small translate="no">${esc(project.project_id)}</small></th>
        <td>${esc(project.kind)}</td>
        <td>${project.repository_full_name ? `<span translate="no">${esc(project.repository_full_name)}</span>` : tx("Nenhum repositório verificado")}</td>
        <td><span class="status-tag">${tx(stateLabels[project.next_state] || project.next_state)}</span>
          ${githubControl}${bindingControl}${grantSummary}${grantForm}</td>
      </tr>`;
    }).join("");
    const table = value.projects.length
      ? `<table class="records-table"><caption class="sr-only">${tx("Projetos MCP")}</caption>
        <thead><tr><th scope="col">${tx("Projeto")}</th><th scope="col">${tx("Tipo")}</th>
        <th scope="col">${tx("GitHub")}</th><th scope="col">${tx("Próximo passo")}</th></tr></thead>
        <tbody>${rows}</tbody></table>`
      : `<p>${tx(value.next_state === "needs_project"
          ? "Nenhum projeto foi criado neste Space."
          : "Nenhum projeto MCP foi confirmado.")}</p>`;
    const options = value.spaces.map(space =>
      `<option value="${esc(space.space_id)}">${esc(space.name)} · ${esc(space.kind)}</option>`).join("");
    const form = value.spaces.length ? `<form data-mcp-project-form class="profile-field-group">
      <p class="panel-description">${tx("Criar um projeto apenas registra o escopo canônico. GitHub, vínculo do dispositivo e grants continuam etapas separadas.")}</p>
      <div class="form-grid">
        <label class="form-field"><span>${tx("Space")}</span><select name="space_id" required>${options}</select></label>
        <label class="form-field"><span>${tx("Nome do projeto")}</span><input name="name" type="text" maxlength="120" required autocomplete="off" placeholder="${tx("Ex.: OrdaX Platform")}"></label>
        <label class="form-field"><span>${tx("Tipo")}</span><select name="kind" required>
          <option value="development">${tx("Desenvolvimento")}</option>
          <option value="general">${tx("Geral")}</option>
          <option value="creative">${tx("Criativo")}</option>
          <option value="research">${tx("Pesquisa")}</option>
          <option value="business">${tx("Negócios")}</option>
          <option value="legal">${tx("Jurídico")}</option>
        </select></label>
      </div>
      <div class="form-actions"><span>${icon("info")}${tx("Nenhuma permissão é concedida por esta criação.")}</span>
        <button type="submit" class="button outline h-8"${mcpProjectCreating || mcpProjectBinding || mcpProjectGrantCreating ? " disabled" : ""}>${tx(mcpProjectCreating ? "Criando projeto" : "Criar projeto")}</button>
      </div>
    </form>` : `<p class="device-revoke-note">${icon("info")}${tx("Nenhum Space administrável foi confirmado. Crie ou recupere um Space antes de criar um projeto.")}</p>`;
    const setupNotices = [
      !githubConfigured
        ? `<p class="device-revoke-note" role="status">${icon("info")}${tx("A conexão GitHub ainda não está disponível.")}</p>` : "",
      !bindingEnabled
        ? `<p class="device-revoke-note" role="status">${icon("info")}${tx("O vínculo de projetos ainda não está disponível na Platform.")}</p>` : "",
    ].join("");
    return `<section class="settings-section" aria-labelledby="mcp-projects-heading">
      <h3 id="mcp-projects-heading">${tx("Projetos MCP")} · ${esc(device.name)}</h3>
      <p class="panel-description">${tx("O estado abaixo vem da Platform. Um projeto sem GitHub verificado não autoriza execução remota.")}</p>
      ${table}${form}${setupNotices}${notice}</section>`;
  }

  function mcpGithubPanel() {
    if (!mcpGithubChallenge && !mcpGithubNotice) return "";
    const notice = mcpGithubNotice
      ? `<p class="device-revoke-note" role="status">${icon("info")}${tx(mcpGithubNotice)}</p>` : "";
    if (mcpGithubStatus === "loading") {
      return `<section class="settings-section" aria-labelledby="mcp-github-heading">
        <h3 id="mcp-github-heading">${tx("GitHub do projeto")}</h3>
        <p role="status">${tx("Consultando repositórios GitHub verificados")}</p>${notice}</section>`;
    }
    if (mcpGithubStatus !== "ready" || !mcpGithubCandidates) {
      return notice ? `<section class="settings-section" aria-labelledby="mcp-github-heading">
        <h3 id="mcp-github-heading">${tx("GitHub do projeto")}</h3>${notice}</section>` : "";
    }
    const repositories = mcpGithubCandidates.repositories;
    const options = repositories.map(repository =>
      `<option value="${esc(repository.repository_id)}">${esc(repository.repository_full_name)}
        · ${esc(repository.installation_account_login)}</option>`).join("");
    const selection = repositories.length
      ? `<form data-mcp-github-selection class="profile-field-group">
          <p class="panel-description">${tx("Escolha somente entre os repositórios que o GitHub confirmou para esta autorização.")}</p>
          <label class="form-field"><span>${tx("Repositório GitHub")}</span>
            <select name="repository_id" required>${options}</select></label>
          <div class="form-actions">
            <span>${icon("info")}${tx("Conectar o repositório não vincula um dispositivo nem concede grants.")}</span>
            <button type="submit" class="button outline h-8"${mcpGithubSelecting ? " disabled" : ""}>
              ${tx(mcpGithubSelecting ? "Conectando repositório" : "Conectar repositório")}</button>
          </div>
        </form>`
      : `<p>${tx("Nenhum repositório foi confirmado pelo GitHub nesta autorização.")}</p>`;
    return `<section class="settings-section" aria-labelledby="mcp-github-heading">
      <h3 id="mcp-github-heading">${tx("GitHub do projeto")}</h3>
      <p class="panel-description">${tx("A lista abaixo veio da Platform após verificação server-side no GitHub. IDs de instalação não são aceitos nesta tela.")}</p>
      ${selection}${notice}</section>`;
  }

  function mcpAuthorityPanel() {
    if (!mcpAuthorityDevice) return "";
    const device = mcpDevices?.find(d => d.device_id === mcpAuthorityDevice);
    if (!device) return "";
    const status = mcpAuthorityStatus;
    const notice = mcpRevocationNotice ? `<p class="device-revoke-note" role="status">${icon("info")}${tx(mcpRevocationNotice)}</p>` : "";
    if (status !== "ready" || !mcpAuthority) {
      return `<section class="settings-section" aria-labelledby="mcp-grants-heading">
        <h3 id="mcp-grants-heading">${tx("Autorizações de aplicativos")} · ${esc(device.name)}</h3>
        <p role="status">${tx(status === "loading" ? "Consultando autorizações" : "Autorizações indisponíveis")}</p>
        ${notice}
      </section>`;
    }
    const grants = mcpAuthority.grant_groups;
    const rows = grants.map(grant => {
      const oauthClient = mcpAuthority.clients.find(c => c.client_id === grant.client_id);
      const label = oauthClient?.client_name || grant.client_id;
      const expiry = grant.valid_until
        ? new Date(grant.valid_until).toLocaleString(i18n.getLocale()) : tx("Sem prazo de expiração");
      const revokedConsent = grant.client_consent_active ? "" : ` · ${tx("Consentimento OAuth inativo")}`;
      const revokeControl = action("Revogar", "close", {
        disabled:mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating, small:true,
        data:`data-mcp-revoke data-mcp-device="${esc(device.device_id)}" data-mcp-client="${esc(grant.client_id)}" data-mcp-group="${esc(grant.grant_group_id)}"`,
      });
      const reauthorizeControl = grant.scope_kind === "device" && grant.client_consent_active
        ? action("Reautorizar", "shield", {
            disabled:mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating, small:true,
            data:`data-mcp-reauthorize data-mcp-device="${esc(device.device_id)}" data-mcp-client="${esc(grant.client_id)}" data-mcp-group="${esc(grant.grant_group_id)}"`,
          }) : "";
      return `<tr><th scope="row"><strong>${esc(label)}</strong><small translate="no">${esc(grant.client_id)}</small></th>
        <td>${esc(grant.profile_key)}${revokedConsent}</td><td>${esc(expiry)}</td><td>${reauthorizeControl}${revokeControl}</td></tr>`;
    }).join("");
    const table = grants.length ? `<table class="records-table"><caption class="sr-only">${tx("Autorizações de aplicativos")}</caption>
      <thead><tr><th scope="col">${tx("Cliente OAuth")}</th><th scope="col">${tx("Perfil de acesso")}</th>
      <th scope="col">${tx("Validade")}</th><th scope="col">${tx("Revogar")}</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p>${tx("Nenhuma autorização ativa para este computador.")}</p>`;
    const availableClients = mcpAuthority.clients.filter(c =>
      grants.some(g => g.client_id === c.client_id && g.client_consent_active
        && (!g.valid_until || Date.parse(g.valid_until) > Date.now())));
    const centralButtons = availableClients.map(c =>
      `<button type="button" class="button outline h-8"
        data-mcp-central-client="${esc(c.client_id)}"${mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating ? " disabled" : ""}>
        ${icon("plug")}${tx("Vínculo MCP")} · ${esc(c.client_name)}</button>`).join("");
    let centralDetail = "";
    if (mcpCentralClient) {
      const target = mcpCentralTargets?.targets.find(t =>
        t.device_id === mcpAuthorityDevice && t.reported_online && t.runtime_ready);
      const tickets = mcpCentralSelections?.pending_selections ?? [];
      const ticket = tickets.length === 1 ? tickets[0] : null;
      const ready = mcpCentralStatus === "ready" && target
        && mcpCentralSelections?.count === 1 && ticket
        && Date.parse(ticket.expires_at) > Date.now();
      const challengeReceipt = mcpCentralStatus === "ready" && ticket
        ? `<p class="panel-description"><strong>${tx("Desafio desta conversa — compare com o código do ChatGPT")}:</strong>
          <code translate="no">${esc(ticket.challenge_id)}</code>
          <small>${tx("Expira em")} ${esc(new Date(ticket.expires_at).toLocaleString(i18n.getLocale()))}</small></p>`
        : "";
      const description = mcpCentralStatus === "loading"
        ? "Consultando desafios e computadores autorizados."
        : mcpCentralStatus === "pending"
          ? "Aguardando confirmação do Runtime."
          : mcpCentralStatus === "ready"
            ? !target
              ? "Este dispositivo não possui grant de ação e Runtime elegível para este novo vínculo."
              : !ticket
                ? "Não existe um desafio único e válido aguardando seleção."
                : "O dispositivo está elegível. Compare o código do desafio com o informado pelo ChatGPT antes de confirmar."
            : "A criação de vínculo MCP está indisponível.";
      centralDetail = `<div class="device-revoke-note" role="status">${tx(description)}
        ${challengeReceipt}
        ${ready ? action("Confirmar esta instalação para a conversa", "shield", {
          disabled:mcpRevoking || mcpCentralSelecting || mcpProjectGrantCreating, small:true,
          data:`data-mcp-central-select="${esc(mcpCentralClient)}"`,
        }) : ""}</div>`;
    }
    const centralPanel = availableClients.length
      ? `<div class="panel-actions" aria-label="${tx("Vínculo MCP Owner")}">
        <p>${tx("Selecione o cliente OAuth autorizado somente para um desafio pendente. O vínculo confirmado persiste na Platform até revogação explícita; offline, heartbeat atrasado ou reinício não escolhem outra instalação.")}</p>
        <div>${centralButtons}</div></div>${centralDetail}`
      : "";
    const centralNotice = mcpCentralNotice
      ? `<p class="device-revoke-note" role="status">${icon("info")}${tx(mcpCentralNotice)}</p>` : "";
    return `<section class="settings-section" aria-labelledby="mcp-grants-heading">
      <h3 id="mcp-grants-heading">${tx("Autorizações de aplicativos")} · ${esc(device.name)}</h3>
      <p class="panel-description">${tx("Reautorizar reaplica o mesmo perfil canônico atual; revogar remove apenas o grant selecionado, sem desconectar outros computadores.")}</p>
      ${table}${centralPanel}${centralNotice}${notice}</section>`;
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
    if (!template?.content?.querySelector(".commercial-catalog")) return empty("Catálogo de planos indisponível", "Os planos e benefícios serão exibidos aqui quando o catálogo oficial estiver disponível.", "crown", true);
    return template.innerHTML;
  }

  function authDateLabel(field, includeTime = false) {
    const value = signedIn() && typeof session[field] === "string" ? session[field] : "";
    if (!value || !Number.isFinite(Date.parse(value))) return tx("Não disponível");
    const format = includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" };
    return esc(new Intl.DateTimeFormat(i18n.getLocale(), format).format(new Date(value)));
  }

  function overview() {
    const quickLinks = ["preferencias", "privacidade", "integracoes", "atividade"];
    return `<header class="account-intro"><div><h1 tabindex="-1">${tx("Minha Conta")}</h1><p>${tx("Seu perfil, seus serviços e suas escolhas.")}</p></div>${link("dados-pessoais", "", "button outline", `${icon("user")}${tx("Dados pessoais")}`)}</header>
      <section class="identity-card" aria-labelledby="overview-profile-title">
        <div class="identity-content"><span class="eyebrow">${tx("SEU PERFIL ORDAX")}</span><div class="identity-person"><span class="identity-avatar">${icon("user")}</span><div><h2 id="overview-profile-title">${signedIn() && session.displayName ? esc(session.displayName) : tx("Sua conta OrdaX")}</h2><p class="verified-email"${signedIn() && session.email ? ' translate="no"' : ""}>${signedIn() && session.email ? esc(session.email) : tx("E-mail não disponível")}</p></div></div><div class="identity-bottom"><dl><div><dt>${tx("Tipo de conta")}</dt><dd>${tx("Não disponível")}</dd></div><div><dt>${tx("Membro desde")}</dt><dd>${authDateLabel("registeredAt")}</dd></div></dl>${link("dados-pessoais", "", "text-link", `${tx("Ver perfil")}${icon("arrow-right")}`)}</div></div>
        <div class="identity-art" aria-hidden="true"><img src="${LANDSCAPE}" width="1920" height="640" alt=""><span>${tx("Uma conta.")}<br>${tx("Todos os seus mundos.")}</span></div>
      </section>
      <div class="account-overview-grid"><div class="overview-primary">
        <section class="account-card account-services">${panelHeading("Plano e faturamento", { iconName: "crown", tone: "violet", end: `<span class="status-tag">${tx("Recursos pendentes")}</span>` })}<dl class="service-facts">${[["Plano atual", subscriptionPresentation().name], ["Vigência", subscriptionPresentation().period], ["Próxima cobrança", "Não disponível"]].map(([label,value]) => `<div><dt>${tx(label)}</dt><dd>${tx(value)}</dd></div>`).join("")}</dl><div class="panel-actions">${link("assinatura", "", "button", `${tx("Ver assinatura")}${icon("arrow-right")}`)}${link("faturamento", "", "text-link", `${tx("Pagamentos e faturas")}${icon("chevron-right")}`)}</div></section>
        <section class="account-card account-usage">${panelHeading("Consumo de recursos", { iconName: "chart", tone: "cyan", end: `${link("consumo", "", "text-link", `${tx("Ver detalhes")}${icon("arrow-up-right")}`)}` })}${resourceTable()}<p class="data-note">${icon("info")}${tx("Aguardando dados de consumo")}</p><details class="usage-history"><summary>${icon("history")}<span>${tx("Histórico de consumo")}</span>${icon("chevron-down")}</summary><div class="chart-legend">${resources.map(resource => `<span><i class="legend-${resource.tone}"></i>${tx(resource.label)}</span>`).join("")}</div>${chart()}${link("consumo", "", "text-link", `${tx("Explorar consumo")}${icon("arrow-right")}`)}</details></section>
      </div><aside class="overview-aside" aria-label="${tx("Acesso e preferências")}">
        <section class="account-card account-safety">${panelHeading("Segurança e acesso", { iconName: "shield", tone: "mint" })}<p class="panel-description">${tx("Cuide do acesso à sua conta e dos dispositivos conectados.")}</p><dl class="safety-facts"><div><dt>${tx("Verificação em duas etapas")}</dt><dd>${tx("Não disponível")}</dd></div><div><dt>${tx("Sessões e dispositivos")}</dt><dd>${tx("Não disponível")}</dd></div></dl>${link("seguranca", "", "button outline", `${tx("Gerenciar segurança")}${icon("arrow-right")}`)}${link("dispositivos", "", "text-link", `${tx("Meus dispositivos")}${icon("chevron-right")}`)}</section>
        <section class="account-card quick-links"><h2>${tx("Preferências e dados")}</h2><nav aria-label="${tx("Preferências e dados")}">${quickLinks.map(id => { const section = byId.get(id); return link(id, "", "quick-link", `${icon(section.icon)}<span>${tx(section.title)}</span>${icon("chevron-right")}`); }).join("")}</nav></section>
      </aside></div>
      <section class="account-help-strip">${icon("help")}<div><h2>${tx("Precisa de ajuda?")}</h2><p>${tx("Encontre respostas sobre sua conta, assinatura e segurança.")}</p></div>${link("suporte", "", "text-link", `${tx("Central de ajuda")}${icon("arrow-right")}`)}</section>`;
  }

  async function saveDisplayName() {
    if (profileSaveBusy || !signedIn() || session.profileEditEnabled !== true) return;
    const input = document.getElementById("profile-display-name");
    const notice = document.getElementById("profile-edit-status");
    if (!input || !notice) return;
    const proposed = input.value.trim();
    if (!proposed || [...proposed].length > 120
        || /[\u0000-\u001f\u007f]/.test(proposed)) {
      notice.textContent = tx("Informe um nome válido de até 120 caracteres.");
      return;
    }
    const owner = session;
    profileSaveBusy = true;
    const button = document.querySelector("[data-profile-save]");
    if (button) button.disabled = true;
    notice.textContent = tx("Salvando nome de exibição");
    try {
      await account.updateDisplayName(proposed);
      if (session !== owner || !signedIn()) return;
      // Read back the persisted value through the one canonical session port.
      await account.refreshSession();
      if (!signedIn() || session.displayName !== proposed) {
        throw new Error("account-display-name-readback-unconfirmed");
      }
      profileSaveNotice = "Nome de exibição atualizado e confirmado.";
    } catch {
      if (!signedIn()) return;
      profileSaveNotice = "Não foi possível confirmar a alteração. Verifique sua sessão e tente novamente.";
    } finally {
      profileSaveBusy = false;
      if (signedIn() && state.section === "dados-pessoais") {
        if (profileSaveNotice === "Nome de exibição atualizado e confirmado.") {
          renderContent();
        } else {
          // A failed write retains the user's typed text for an explicit retry.
          const status = document.getElementById("profile-edit-status");
          if (status) status.textContent = tx(profileSaveNotice);
          const submit = document.querySelector("[data-profile-save]");
          if (submit && session.profileEditEnabled === true) submit.disabled = false;
        }
      }
    }
  }

  function personal() {
    const canEditDisplayName = signedIn() && session.profileEditEnabled === true;
    const currentName = signedIn() ? (session.displayName || "") : "";
    const nameField = `<label class="form-field"><span>${tx("Nome de exibição")}</span>
      <input id="profile-display-name" type="text" autocomplete="nickname"
        maxlength="120" value="${esc(currentName)}"
        ${canEditDisplayName && !profileSaveBusy ? "" : "disabled"}
        aria-describedby="profile-display-name-hint profile-edit-status">
      <small id="profile-display-name-hint">${tx("Nome pelo qual você prefere ser chamado.")}</small>
    </label>`;
    return `<section class="settings-section personal-photo" aria-labelledby="personal-photo-heading">
      ${panelHeading("Seu perfil", { id: "personal-photo-heading", iconName: "user", tone: "cyan", end: capabilityBadge("profilePhoto") })}
      <div class="profile-edit"><span class="large-avatar" aria-hidden="true">${icon("user")}</span><div><h3>${tx(capabilityDefinitions.profilePhoto.title)}</h3><p>${tx("Uma imagem para identificar seu perfil nos serviços OrdaX.")}</p><small id="profile-photo-status">${tx("A alteração da foto aguarda integração.")}</small></div>${action("Alterar foto", "camera", { small: true, describedBy: "profile-photo-status" })}</div>
    </section>
    <section class="settings-section personal-info" aria-labelledby="personal-info-heading">
      ${panelHeading("Informações pessoais", { id: "personal-info-heading", iconName: "user", tone: "cyan", end: capabilityBadge("profileEdit") })}<p class="panel-description">${tx("Como você se identifica nos serviços OrdaX.")}</p>
      <div class="form-grid">${field("Nome completo", "Não disponível", "text", "", { id: "profile-full-name" })}${nameField}${field("País ou região", "Não disponível", "text", "", { id: "profile-country" })}${field("Documento fiscal", "Não disponível", "text", "", { id: "profile-tax-document" })}</div>
    </section>
    <section class="settings-section personal-contact" aria-labelledby="personal-contact-heading">
      ${panelHeading("Contato", { id: "personal-contact-heading", iconName: "mail", tone: "cyan" })}<p class="panel-description">${tx("Seu e-mail de acesso e suas informações de contato.")}</p>
      <div class="form-grid">${field("E-mail", "Não disponível", "email", "accountEmail", { id: "profile-email", hint: "O e-mail será exibido quando a consulta da conta estiver disponível." })}${field("Telefone", "Não disponível", "tel", "", { id: "profile-phone", hint: "A consulta e a edição do telefone aguardam integração." })}</div>
    </section>
    <div class="form-actions personal-actions"><span id="profile-edit-status" role="status" aria-live="polite">${icon("info")}${tx(profileSaveNotice || (canEditDisplayName ? "Somente o nome de exibição pode ser alterado aqui." : "A edição do perfil aguarda ativação do serviço oficial."))}</span>${action("Salvar nome de exibição", null, { disabled: !canEditDisplayName || profileSaveBusy, variant: "", data: "data-profile-save", describedBy: "profile-edit-status" })}</div>
    ${relatedAreas(["seguranca", "privacidade"], "Segurança e privacidade do perfil")}`;
  }
  function subscription() {
    const commercial = subscriptionPresentation();
    return `<section class="settings-section subscription-summary" aria-labelledby="subscription-heading">${panelHeading("Assinatura atual", { id: "subscription-heading", iconName: "crown", tone: "violet", end: capabilityBadge("subscription") })}<div class="subscription-plan"><span>${tx(capabilityDefinitions.subscription.title)}</span><h3>${tx(commercial.name)}</h3><p role="status">${tx(commercial.status)}${commercial.view?.cancellationScheduled ? ` · ${tx("Cancelamento agendado")}` : ""}</p></div><dl class="subscription-facts">${[["Situação", commercial.status], ["Fim do período confirmado", commercial.period], ["Valor da assinatura", "Não disponível"]].map(([label,value]) => `<div><dt>${tx(label)}</dt><dd>${tx(value)}</dd></div>`).join("")}</dl><div class="panel-actions subscription-actions"><p>${icon("info")}${tx("Alterações e cancelamento aguardam a conexão com o serviço de assinatura.")}</p><div>${action("Alterar plano", "crown")}${action("Cancelar assinatura", null, { variant: "ghost" })}</div></div></section>
      <section class="settings-section subscription-limits">${panelHeading("Limites da conta", { iconName: "chart", tone: "cyan", end: link("consumo", "", "text-link", `${tx("Ver consumo")}${icon("arrow-right")}`) })}<p class="panel-description">${tx("Consulte a capacidade disponível para cada recurso da sua conta.")}</p>${resourceTable({ showUsage: false })}<p class="data-note">${icon("info")}${tx("Os limites serão exibidos quando os benefícios da conta estiverem conectados.")}</p></section>
      <section class="settings-section subscription-catalog">${panelHeading("Planos e benefícios", { iconName: "sparkles", tone: "cyan" })}<p class="panel-description">${tx("Consulte os benefícios previstos e os valores de referência.")}</p>${planCatalog()}<div class="catalog-availability"><p>${icon("info")}${tx("Assinaturas pagas ainda não estão disponíveis.")}</p><p><span>${tx("Contratação")}</span><strong>${tx("Em preparação")}</strong></p></div></section>${relatedAreas(["consumo", "faturamento"], "Consumo e faturamento")}`;
  }
  function consumption() {
    const selectedResources = resources.filter(resource => state.tab === "overview" || resource.id === state.tab);
    return `<section class="settings-section usage-workbench" aria-labelledby="usage-heading">
      <header class="usage-controls"><div><h2 id="usage-heading">${tx("Recursos da conta")}</h2><p>${tx("Consulte o uso e os limites de cada recurso.")}</p></div>${selectPeriod("usage-period", state.period)}</header>
      <div class="segment-tabs" role="tablist" aria-label="${tx("Consumo e limites")}">${Object.entries(resourceTabs).map(([key, title]) => `<button type="button" class="button ghost${state.tab === key ? " selected" : ""}" role="tab" id="usage-tab-${key}" data-usage-tab="${key}" aria-selected="${state.tab === key}" aria-controls="usage-panel" tabindex="${state.tab === key ? "0" : "-1"}">${tx(title)}</button>`).join("")}</div>
      <div id="usage-panel" role="tabpanel" aria-labelledby="usage-tab-${state.tab}" tabindex="0">
        <div class="usage-summary${selectedResources.length === 1 ? " is-single" : ""}">${selectedResources.map(resource => `<article class="usage-stat"><div class="usage-stat-heading">${icon(resource.icon, resource.tone)}<h3>${tx(resource.name)}</h3></div><dl>${["Uso", "Limite"].map(label => `<div><dt>${tx(label)}</dt><dd aria-label="${tx("Não disponível")}">—</dd></div>`).join("")}</dl>${capabilityBadge(resource.capabilityId)}</article>`).join("")}</div>
        <section class="usage-chart-panel" aria-labelledby="usage-history-heading"><header class="chart-heading"><div><h3 id="usage-history-heading">${tx("Histórico de utilização")}</h3><p>${tx(resourceTabs[state.tab])} · ${tx(periods[state.period])}</p></div><div class="chart-actions">${capabilityBadge("usageHistory")}${action("Exportar", "download", { small: true, describedBy: "usage-data-status" })}</div></header><div class="chart-legend">${selectedResources.map(resource => `<span><i class="legend-${resource.tone}"></i>${tx(resource.label)}</span>`).join("")}</div>${chart(state.period, resourceTabs[state.tab])}</section>
        ${(state.tab === "apis" || state.tab === "overview") ? mcpUsagePanel() : ""}
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
    <section class="settings-section security-history" aria-labelledby="security-history-heading">${panelHeading("Histórico de acesso", { id: "security-history-heading", iconName: "history", tone: "cyan", end: link("atividade", "", "text-link", `${tx(byId.get("atividade").title)}${icon("arrow-right")}`) })}<p class="panel-description"><strong>${tx("Último login registrado")}:</strong> ${signedIn() && session.lastSignInAt ? `<time datetime="${esc(session.lastSignInAt)}">${authDateLabel("lastSignInAt", true)}</time>` : tx("Não disponível")}</p>${empty("Histórico de segurança não disponível", "Os eventos de acesso serão consultados pelo serviço de identidade OrdaX.", "history", true)}</section>
    ${relatedAreas(["dispositivos", "privacidade"], "Acesso e privacidade")}`;
  }
  function devices() {
    return `${sessionSection({ related: "seguranca" })}
    <section class="settings-section device-list" aria-labelledby="devices-heading">
      ${panelHeading("Computadores OrdaX MCP", { id: "devices-heading", iconName: "devices", tone: "cyan", end: mcpDevicesStatus === "ready" ? '<span class="status-tag is-verified">Verificado</span>' : capabilityBadge("osDevices") })}
      <p class="panel-description">${tx("Veja computadores registrados na Platform. Presença online não significa permissão de controle remoto.")}</p>
      <p class="device-scope">${tx("Identidade do dispositivo, saúde do Runtime e grants dos aplicativos são estados distintos.")}</p>
      ${mcpDeviceRecords()}
      ${mcpAuthorityPanel()}
      ${mcpProjectPanel()}
      ${mcpGithubPanel()}
      <p class="device-revoke-note" id="device-revoke-note">${icon("info")}${tx("Revogar um grant OAuth não desliga nem remove o computador. A ação exige confirmação e verificação pela Platform.")}</p>
      <div class="panel-actions device-actions">${link("integracoes", "", "text-link", `${tx("Ver autorizações de aplicativos")}${icon("arrow-right")}`)}${link("atividade", "", "text-link", `${tx(byId.get("atividade").title)}${icon("arrow-right")}`)}</div>
    </section>${relatedAreas(["seguranca", "atividade"], "Proteção e histórico da conta")}`;
  }
  async function downloadAccountData() {
    if (!signedIn() || session.dataExportEnabled !== true || accountExportBusy) return;
    const owner = session;
    accountExportBusy = true;
    accountExportNotice = "Preparando cópia privada dos seus dados.";
    if (state.section === "privacidade") renderContent();
    try {
      const payload = await account.readPrivateDataExport();
      if (session !== owner || !signedIn()) return;
      const serialized = JSON.stringify(payload, null, 2) + "\n";
      const file = new Blob([serialized], { type: "application/json;charset=utf-8" });
      const address = URL.createObjectURL(file);
      try {
        const target = document.createElement("a");
        target.href = address;
        target.download = i18n.fromSource("ordax-conta-dados-") + payload.exported_at.slice(0, 10) + ".json";
        target.hidden = true;
        document.body.appendChild(target);
        target.click();
        target.remove();
      } finally {
        // Do not retain a sensitive export in app state or browser storage.
        setTimeout(() => URL.revokeObjectURL(address), 20000);
      }
      accountExportNotice = "Arquivo preparado. Verifique o download no navegador e guarde-o com segurança.";
    } catch {
      if (session === owner && signedIn()) {
        accountExportNotice = "Não foi possível gerar uma exportação confirmada. Tente novamente.";
      }
    } finally {
      accountExportBusy = false;
      if (state.section === "privacidade" && session === owner) renderContent();
    }
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
      ${accountExportNotice ? `<p id="account-export-status" role="status" aria-live="polite">${tx(accountExportNotice)}</p>` : ""}
    </section>${relatedAreas(["preferencias", "integracoes"], "Preferências e acesso aos dados")}`;
  }
  // The chosen locale still works locally for anonymous visitors. Only an
  // explicit authenticated save writes the Account-owned preference.
  async function saveAccountLocale() {
    if (!signedIn() || session.localePreferenceEditEnabled !== true || localeSaveBusy) return;
    const locale = i18n.getLocale();
    if (locale !== "pt-BR" && locale !== "en-US") return;
    const owner = session;
    localeSaveBusy = true;
    localeSaveNotice = "Salvando idioma da conta.";
    if (state.section === "preferencias") renderContent();
    try {
      await account.updatePreferredLocale(locale);
      if (session !== owner || !signedIn()) return;
      // A mutation receipt is not enough: re-read the persisted preference
      // from the canonical authenticated session before claiming success.
      await account.refreshSession();
      if (!signedIn() || session.preferredLocale !== locale)
        throw new Error("locale-readback-unconfirmed");
      localeSaveNotice = "Idioma salvo e confirmado.";
    } catch {
      if (session === owner && signedIn())
        localeSaveNotice = "Não foi possível confirmar o idioma. Tente novamente.";
    } finally {
      localeSaveBusy = false;
      if (state.section === "preferencias" && signedIn()) renderContent();
    }
  }

  function currentCommunicationChoices() {
    if (communicationsDraftSession === session && communicationsDraft) return communicationsDraft;
    const stored = signedIn() ? session.optionalCommunications : null;
    return stored && typeof stored.productDigest === "boolean" && typeof stored.news === "boolean"
      ? stored : { productDigest: false, news: false };
  }

  async function saveOptionalCommunications() {
    if (!signedIn() || session.communicationsPreferenceEditEnabled !== true || communicationsSaveBusy) return;
    const owner = session;
    const draft = currentCommunicationChoices();
    const choices = { productDigest: draft.productDigest, news: draft.news };
    if (typeof choices.productDigest !== "boolean" || typeof choices.news !== "boolean") return;
    communicationsSaveBusy = true;
    communicationsNotice = "Registrando preferências opcionais.";
    if (state.section === "preferencias") renderContent();
    try {
      await account.updateOptionalCommunications(choices);
      if (session !== owner || !signedIn()) return;
      await account.refreshSession();
      if (!signedIn()
          || session.optionalCommunications?.productDigest !== choices.productDigest
          || session.optionalCommunications?.news !== choices.news)
        throw new Error("communications-readback-unconfirmed");
      communicationsNotice = "Preferências registradas. O serviço de envio ainda não está disponível.";
    } catch {
      if (session === owner && signedIn())
        communicationsNotice = "Não foi possível confirmar as preferências. Tente novamente.";
    } finally {
      communicationsSaveBusy = false;
      if (state.section === "preferencias") renderContent();
    }
  }

  function preferences() {
    const locales = window.OrdaXPublicI18nCatalog?.supportedLocales ?? [];
    const material = document.body.dataset.material === "ink" ? "Escuro" : "Claro";
    const localeCanSave = signedIn() && session.localePreferenceEditEnabled === true;
    const localeVerified = localeCanSave && session.preferredLocale === i18n.getLocale();
    const localeHint = localeSaveNotice ||
      (localeVerified ? "Idioma sincronizado com sua conta."
        : localeCanSave ? "Escolha local: salve para sincronizar entre dispositivos."
          : "Entre na Conta OrdaX para sincronizar. O idioma deste navegador continua disponível.");
    return `<section class="settings-section portal-preferences" aria-labelledby="portal-preferences-heading">
      ${panelHeading("Preferências do portal", { id: "portal-preferences-heading", iconName: "sliders", tone: "cyan" })}<p class="panel-description">${tx("A aparência permanece local; o idioma pode ser salvo na sua conta.")}</p>
      <div class="preferences-grid"><article class="preference-panel"><div class="preference-heading"><h3>${tx(capabilityDefinitions.portalLocale.title)}</h3>${capabilityBadge("portalLocale")}</div><p class="preference-description" id="account-locale-hint">${tx("Altere o idioma aqui e salve-o na conta para usar em outros dispositivos.")}</p><label class="locale-field" for="account-locale"><span>${tx("Idioma preferido")}</span><select id="account-locale" aria-describedby="account-locale-hint">${locales.map(locale => `<option value="${esc(locale)}"${i18n.getLocale() === locale ? " selected" : ""}>${message(`locale.selector.${locale}`)}</option>`).join("")}</select></label>
          <div class="panel-actions"><span id="account-locale-status" role="status" aria-live="polite">${tx(localeHint)}</span>${action("Salvar idioma na conta", null, { disabled: !localeCanSave || localeSaveBusy || localeVerified, data: "data-account-save-locale", describedBy: "account-locale-status" })}</div></article>
        <article class="preference-panel"><div class="preference-heading"><h3>${tx("Aparência")}</h3>${capabilityBadge("portalAppearance")}</div><p class="preference-description">${tx("Esta é a aparência atual deste portal.")}</p><div class="appearance-option"><div class="appearance-preview" aria-hidden="true"><span class="appearance-preview-bar"></span><span class="appearance-preview-rail"></span><span class="appearance-preview-content"><i></i><i></i><i></i></span></div><div class="appearance-current"><span>${tx("Visual atual")}</span><strong>${tx(material)}</strong></div></div></article></div>
    </section>
    <section class="settings-section communication-settings" aria-labelledby="communications-heading">
      ${panelHeading("Notificações e comunicações", { id: "communications-heading", iconName: "bell", tone: "cyan" })}
      <p class="panel-description">${tx("Você pode registrar preferências opcionais. Nenhum envio é ativado por esta escolha.")}</p>
      ${settingRow({ ...communicationOptions[0],
        description: "Alertas essenciais pertencem ao serviço de identidade e não podem ser desativados aqui.",
        status: capabilityBadge("communications") })}
      ${[
        { id:"productDigest", option:communicationOptions[1],
          description:"Resumos opcionais de produtos e consumo, quando o canal oficial estiver disponível." },
        { id:"news", option:communicationOptions[2],
          description:"Novidades opcionais do ecossistema, quando o serviço de envio estiver disponível." },
      ].map(item => settingRow({ ...item.option, description:item.description,
        status: signedIn() && session.optionalCommunications
          ? `<span class="status-tag is-verified">${tx("Preferência registrada")}</span>`
          : capabilityBadge("communications"),
        control: `<label class="communication-choice"><span class="sr-only">${tx(item.option.title)}</span>
          <input type="checkbox" data-communication-choice="${item.id}"
            ${currentCommunicationChoices()[item.id] ? "checked" : ""}
            ${signedIn() && session.communicationsPreferenceEditEnabled === true && !communicationsSaveBusy ? "" : "disabled"}
            aria-describedby="communications-status"></label>`,
      })).join("")}
      <div class="panel-actions communication-actions">
        <span id="communications-status" role="status" aria-live="polite">${tx(communicationsNotice ||
          (signedIn() && session.optionalCommunications
            ? "Escolhas registradas na Conta. Entrega de mensagens ainda indisponível."
            : "Nenhuma preferência opcional confirmada. Envio ainda indisponível."))}</span>
        ${action("Salvar preferências de comunicação", null, {
          disabled: !signedIn() || session.communicationsPreferenceEditEnabled !== true || communicationsSaveBusy ||
            (session.optionalCommunications !== null
              && session.optionalCommunications !== undefined
              && currentCommunicationChoices().productDigest === session.optionalCommunications.productDigest
              && currentCommunicationChoices().news === session.optionalCommunications.news),
          data: "data-save-communications", describedBy:"communications-status",
        })}
        ${link("privacidade", "", "text-link", `${tx(byId.get("privacidade").title)}${icon("arrow-right")}`)}
      </div>
    </section>
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
    return matches.length ? matches.map(faq => `<article class="faq-item"><h3><button type="button" class="button ghost" id="faq-question-${faq.id}" data-faq="${faq.id}" aria-expanded="${state.faq === faq.id}" aria-controls="faq-answer-${faq.id}">${tx(faq.q)}${icon("chevron-down")}</button></h3><div class="faq-answer" id="faq-answer-${faq.id}" aria-labelledby="faq-question-${faq.id}"${state.faq === faq.id ? "" : " hidden"}><p>${tx(faq.a)}</p>${link(faq.section, "", "text-link", `${tx(byId.get(faq.section).title)}${icon("arrow-right")}`)}</div></article>`).join("") : `<div class="help-empty">${icon("search")}<h3>${tx("Nenhuma resposta encontrada")}</h3><p>${tx("Tente buscar por plano, fatura, senha ou dados.")}</p><button type="button" class="button outline h-8" data-clear-search="help-search" aria-controls="faq-list">${tx("Ver todas as perguntas")}</button></div>`;
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
    document.getElementById("mobile-navigation").innerHTML = mobileSections.map(item => `<a href="#${item.id}"${state.section === item.id ? ' class="active" aria-current="page"' : ""}>${icon(item.icon)}<span>${tx(item.mobileLabel)}</span></a>`).join("") + `<button type="button" class="button ghost${mobileSectionIds.has(state.section) ? "" : " active"}" id="more-toggle" data-open-more aria-controls="more-dialog" aria-expanded="${moreDialog.open}">${icon("more")}<span>${tx("Mais")}</span></button>`;
    const moreGroups = navigationGroups.map(group => ({ ...group, ids: group.ids.filter(id => !mobileSectionIds.has(id)) })).filter(group => group.ids.length);
    document.getElementById("more-navigation").innerHTML = moreGroups.map(group => `<div class="nav-group"><p class="nav-group-label">${tx(group.title)}</p>${group.ids.map(id => navigationEntry(byId.get(id), "more-link")).join("")}</div>`).join("") + mobileOverflowSections.map(section => navigationEntry(section, "more-link")).join("");
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
    if (changed && requested === "dispositivos" && signedIn()
        && !mcpRevoking && !mcpCentralSelecting && !mcpProjectCreating && !mcpProjectBinding
        && !mcpProjectGrantCreating && !mcpGithubConnecting && !mcpGithubSelecting) {
      // In-flight Owner selection must retain its exact POST receipt. A
      // section revisit cannot reset the revision and permit a second choice.
      // A new idle visit must re-read the Platform, never show old Owner grants
      // as if they were still active; no polling and no duplicate SSOT.
      // An in-flight revoke keeps its revision and performs its own readback.
      mcpDevicesRevision += 1;
      mcpDevices = null;
      mcpDevicesStatus = "unavailable";
      mcpAuthorityRevision += 1;
      mcpAuthority = null;
      mcpAuthorityDevice = null;
      mcpAuthorityStatus = "unavailable";
      mcpRevocationNotice = "";
      resetMcpProjectOnboarding();
      resetMcpCentral();
    }
    closeMore();
    if (dialog.open) dialog.close();
    renderNavigation();
    renderContent({ focus: !initial });
    if (["assinatura", "visao-geral"].includes(state.section) && signedIn() && subscriptionStatus === "unavailable") void loadSubscription();
    if (state.section === "dispositivos" && signedIn() && mcpDevicesStatus === "unavailable") void loadMcpDevices();
    if (state.section === "dispositivos" && signedIn() && mcpGithubChallenge
        && mcpGithubStatus === "unavailable") void loadMcpGithubCandidates();
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
    if (control.matches("[data-save-communications]")) {
      event.preventDefault();
      if (!layoutPreview) void saveOptionalCommunications();
    } else if (control.matches("[data-account-save-locale]")) {
      event.preventDefault();
      if (!layoutPreview) void saveAccountLocale();
    } else if (control.matches("[data-account-export]")) {
      event.preventDefault();
      if (!layoutPreview) void downloadAccountData();
    } else if (control.matches("[data-profile-save]")) {
      event.preventDefault();
      if (!layoutPreview) void saveDisplayName();
    } else if (control.matches("[data-mcp-project-bind]")) {
      event.preventDefault();
      if (!layoutPreview) void requestMcpProjectDeviceBinding(control);
    } else if (control.matches("[data-mcp-github-connect]")) {
      event.preventDefault();
      if (!layoutPreview) void startMcpGithubAuthorization(control);
    } else if (control.matches("[data-mcp-central-select]")) {
      event.preventDefault();
      if (!layoutPreview) void selectMcpCentralDevice(control);
    } else if (control.matches("[data-mcp-central-client]")) {
      event.preventDefault();
      if (!layoutPreview) void loadMcpCentralClient(control.dataset.mcpCentralClient);
    } else if (control.matches("[data-mcp-device]") && !control.matches("[data-mcp-revoke]")) {
      event.preventDefault();
      if (!layoutPreview) {
        void loadMcpAuthority(control.dataset.mcpDevice);
        void loadMcpProjectOnboarding(control.dataset.mcpDevice);
      }
    } else if (control.matches("[data-mcp-reauthorize]")) {
      event.preventDefault();
      if (!layoutPreview) void reauthorizeMcpDeviceGrant(control);
    } else if (control.matches("[data-mcp-revoke]")) {
      event.preventDefault();
      if (!layoutPreview) void revokeMcpDeviceGrant(control);
    } else if (control.matches("[data-refresh-session]")) { if (!layoutPreview) void account.refreshSession(); }
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
  document.addEventListener("submit", event => {
    const grantForm = event.target?.closest?.("[data-mcp-project-grant-form]");
    if (grantForm) {
      event.preventDefault();
      if (!layoutPreview) void createMcpProjectGrant(grantForm);
      return;
    }
    const githubForm = event.target?.closest?.("[data-mcp-github-selection]");
    if (githubForm) {
      event.preventDefault();
      if (!layoutPreview) void selectMcpGithubRepository(githubForm);
      return;
    }
    const form = event.target?.closest?.("[data-mcp-project-form]");
    if (!form) return;
    event.preventDefault();
    if (!layoutPreview) void createMcpProject(form);
  });
  document.addEventListener("input", event => {
    if (event.target.id === "dialog-search") { state.searchQuery = event.target.value; document.getElementById("search-results").innerHTML = searchResults(); updateSearchStatus(); }
    else if (event.target.id === "help-search") { state.helpQuery = event.target.value; updateHelpResults(); }
  });
  document.addEventListener("change", event => {
    if (event.target.id === "usage-period") { state.period = event.target.value; renderContent(); document.getElementById("usage-period").focus({ preventScroll: true }); }
    else if (event.target.id === "activity-period") { state.activityPeriod = event.target.value; renderContent(); document.getElementById("activity-period").focus({ preventScroll: true }); }
    else if (event.target.id === "account-locale") {
      localeSaveNotice = "";
      i18n.setLocale(event.target.value);
    } else if (event.target.matches?.("[data-communication-choice]")) {
      const key = event.target.dataset.communicationChoice;
      if ((key === "productDigest" || key === "news") && signedIn()
          && session.communicationsPreferenceEditEnabled === true && !communicationsSaveBusy) {
        communicationsDraft = { ...currentCommunicationChoices(), [key]: event.target.checked === true };
        communicationsDraftSession = session;
        communicationsNotice = "";
        renderContent();
        document.querySelector(`[data-communication-choice="${key}"]`)?.focus({ preventScroll: true });
      }
    }
  });
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.isComposing) return;
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
      const previousSession = session;
      session = value;
      if (previousSession !== session) {
        communicationsDraft = null;
        communicationsDraftSession = null;
        communicationsNotice = "";
      }
      if (session.status !== "authenticated") {
        localeFromAccountApplied = false;
      } else if (!localeFromAccountApplied) {
        localeFromAccountApplied = true;
        if ((session.preferredLocale === "pt-BR" || session.preferredLocale === "en-US")
            && i18n.getLocale() !== session.preferredLocale) {
          i18n.setLocale(session.preferredLocale);
        }
      }
      if (previousSession !== session) accountExportNotice = "";
      if (session.status !== "authenticated") profileSaveNotice = "";
      if (subscriptionSession !== session) {
        subscriptionSession = session;
        subscriptionRevision += 1;
        subscriptionView = null;
        subscriptionStatus = "unavailable";
        if (signedIn() && ["assinatura", "visao-geral"].includes(state.section)) {
          void loadSubscription();
        }
      }
      if (mcpUsageSession !== session) {
        mcpUsageSession = session;
        mcpUsageRevision += 1;
        mcpUsage = null;
        mcpUsageStatus = "unavailable";
        if (signedIn()) void loadMcpUsage();
      }
      if (mcpDevicesSession !== session) {
        mcpDevicesSession = session;
        mcpDevicesRevision += 1;
        mcpDevices = null;
        mcpDevicesStatus = "unavailable";
        mcpAuthorityRevision += 1;
        mcpAuthority = null;
        mcpAuthorityDevice = null;
        mcpAuthorityStatus = "unavailable";
        mcpRevoking = false;
        mcpRevocationNotice = "";
        mcpProjectGrantCreating = false;
        mcpProjectGrantRevision += 1;
        resetMcpProjectOnboarding();
        resetMcpCentral();
        if (mcpGithubSession !== session) {
          mcpGithubSession = session;
          resetMcpGithubSession();
        }
        if (signedIn() && state.section === "dispositivos") {
          void loadMcpDevices();
          if (mcpGithubChallenge) void loadMcpGithubCandidates();
        }
      }
      renderSession();
      // Revalidation must clear personal data, but not replace unrelated controls
      // while someone is typing in Help or changing presentation preferences.
      if (byId.get(state.section).sessionDependent || state.section === "consumo") renderContent();
      if (focused && !document.activeElement?.id) (document.getElementById(focused) || document.getElementById("session-status-title"))?.focus({ preventScroll: true });
    });
    void account.readSession();
  }
})();
