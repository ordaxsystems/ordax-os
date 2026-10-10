(() => {
  "use strict";

  const CONFIG_PATH = "/config/public-site.json";
  const CONFIG_SCHEMA = "prototype-ordax.public-site-runtime/1";
  const CATALOG_SCHEMA = "prototype-ordax.public-release-catalog/1";
  const REGISTRATION_POLICY_SCHEMA = "prototype-ordax.registration-legal-policy/1";
  const TURNSTILE_RUNTIME_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  const TURNSTILE_ACTION = "ordax-account";
  const TURNSTILE_PROTECTED_KINDS = new Set(["login", "register", "recover"]);
  const i18n = window.OrdaXPublicI18n;
  if (!i18n || i18n.schema !== "prototype-ordax.public-site-localization-runtime/1") {
    throw new Error("public-site-localization-runtime-missing");
  }
  const t = (messageId, variables) => i18n.t(messageId, variables);

  function sameOriginPath(value) {
    return (
      typeof value === "string" &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("?") &&
      !value.includes("#")
    );
  }

  async function loadJson(path) {
    const response = await fetch(path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("resource-unavailable");
    }
    return response.json();
  }

  async function loadConfig() {
    const config = await loadJson(CONFIG_PATH);
    if (!config || config.$schema !== CONFIG_SCHEMA) {
      throw new Error("invalid-public-site-config");
    }
    return config;
  }

  function validHttpsDocumentUrl(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      const raw = value.trim();
      const schemeBoundary = raw.indexOf("://");
      const authority = schemeBoundary > 0
        ? raw.slice(schemeBoundary + 3).split("/", 1)[0]
        : "";
      return (
        url.protocol === "https:"
        && schemeBoundary > 0
        && authority.length > 0
        && !authority.includes("@")
        && !url.search
        && !url.hash
      );
    } catch {
      return false;
    }
  }

  // Legal consent must only reference the approved pages on this origin.
  function canonicalLegalDocument(value, path) {
    if (!validHttpsDocumentUrl(value)) return false;
    try {
      const url = new URL(value);
      return url.origin === window.location.origin && url.pathname === path;
    } catch {
      return false;
    }
  }

  function validRegistrationDocument(value, path) {
    return (
      value
      && typeof value === "object"
      && typeof value.version === "string"
      && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.version)
      && typeof value.effectiveDate === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)
      && validSha256(value.sha256)
      && canonicalLegalDocument(value.url, path)
    );
  }

  function validRegistrationPolicy(value) {
    return (
      value
      && value.$schema === REGISTRATION_POLICY_SCHEMA
      && value.active === true
      && value.registrationEnabled === true
      && typeof value.policyId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.policyId)
      && validRegistrationDocument(value.privacy, "/privacidade/")
      && validRegistrationDocument(value.terms, "/termos/")
    );
  }

  // The server owns immutable consent hashes. Never offer new consent to a
  // document whose currently published bytes no longer match that policy.
  async function verifyPublishedRegistrationDocuments(policy) {
    if (!validRegistrationPolicy(policy) || !globalThis.crypto?.subtle) return false;
    const maxBytes = 2 * 1024 * 1024;
    for (const [documentInfo, route] of [
      [policy.privacy, "/privacidade/"],
      [policy.terms, "/termos/"],
    ]) {
      if (!canonicalLegalDocument(documentInfo.url, route)) return false;
      const response = await fetch(documentInfo.url, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "text/html" },
      });
      if (!response.ok || response.status !== 200 || response.url !== documentInfo.url
          || response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "text/html"
          || !response.body) return false;
      const advertisedSize = response.headers.get("Content-Length");
      if (advertisedSize !== null && (!/^\\d+$/.test(advertisedSize) || Number(advertisedSize) > maxBytes)) {
        return false;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let bytesRead = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) return false;
          bytesRead += value.byteLength;
          if (bytesRead > maxBytes) {
            await reader.cancel();
            return false;
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(bytesRead);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (hex !== documentInfo.sha256) return false;
    }
    return true;
  }

  function renderRegistrationPolicy(form, policy) {
    const host = form.querySelector("[data-registration-legal]");
    if (!host) return false;
    if (!validRegistrationPolicy(policy)) {
      host.hidden = true;
      return false;
    }
    const privacy = host.querySelector("[data-registration-privacy]");
    const privacyMeta = host.querySelector("[data-registration-privacy-meta]");
    const terms = host.querySelector("[data-registration-terms]");
    const termsMeta = host.querySelector("[data-registration-terms-meta]");
    if (!privacy || !privacyMeta || !terms || !termsMeta) {
      host.hidden = true;
      return false;
    }
    privacy.href = policy.privacy.url;
    privacyMeta.textContent = `v${policy.privacy.version} · ${policy.privacy.effectiveDate}`;
    terms.href = policy.terms.url;
    termsMeta.textContent = `v${policy.terms.version} · ${policy.terms.effectiveDate}`;
    host.hidden = false;
    return true;
  }

  function validTurnstileSitekey(value) {
    return typeof value === "string" && /^0x[A-Za-z0-9_-]{20,80}$/.test(value);
  }

  let turnstileLoader = null;
  function loadTurnstileRuntime() {
    if (
      window.turnstile
      && typeof window.turnstile.render === "function"
    ) {
      return Promise.resolve(window.turnstile);
    }
    if (turnstileLoader) return turnstileLoader;
    turnstileLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TURNSTILE_RUNTIME_URL;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = "no-referrer";
      script.onload = () => {
        if (window.turnstile && typeof window.turnstile.render === "function") {
          resolve(window.turnstile);
        } else {
          reject(new Error("turnstile-runtime-invalid"));
        }
      };
      script.onerror = () => reject(new Error("turnstile-runtime-unavailable"));
      document.head.append(script);
    });
    return turnstileLoader;
  }

  async function armTurnstile(form, sitekey) {
    const host = form.querySelector("[data-turnstile]");
    const submit = form.querySelector('button[type="submit"]');
    if (!host || !submit || !validTurnstileSitekey(sitekey)) return false;
    submit.disabled = true;
    try {
      const runtime = await loadTurnstileRuntime();
      runtime.render(host, {
        sitekey,
        action: TURNSTILE_ACTION,
        theme: "auto",
        callback(token) {
          submit.disabled = typeof token !== "string" || token.length < 1;
        },
        "expired-callback"() {
          submit.disabled = true;
        },
        "error-callback"() {
          submit.disabled = true;
        },
      });
      return true;
    } catch {
      submit.disabled = true;
      return false;
    }
  }

  function identityCopy(kind, available) {
    const copy = {
      login: {
        ready: ["identity.login.ready.title", "identity.login.ready.detail"],
        gated: ["identity.login.gated.title", "identity.login.gated.detail"],
      },
      register: {
        ready: ["identity.register.ready.title", "identity.register.ready.detail"],
        gated: ["identity.register.gated.title", "identity.register.gated.detail"],
      },
      recover: {
        ready: ["identity.recover.ready.title", "identity.recover.ready.detail"],
        gated: ["identity.recover.gated.title", "identity.recover.gated.detail"],
      },
      "recover-complete": {
        ready: ["identity.recoverComplete.ready.title", "identity.recoverComplete.ready.detail"],
        gated: ["identity.recoverComplete.gated.title", "identity.recoverComplete.gated.detail"],
      },
    };
    const selected = copy[kind];
    if (!selected) return [t("identity.unavailable.title"), t("identity.unavailable.detail")];
    const messageIds = available ? selected.ready : selected.gated;
    return messageIds.map((messageId) => t(messageId));
  }

  // Server-generated redirect codes are mapped to safe, accessible messages.
  // Never interpolate query text as HTML or read credentials in JavaScript.
  const IDENTITY_NOTICES = Object.freeze({
    login: {
      cadastro: {
        "verifique-email": ["success", "Cadastro recebido. Verifique seu e-mail para confirmar a conta antes de entrar."],
        confirmado: ["success", "E-mail confirmado. Entre na sua Conta OrdaX para continuar."],
      },
      erro: {
        formulario: ["error", "Revise o e-mail e a senha informados."],
        credenciais: ["error", "Não foi possível entrar. Confira suas credenciais e tente novamente."],
        "confirmacao-invalida": ["error", "O link de confirmação expirou ou já foi usado. Entre normalmente se seu e-mail já estiver confirmado."],
        "confirmacao-indisponivel": ["error", "Não foi possível verificar o e-mail agora. Tente novamente mais tarde."],
        "verificacao-falhou": ["error", "A verificação de segurança não foi concluída. Refaça a verificação e tente entrar novamente."],
        "seguranca-indisponivel": ["error", "A verificação de segurança está temporariamente indisponível. Tente novamente mais tarde."],
        "validacao-conta-indisponivel": ["error", "A validação da conta está indisponível. Tente novamente mais tarde."],
        "conta-requer-reconciliacao": ["error", "Sua conta precisa de validação adicional antes do acesso público."],
      },
    },
    register: {
      erro: {
        formulario: ["error", "Revise os dados de cadastro."],
        "aceite-legal": ["error", "É necessário ler e aceitar os documentos vigentes."],
        senha: ["error", "Escolha uma senha com pelo menos 12 caracteres."],
        "senha-comprometida": ["error", "Essa senha foi encontrada em vazamentos. Escolha outra."],
        "seguranca-indisponivel": ["error", "A verificação de segurança está indisponível. Tente novamente mais tarde."],
        "verificacao-falhou": ["error", "A verificação de segurança não foi concluída. Refaça a verificação antes de criar sua conta."],
        "politica-legal-indisponivel": ["error", "A política de cadastro está indisponível. O cadastro não foi concluído."],
        cadastro: ["error", "Não foi possível concluir o cadastro. Revise os dados e tente novamente."],
      },
    },
    recover: { erro: {
      formulario: ["error", "Informe um e-mail válido."],
      "verificacao-falhou": ["error", "A verificação de segurança falhou. Tente novamente."],
      "seguranca-indisponivel": ["error", "A verificação de segurança está indisponível. Tente novamente mais tarde."],
    } },
  });

  function showIdentityNotice(kind, available) {
    const notice = document.querySelector("[data-identity-notice]");
    if (!notice) return;
    notice.hidden = true;
    notice.removeAttribute("role");
    notice.textContent = "";
    if (!available) return;
    const allowed = IDENTITY_NOTICES[kind];
    if (!allowed) return;
    const params = new URLSearchParams(window.location.search);
    for (const key of ["erro", "cadastro"]) {
      const code = params.get(key);
      if (code === null) continue;
      if (!Object.hasOwn(allowed[key] ?? {}, code)) continue;
      const message = allowed[key][code];
      notice.textContent = message[1];
      notice.dataset.kind = message[0];
      notice.setAttribute("role", message[0] === "error" ? "alert" : "status");
      notice.hidden = false;
      return;
    }
  }

  function validSessionReadiness(value) {
    return value
      && value.$schema === "prototype-ordax.public-identity-session/1"
      && value.provider === "supabase"
      && (
        (value.authenticated === false && value.status === "anonymous")
        || (value.authenticated === true && value.status === "authenticated"
          && typeof value.subject === "string" && value.subject.length > 0)
      );
  }

  // One verified session request per page. No parallel client-side auth state.
  let sessionPromise = null;
  let sessionRevision = 0;

  function verifiedIdentitySession() {
    if (!sessionPromise) {
      sessionPromise = loadJson("/auth/session").then(session => {
        if (!validSessionReadiness(session)) throw new Error("invalid-identity-session");
        return session;
      });
    }
    return sessionPromise;
  }

  async function renderAuthHeader() {
    const header = document.querySelector(".site-header");
    const login = header?.querySelector('[data-auth-nav="login"]');
    const register = header?.querySelector('[data-auth-nav="register"]');
    if (!login && !register) return;
    const label = link => link?.querySelector("[data-auth-nav-label]");
    const revision = sessionRevision;
    // Fail closed and restore anonymous navigation before revalidation.
    if (login) {
      login.href = "/login/";
      login.removeAttribute("aria-current");
      const caption = label(login);
      if (caption) caption.textContent = i18n.fromSource("Entrar");
    }
    if (register) {
      register.href = "/cadastro/";
      register.hidden = false;
      register.removeAttribute("aria-current");
      const caption = label(register);
      if (caption) caption.textContent = i18n.fromSource("Criar conta");
    }
    try {
      const session = await verifiedIdentitySession();
      if (revision !== sessionRevision || !session.authenticated) return;
      const accountLink = login || register;
      accountLink.href = "/conta/";
      const caption = label(accountLink);
      if (caption) caption.textContent = t("account.navigation.account");
      if (document.body?.dataset?.page === "conta") accountLink.setAttribute("aria-current", "page");
      if (login && register) register.hidden = true;
    } catch {
      // No connection or no valid session: only public links remain.
    }
  }

  // The account page displays only identity data returned by the same-origin
  // verified session owner. No locally inferred or simulated account state.
  function clearAccountView() {
    for (const selector of ["[data-account-authenticated]", "[data-account-anonymous]", "[data-account-unavailable]"]) {
      const section = document.querySelector(selector);
      if (section) section.hidden = true;
    }
    const email = document.querySelector("[data-account-email]");
    const hero = document.querySelector("[data-account-hero-email]");
    const logout = document.querySelector('[data-account-logout] button[type="submit"]');
    const logoutForm = document.querySelector("[data-account-logout]");
    if (logoutForm) logoutForm.hidden = true;
    if (email) email.textContent = "";
    if (hero) { hero.textContent = ""; hero.hidden = true; }
    if (logout) logout.disabled = true;
  }

  async function renderAccount() {
    const pageRevision = startRevision;
    const state = document.querySelector("[data-account-state]");
    const authenticated = document.querySelector("[data-account-authenticated]");
    const anonymous = document.querySelector("[data-account-anonymous]");
    const unavailable = document.querySelector("[data-account-unavailable]");
    const email = document.querySelector("[data-account-email]");
    const hero = document.querySelector("[data-account-hero-email]");
    const logout = document.querySelector('[data-account-logout] button[type="submit"]');
    const logoutForm = document.querySelector("[data-account-logout]");
    if (!state || !authenticated || !anonymous || !unavailable || !email || !logout || !logoutForm) return;

    // Always hide stale personal information during refresh and locale changes.
    authenticated.hidden = true;
    anonymous.hidden = true;
    unavailable.hidden = true;
    email.textContent = "";
    if (hero) { hero.textContent = ""; hero.hidden = true; }
    logout.disabled = true;
    logoutForm.hidden = true;
    state.dataset.status = "checking";
    state.setAttribute("aria-busy", "true");
    setStatus("[data-account-state]", t("account.session.checking.title"), t("account.session.checking.detail"));

    try {
      const revision = sessionRevision;
      const session = await verifiedIdentitySession();
      if (revision !== sessionRevision || pageRevision !== startRevision) return;
      if (session.authenticated === true) {
        // This text is never HTML: remote identity attributes are untrusted.
        email.textContent = typeof session.email === "string" && session.email.length <= 254
          ? session.email
          : t("account.session.emailUnavailable");
        if (hero) {
          // Mirror the same verified identity value; clear it during every revalidation.
          hero.textContent = email.textContent;
          hero.hidden = false;
        }
        authenticated.hidden = false;
        logout.disabled = false;
        logoutForm.hidden = false;
        state.dataset.status = "ready";
        setStatus("[data-account-state]", t("account.session.active.title"), t("account.session.active.detail"));
      } else {
        anonymous.hidden = false;
        state.dataset.status = "anonymous";
        setStatus("[data-account-state]", t("account.session.anonymous.title"), t("account.session.anonymous.detail"));
      }
    } catch {
      if (pageRevision !== startRevision) return;
      unavailable.hidden = false;
      state.dataset.status = "unavailable";
      setStatus("[data-account-state]", t("account.session.unavailable.title"), t("account.session.unavailable.detail"));
    } finally {
      if (pageRevision === startRevision) state.removeAttribute("aria-busy");
    }
  }

  function productWebEntry(config) {
    const product = config?.product?.web;
    const path = product?.entry_url;
    // Navigation only; the deployed product host must independently authorize every request.
    if (product?.enabled !== true || typeof path !== "string"
      || !/^\/[A-Za-z0-9/_-]+\/$/.test(path)
      || /\/\//.test(path)
      || /^\/(?:auth|account|sync|config|api|conta|login|cadastro|web)(?:\/|$)/.test(path)) return null;
    return path;
  }

  let webRenderRevision = 0;
  async function renderWebEntry(config) {
    const state = document.querySelector("[data-web-state]");
    const launch = document.querySelector("[data-web-launch]");
    const login = document.querySelector("[data-web-login]");
    const retry = document.querySelector("[data-web-retry]");
    if (!state || !launch || !login || !retry) return;
    const generation = ++webRenderRevision;
    const revision = sessionRevision;
    const pageRevision = startRevision;
    launch.hidden = login.hidden = retry.hidden = true;
    launch.removeAttribute("href");
    state.dataset.status = "checking";
    state.setAttribute("aria-busy", "true");
    setStatus("[data-web-state]", t("web.entry.checking.title"), t("web.entry.checking.detail"));
    try {
      const session = await verifiedIdentitySession();
      if (revision !== sessionRevision || generation !== webRenderRevision || pageRevision !== startRevision) return;
      if (!session.authenticated) {
        login.hidden = false;
        state.dataset.status = "anonymous";
        setStatus("[data-web-state]", t("web.entry.anonymous.title"), t("web.entry.anonymous.detail"));
      } else {
        const path = productWebEntry(config);
        if (path) {
          launch.href = path;
          launch.hidden = false;
          state.dataset.status = "ready";
          setStatus("[data-web-state]", t("web.entry.ready.title"), t("web.entry.ready.detail"));
        } else {
          state.dataset.status = "unavailable";
          setStatus("[data-web-state]", t("web.entry.pending.title"), t("web.entry.pending.detail"));
        }
      }
    } catch {
      if (revision !== sessionRevision || generation !== webRenderRevision || pageRevision !== startRevision) return;
      retry.hidden = false;
      state.dataset.status = "error";
      setStatus("[data-web-state]", t("web.entry.error.title"), t("web.entry.error.detail"));
    } finally {
      if (revision === sessionRevision && generation === webRenderRevision && pageRevision === startRevision) state.removeAttribute("aria-busy");
    }
  }

  async function renderIdentity(config) {
    const state = document.querySelector("[data-identity-state]");
    const form = document.querySelector("[data-identity-form]");
    if (!state || !form) return;

    const kind = form.dataset.identityForm;
    const routes = {
      login: ["/auth/login", config?.identity?.login_url],
      register: ["/auth/register", config?.identity?.register_url],
      recover: ["/auth/recover", config?.identity?.recovery_url],
      "recover-complete": ["/auth/recover/complete", config?.identity?.recovery_complete_url],
    };
    const route = routes[kind];
    const expectedTarget = route?.[0] ?? null;
    const target = route?.[1] ?? null;
    const legalReady = config?.legal?.account_activation_ready === true;
    // Login and signup can ship without activating unrelated Cloud features.
    // This static flag only makes the form eligible for *live server checks*;
    // the session and active legal policy are authoritative.
    const authOnly = config?.legal?.auth_only_source_enabled === true
      && (kind === "login" || kind === "register");
    let available = (legalReady || authOnly)
      && target === expectedTarget && sameOriginPath(target);
    if (available) {
      try {
        // The server is authoritative: a static configuration alone cannot
        // enable forms when the public identity gateway is unavailable.
        available = !!(await verifiedIdentitySession());
      } catch {
        available = false;
      }
    }
    if (available && kind === "register") {
      try {
        const policy = await loadJson("/auth/registration-policy");
        available = (await verifyPublishedRegistrationDocuments(policy))
          && renderRegistrationPolicy(form, policy);
        if (!available) renderRegistrationPolicy(form, null);
      } catch {
        available = false;
        renderRegistrationPolicy(form, null);
      }
    }
    if (
      available
      && TURNSTILE_PROTECTED_KINDS.has(kind)
      && !validTurnstileSitekey(config?.identity?.turnstile_sitekey)
    ) {
      available = false;
    }

    const controls = form.querySelectorAll("input, button");
    if (available) {
      form.action = target;
      form.hidden = false;
      for (const control of controls) control.disabled = false;
      if (TURNSTILE_PROTECTED_KINDS.has(kind)) {
        available = await armTurnstile(form, config.identity.turnstile_sitekey);
      }
    }
    if (!available) {
      form.removeAttribute("action");
      form.hidden = true;
      for (const control of controls) control.disabled = true;
    }

    const [title, detail] = identityCopy(kind, available);
    const strong = state.querySelector("strong");
    const paragraph = state.querySelector("p");
    if (strong) strong.textContent = title;
    if (paragraph) paragraph.textContent = detail;
    state.dataset.status = available ? "ready" : "unavailable";
    state.removeAttribute("aria-busy");
    document.body.dataset.identityReady = available ? "true" : "false";
    showIdentityNotice(kind, available);
  }

  function validSha256(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  }

  function validIntegrityArtifact(value) {
    return (
      value &&
      sameOriginPath(value.href) &&
      validSha256(value.sha256) &&
      Number.isInteger(value.size) &&
      value.size > 0
    );
  }

  function releaseTargetNode(target) {
    if (
      !target ||
      !sameOriginPath(target.href) ||
      typeof target.label !== "string" ||
      !validSha256(target.sha256) ||
      !Number.isInteger(target.size) ||
      target.size <= 0
    ) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "release-target";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const hash = document.createElement("code");
    title.textContent = target.label;
    hash.textContent = `SHA-256 ${target.sha256}`;
    copy.append(title, document.createElement("br"), hash);

    const link = document.createElement("a");
    link.className = "button button-primary";
    link.href = target.href;
    link.textContent = t("download.action");

    row.append(copy, link);
    return row;
  }

  function complianceArtifactNode(label, artifact, actionLabel = null) {
    if (!validIntegrityArtifact(artifact)) return null;

    const row = document.createElement("div");
    row.className = "compliance-artifact";

    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const hash = document.createElement("code");
    const size = document.createElement("span");
    title.textContent = label;
    hash.textContent = `SHA-256 ${artifact.sha256}`;
    size.textContent = ` · ${artifact.size} bytes`;
    copy.append(title, document.createElement("br"), hash, size);

    const link = document.createElement("a");
    link.className = "button button-quiet";
    link.href = artifact.href;
    link.textContent = actionLabel ?? t("compliance.open");

    row.append(copy, link);
    return row;
  }

  function releaseComplianceNode(compliance) {
    if (!compliance || typeof compliance !== "object") return null;

    const entries = [
      ["SBOM", compliance.sbom, "SBOM"],
      [t("compliance.thirdParty.label"), compliance.third_party_notices, t("compliance.thirdParty.action")],
      [t("compliance.source.label"), compliance.source_bundle, t("compliance.source.action")],
    ];

    const section = document.createElement("section");
    section.className = "release-compliance";

    const heading = document.createElement("div");
    heading.className = "release-compliance-heading";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = t("compliance.heading");
    const intro = document.createElement("p");
    intro.textContent = t("compliance.intro");
    heading.append(eyebrow, intro);
    section.append(heading);

    let count = 0;
    for (const [label, artifact, actionLabel] of entries) {
      const row = complianceArtifactNode(label, artifact, actionLabel);
      if (!row) continue;
      section.append(row);
      count += 1;
    }
    return count === entries.length ? section : null;
  }

  function validCatalog(catalog) {
    return (
      catalog &&
      catalog.$schema === CATALOG_SCHEMA &&
      Array.isArray(catalog.releases) &&
      (catalog.status === "empty" || catalog.status === "ready")
    );
  }

  function renderCatalog(catalog) {
    if (!validCatalog(catalog)) {
      throw new Error("invalid-public-release-catalog");
    }

    const list = document.querySelector("[data-release-list]");
    if (!list) return 0;
    list.replaceChildren();

    let rendered = 0;
    for (const release of catalog.releases) {
      if (!release || typeof release.version !== "string" || !Array.isArray(release.targets)) continue;

      const compliance = releaseComplianceNode(release.compliance);
      if (!compliance) continue;

      const card = document.createElement("article");
      card.className = "release-card";

      const header = document.createElement("div");
      header.className = "release-card-header";
      const title = document.createElement("h2");
      title.textContent = release.version;
      const meta = document.createElement("p");
      const channel = typeof release.channel === "string" ? release.channel : "public";
      const date = typeof release.published_at === "string" ? ` · ${release.published_at}` : "";
      meta.textContent = `${channel}${date}`;
      header.append(title, meta);
      card.append(header);

      let targetCount = 0;
      for (const target of release.targets) {
        const row = releaseTargetNode(target);
        if (!row) continue;
        card.append(row);
        targetCount += 1;
      }

      if (targetCount > 0) {
        card.append(compliance);
        list.append(card);
        rendered += 1;
      }
    }
    return rendered;
  }

  function renderComplianceCatalog(catalog) {
    if (!validCatalog(catalog)) {
      throw new Error("invalid-public-release-catalog");
    }

    const list = document.querySelector("[data-compliance-list]");
    if (!list) return 0;
    list.replaceChildren();

    let rendered = 0;
    for (const release of catalog.releases) {
      if (!release || typeof release.version !== "string") continue;
      const compliance = releaseComplianceNode(release.compliance);
      if (!compliance) continue;

      const card = document.createElement("article");
      card.className = "release-card";

      const header = document.createElement("div");
      header.className = "release-card-header";
      const title = document.createElement("h2");
      title.textContent = release.version;
      const meta = document.createElement("p");
      const source = typeof release.source_commit === "string"
        ? `commit ${release.source_commit.slice(0, 12)}`
        : t("release.public");
      meta.textContent = source;
      header.append(title, meta);
      card.append(header, compliance);
      list.append(card);
      rendered += 1;
    }
    return rendered;
  }

  function setStatus(selector, title, detail) {
    const status = document.querySelector(selector);
    if (!status) return;
    const strong = status.querySelector("strong");
    const paragraph = status.querySelector("p");
    if (strong) strong.textContent = title;
    if (paragraph) paragraph.textContent = detail;
  }

  async function loadPublicCatalog(config) {
    const catalogPath = config?.downloads?.catalog_url;
    if (!sameOriginPath(catalogPath)) {
      throw new Error("catalog-not-configured");
    }
    return loadJson(catalogPath);
  }

  async function initDownload(config) {
    try {
      const catalog = await loadPublicCatalog(config);
      const count = renderCatalog(catalog);
      if (count === 0) {
        setStatus(
          "[data-download-status]",
          t("download.empty.title"),
          t("download.empty.detail")
        );
        return;
      }
      setStatus(
        "[data-download-status]",
        t("download.ready.title"),
        t("download.ready.detail")
      );
    } catch {
      setStatus(
        "[data-download-status]",
        t("download.error.title"),
        t("download.error.detail")
      );
    }
  }

  async function initCompliance(config) {
    try {
      const catalog = await loadPublicCatalog(config);
      const count = renderComplianceCatalog(catalog);
      if (count === 0) {
        setStatus(
          "[data-compliance-status]",
          t("compliance.empty.title"),
          t("compliance.empty.detail")
        );
        return;
      }
      setStatus(
        "[data-compliance-status]",
        t("compliance.ready.title"),
        t("compliance.ready.detail")
      );
    } catch {
      setStatus(
        "[data-compliance-status]",
        t("compliance.error.title"),
        t("compliance.error.detail")
      );
    }
  }

  let startRevision = 0;
  async function start() {
    const generation = ++startRevision;
    clearAccountView();
    const webLaunch = document.querySelector("[data-web-launch]");
    if (webLaunch) {
      webLaunch.hidden = true;
      webLaunch.removeAttribute("href");
    }
    // Navigation does not block the page; the account portal shares its read.
    void renderAuthHeader();
    let config = null;
    try {
      config = await loadConfig();
    } catch {
      config = null;
    }
    if (generation !== startRevision) return;

    const page = document.body?.dataset?.page;
    if (page === "login" && window.location.hash) {
      // Old hosted Supabase links can return bearer tokens in the URL fragment.
      // Never parse, exchange or persist them in the public portal.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (page === "conta") {
      await renderAccount();
    } else if (page === "web") {
      await renderWebEntry(config);
    } else if (page === "download") {
      await initDownload(config);
    } else if (page === "licencas") {
      await initCompliance(config);
    } else if (
      page === "login"
      || page === "cadastro"
      || page === "recuperar"
      || page === "recuperar-nova-senha"
    ) {
      await renderIdentity(config);
    }
  }

  document.addEventListener("ordax:localechange", () => {
    void start();
  });

  // Back navigation after logout must never show a cached authenticated view.
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    sessionRevision++;
    sessionPromise = null;
    void start();
  });

  void start();
})();
