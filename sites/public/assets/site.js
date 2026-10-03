(() => {
  "use strict";

  const CONFIG_PATH = "/config/public-site.json";
  const CONFIG_SCHEMA = "prototype-ordax.public-site-runtime/1";
  const CATALOG_SCHEMA = "prototype-ordax.public-release-catalog/1";
  const REGISTRATION_POLICY_SCHEMA = "prototype-ordax.registration-legal-policy/1";
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

  function validRegistrationDocument(value) {
    return (
      value
      && typeof value === "object"
      && typeof value.version === "string"
      && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.version)
      && typeof value.effectiveDate === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(value.effectiveDate)
      && validSha256(value.sha256)
      && validHttpsDocumentUrl(value.url)
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
      && validRegistrationDocument(value.privacy)
      && validRegistrationDocument(value.terms)
    );
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
    let available = legalReady && target === expectedTarget && sameOriginPath(target);
    if (available && kind === "register") {
      try {
        const policy = await loadJson("/auth/registration-policy");
        available = renderRegistrationPolicy(form, policy);
      } catch {
        available = false;
        renderRegistrationPolicy(form, null);
      }
    }
    const [title, detail] = identityCopy(kind, available);

    const strong = state.querySelector("strong");
    const paragraph = state.querySelector("p");
    if (strong) strong.textContent = title;
    if (paragraph) paragraph.textContent = detail;

    const controls = form.querySelectorAll("input, button");
    if (available) {
      form.action = target;
      form.hidden = false;
      for (const control of controls) control.disabled = false;
    } else {
      form.removeAttribute("action");
      form.hidden = true;
      for (const control of controls) control.disabled = true;
    }
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

  async function start() {
    let config = null;
    try {
      config = await loadConfig();
    } catch {
      config = null;
    }

    const page = document.body?.dataset?.page;
    if (page === "download") {
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

  void start();
})();
