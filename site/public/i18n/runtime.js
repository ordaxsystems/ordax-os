(() => {
  "use strict";

  const catalog = window.OrdaXPublicI18nCatalog;
  if (!catalog || catalog.schema !== "prototype-ordax.public-site-localization/1") {
    throw new Error("public-site-localization-catalog-missing");
  }

  const STORAGE_KEY = "ordax.public.locale";
  const SOURCE_LOCALE = catalog.sourceLocale;
  const SUPPORTED = new Set(catalog.supportedLocales);
  const sourceIndex = new Map();
  const textSources = new WeakMap();
  const attrSources = new WeakMap();

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  for (const [source, id] of Object.entries(catalog.sourceIndex)) {
    const key = normalize(source);
    if (!sourceIndex.has(key)) sourceIndex.set(key, id);
  }

  function safeStoredLocale() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function canonicalLocale(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "pt" || normalized === "pt-br") return "pt-BR";
    if (normalized === "en" || normalized === "en-us") return "en-US";
    return null;
  }

  function resolveInitialLocale() {
    const stored = canonicalLocale(safeStoredLocale());
    if (stored && SUPPORTED.has(stored)) return stored;

    const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
    for (const candidate of candidates) {
      const locale = canonicalLocale(candidate);
      if (locale && SUPPORTED.has(locale)) return locale;
    }
    return SOURCE_LOCALE;
  }

  let activeLocale = resolveInitialLocale();

  function interpolate(value, variables = {}) {
    return value.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(variables, name)
        ? String(variables[name])
        : match
    ));
  }

  function t(id, variables) {
    const target = catalog.messages[activeLocale] ?? catalog.messages[SOURCE_LOCALE];
    const source = catalog.messages[SOURCE_LOCALE];
    const value = target?.[id] ?? source?.[id];
    if (typeof value !== "string") {
      throw new Error(`unknown-public-site-message:${id}`);
    }
    return interpolate(value, variables);
  }

  function findMessageId(source) {
    return sourceIndex.get(normalize(source)) ?? null;
  }

  function fromSource(source) {
    const id = findMessageId(source);
    return id ? t(id) : source;
  }

  function textRecord(node) {
    let record = textSources.get(node);
    if (record) return record;
    const raw = node.nodeValue ?? "";
    const normalized = normalize(raw);
    if (!normalized) return null;
    const id = findMessageId(normalized);
    if (!id) return null;
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    const trailing = raw.match(/\s*$/)?.[0] ?? "";
    record = { id, leading, trailing };
    textSources.set(node, record);
    return record;
  }

  function translateTextNode(node) {
    const record = textRecord(node);
    if (!record) return;
    const next = `${record.leading}${t(record.id)}${record.trailing}`;
    // Writing an unchanged value still creates a characterData MutationRecord.
    // Without this guard the observer re-enqueues itself indefinitely,
    // starving clicks and navigation on every page.
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function attrRecord(element, name) {
    let records = attrSources.get(element);
    if (!records) {
      records = new Map();
      attrSources.set(element, records);
    }
    if (records.has(name)) return records.get(name);
    const raw = element.getAttribute(name);
    if (!raw) {
      records.set(name, null);
      return null;
    }
    const id = findMessageId(raw);
    const record = id ? { id } : null;
    records.set(name, record);
    return record;
  }

  function translateAttributes(element) {
    for (const name of ["aria-label", "placeholder", "title", "alt"]) {
      const record = attrRecord(element, name);
      if (record) {
        const next = t(record.id);
        if (element.getAttribute(name) !== next) element.setAttribute(name, next);
      }
    }
    if (element.tagName === "META" && element.getAttribute("name") === "description") {
      const record = attrRecord(element, "content");
      if (record) {
        const next = t(record.id);
        if (element.getAttribute("content") !== next) element.setAttribute("content", next);
      }
    }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
          if (parent?.closest?.("script, style, [data-public-locale-switcher]")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
  }

  function updateSelector() {
    const select = document.querySelector("[data-public-locale-select]");
    const label = document.querySelector("[data-public-locale-label]");
    if (select) {
      select.value = activeLocale;
      select.setAttribute("aria-label", t("locale.selector.label"));
      for (const option of select.options) {
        option.lang = option.value;
        option.textContent = t(`locale.selector.${option.value}`);
      }
    }
    if (label) label.textContent = t("locale.selector.label");
    const toggle = document.querySelector("[data-public-nav-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-label", t("site.navigation.toggle"));
      const text = toggle.querySelector("span");
      if (text) text.textContent = t("site.navigation.menu");
    }
  }

  function normalizePublicHeader() {
    const header = document.querySelector(".site-header");
    const navigation = header?.querySelector(":scope > .site-nav");
    if (!header || !navigation) return;

    // Privacy and terms retain their Identity-pinned source bytes. Normalize
    // the existing text link into the same visible brand used by generated
    // public shells, without editing either legal document.
    const brand = header.querySelector(":scope > .brand") ||
      Array.from(header.children).find(element => element.matches?.('a[href="/"]'));
    if (brand && !brand.querySelector("img.brand-mark")) {
      const name = brand.querySelector(".brand-name")?.textContent.trim() ||
        brand.textContent.trim();
      if (name) {
        const mark = document.createElement("img");
        mark.className = "brand-mark";
        mark.src = "/assets/ordax-symbol.png";
        mark.width = 30;
        mark.height = 30;
        mark.alt = "";
        const wordmark = document.createElement("span");
        wordmark.className = "brand-name";
        wordmark.textContent = name;
        brand.classList.add("brand");
        brand.setAttribute("aria-label", "OrdaX — início");
        brand.replaceChildren(mark, wordmark);
      }
    }

    const ensureAuthActionsGroup = actions => {
      let group = actions.querySelector(":scope > .site-auth-actions");
      if (group) return group;

      const links = Array.from(actions.querySelectorAll(":scope > [data-auth-nav]"));
      if (!links.length) return null;
      group = document.createElement("div");
      group.className = "site-auth-actions";
      actions.insertBefore(group, links[0]);
      links.forEach(link => group.append(link));
      return group;
    };

    const addCompactRegisterLabel = actions => {
      const register = actions?.querySelector(':scope > [data-auth-nav="register"]');
      const desktopLabel = register?.querySelector("[data-auth-nav-label]");
      if (!register || !desktopLabel || register.querySelector('[data-shell-label="mobile"]')) return;

      const compactLabel = catalog.messages[SOURCE_LOCALE]?.["site.action.signup.compact"];
      if (typeof compactLabel !== "string") {
        throw new Error("public-site-compact-register-label-missing");
      }

      desktopLabel.dataset.shellLabel = "desktop";
      const mobileLabel = document.createElement("span");
      mobileLabel.dataset.shellLabel = "mobile";
      mobileLabel.textContent = compactLabel;
      desktopLabel.after(mobileLabel);
    };

    const existingActions = header.querySelector(":scope > .site-actions");
    if (existingActions) {
      addCompactRegisterLabel(ensureAuthActionsGroup(existingActions));
      return;
    }

    const authLinks = Array.from(navigation.querySelectorAll(":scope > [data-auth-nav]"));
    if (!authLinks.length) return;

    const actions = document.createElement("div");
    actions.className = "site-actions";
    header.insertBefore(actions, navigation);
    authLinks.forEach(link => actions.append(link));
    addCompactRegisterLabel(ensureAuthActionsGroup(actions));
  }

  function normalizePublicFooter() {
    const footer = document.querySelector("footer.site-footer");
    const brand = footer?.querySelector(':scope > a:first-child[href="/"]');
    const headerBrand = document.querySelector(".site-header > .brand");
    const symbol = headerBrand?.querySelector("img.brand-mark")?.getAttribute("src");
    if (!brand || !symbol || brand.querySelector("img.brand-mark")) return;

    // Legal documents keep Identity-pinned source bytes. Reuse the normalized
    // header's symbol so their footer receives the shared brand presentation
    // without copying its path or modifying the canonical document markup.
    const name = brand.textContent.trim();
    if (!name) return;

    const mark = document.createElement("img");
    mark.className = "brand-mark";
    mark.src = symbol;
    mark.width = 48;
    mark.height = 30;
    mark.alt = "";
    const wordmark = document.createElement("span");
    wordmark.className = "brand-name";
    wordmark.textContent = name;
    brand.classList.add("brand");
    const label = headerBrand.getAttribute("aria-label");
    if (label) brand.setAttribute("aria-label", label);
    brand.replaceChildren(mark, wordmark);
  }

  function normalizePublicNavigation(nav) {
    if (!nav) return null;

    let tools = nav.querySelector(":scope > .site-nav-tools");
    if (!tools) {
      tools = document.createElement("div");
      tools.className = "site-nav-tools";
      nav.prepend(tools);
    }

    let links = nav.querySelector(":scope > .site-nav-links");
    if (!links) {
      links = document.createElement("div");
      links.className = "site-nav-links";
      for (const anchor of Array.from(nav.querySelectorAll(":scope > a"))) {
        links.append(anchor);
      }
      nav.append(links);
    }

    const selector = nav.querySelector(":scope > .public-locale-switcher");
    if (selector && selector.parentElement !== tools) tools.prepend(selector);
    return {tools, links};
  }

  function installResponsiveNavigation(nav, linksContainer) {
    const header = nav?.closest(".site-header");
    const actions = header?.querySelector(":scope > .site-actions");
    const links = linksContainer
      ? Array.from(linksContainer.querySelectorAll(":scope > a"))
      : [];
    if (!header || !actions || !nav || !linksContainer || !links.length ||
        actions.querySelector(":scope > [data-public-nav-toggle]")) return;

    if (!nav.id) nav.id = "public-primary-navigation";
    if (!linksContainer.id) linksContainer.id = "public-primary-links";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "site-nav-toggle";
    toggle.dataset.publicNavToggle = "";
    toggle.setAttribute("aria-controls", nav.id);
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", t("site.navigation.toggle"));
    toggle.innerHTML = '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">' +
      '<path d="M4 7h16M4 12h16M4 17h16"></path></svg><span></span>';
    toggle.querySelector("span").textContent = t("site.navigation.menu");
    actions.append(toggle);

    const setExpanded = expanded => {
      toggle.setAttribute("aria-expanded", String(expanded));
      nav.dataset.expanded = String(expanded);
    };
    setExpanded(false);
    header.dataset.navEnhanced = "true";

    toggle.addEventListener("click", () => {
      setExpanded(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", event => {
      if (event.target.closest("a")) setExpanded(false);
    });
    nav.addEventListener("keydown", event => {
      if (event.key === "Escape" && nav.dataset.expanded === "true") {
        setExpanded(false);
        toggle.focus();
      }
    });
  }

  function installSelector() {
    normalizePublicHeader();
    normalizePublicFooter();
    const nav = document.querySelector(".site-header > .site-nav");
    const navigation = normalizePublicNavigation(nav);
    const localeSlot = document.querySelector("[data-public-locale-slot]");
    if (!document.querySelector("[data-public-locale-switcher]") && (navigation || localeSlot)) {
      const host = document.createElement("label");
      host.className = "public-locale-switcher";
      host.dataset.publicLocaleSwitcher = "";

      const text = document.createElement("span");
      text.className = "sr-only";
      text.dataset.publicLocaleLabel = "";

      const select = document.createElement("select");
      select.className = "public-locale-select";
      select.dataset.publicLocaleSelect = "";
      for (const locale of catalog.supportedLocales) {
        const option = document.createElement("option");
        option.value = locale;
        select.append(option);
      }
      select.addEventListener("change", () => setLocale(select.value));

      host.append(text, select);
      if (navigation) navigation.tools.prepend(host);
      else localeSlot.replaceWith(host);
      updateSelector();
    }
    installResponsiveNavigation(nav, navigation?.links);
  }

  function setLocale(value) {
    const locale = canonicalLocale(value);
    activeLocale = locale && SUPPORTED.has(locale) ? locale : SOURCE_LOCALE;
    try {
      localStorage.setItem(STORAGE_KEY, activeLocale);
    } catch {
      // Locale persistence is best-effort; deterministic fallback remains available.
    }
    document.documentElement.lang = activeLocale;
    translateTree(document);
    updateSelector();
    document.dispatchEvent(new CustomEvent("ordax:localechange", {
      detail: { locale: activeLocale },
    }));
    return activeLocale;
  }

  function getLocale() {
    return activeLocale;
  }

  window.OrdaXPublicI18n = Object.freeze({
    schema: "prototype-ordax.public-site-localization-runtime/1",
    sourceLocale: SOURCE_LOCALE,
    supportedLocales: catalog.supportedLocales,
    getLocale,
    setLocale,
    t,
    fromSource,
  });

  document.documentElement.lang = activeLocale;
  installSelector();
  translateTree(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        // Script/style/locale switcher mutations are never translated.
        if (!mutation.target.parentElement?.closest?.("script, style, [data-public-locale-switcher]")) {
          translateTextNode(mutation.target);
        }
        continue;
      }
      for (const node of mutation.addedNodes) translateTree(node);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
})();
