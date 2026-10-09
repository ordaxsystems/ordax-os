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
        option.textContent = t(`locale.selector.${option.value}`);
      }
    }
    if (label) label.textContent = t("locale.selector.label");
  }

  function installSelector() {
    if (document.querySelector("[data-public-locale-switcher]")) return;
    const nav = document.querySelector(".site-nav");
    if (!nav) return;

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
    nav.append(host);
    updateSelector();
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
