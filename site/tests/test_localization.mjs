import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
const normalize = value => String(value ?? "").replace(/\s+/g, " ").trim();

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function loadCatalog() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read("site/i18n/catalog.js"), context, {
    filename: "site/i18n/catalog.js",
  });
  return context.window.OrdaXPublicI18nCatalog;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z0-9_.-]+)\}/g)]
    .map(match => match[1])
    .sort();
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const PORTUGUESE_MARKERS = /[ãõçÃÕÇ]|\b(?:não|uma|para|seu|sua|conta|cadastro|senha|licenças|privacidade|termos|recuperação|pendrive|disponível|indisponível|projeto|referências|arquivos|notas|preparação|pública|público|primeiro|atualizações|experiência|segurança|conhecer|criar|entrar|início|ainda|somente|quando|dados|exemplo|documentação|acesso|sessão|escrita|trabalho|entrega|preferências|aplicativos|principais|armazenamento|consumo|faturamento|assinatura|ajuda)\b/i;

function looksPortuguese(value) {
  return PORTUGUESE_MARKERS.test(normalize(value));
}

function decodeHtml(value) {
  return normalize(
    String(value)
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&rarr;/g, "→")
      .replace(/&times;/g, "×")
  );
}

function collectUserFacingHtml(html) {
  const values = [];
  for (const match of html.matchAll(/\b(?:aria-label|placeholder|title|alt|content)=["']([^"']+)["']/gi)) {
    values.push(decodeHtml(match[1]));
  }

  const withoutCode = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  for (const chunk of withoutCode.replace(/<[^>]+>/g, "\n").split(/\n+/)) {
    const value = decodeHtml(chunk);
    if (value) values.push(value);
  }
  return values;
}

function collectUserFacingJsLiterals(source, implementationTokens = new Set()) {
  const values = [];

  function collect(raw) {
    const decoded = raw
      .replace(/\\n/g, "\n")
      .replace(/\\(["'`\\])/g, "$1");

    if (!decoded.includes("<")) {
      const value = normalize(decoded);
      if (value && !implementationTokens.has(value)) values.push(value);
      return;
    }

    const text = decoded
      .replace(/\$\{[^}]*\}/g, " ")
      .replace(/<[^>]+>/g, "\n");
    for (const chunk of text.split(/\n+/)) {
      const value = normalize(chunk).replace(/^[\s/·—–:;-]+/, "").trim();
      if (value) values.push(value);
    }
  }

  // Read strings inside interpolation expressions independently. A flat regex
  // mistakes nested quotes/backticks for copy and can miss rendered template text.
  function scan(start, interpolation = false) {
    let index = start;
    let braces = 0;
    while (index < source.length) {
      const character = source[index];
      if (character === "/" && source[index + 1] === "/") {
        const end = source.indexOf("\n", index + 2);
        index = end === -1 ? source.length : end + 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        const end = source.indexOf("*/", index + 2);
        index = end === -1 ? source.length : end + 2;
        continue;
      }
      if (character === "/" && /(?:[=(,:!?;{]|\breturn)\s*$/.test(source.slice(0, index))) {
        let inClass = false;
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") index += 2;
          else if (source[index] === "[") { inClass = true; index += 1; }
          else if (source[index] === "]") { inClass = false; index += 1; }
          else if (source[index] === "/" && !inClass) { index += 1; break; }
          else index += 1;
        }
        while (/[a-z]/i.test(source[index] ?? "") && index < source.length) index += 1;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        const quote = character;
        let raw = "";
        index += 1;
        while (index < source.length) {
          if (source[index] === "\\") {
            raw += source.slice(index, index + 2);
            index += 2;
          } else if (quote === "`" && source[index] === "$" && source[index + 1] === "{") {
            index = scan(index + 2, true);
            raw += " ";
          } else if (source[index] === quote) {
            index += 1;
            break;
          } else {
            raw += source[index];
            index += 1;
          }
        }
        collect(raw);
        continue;
      }
      if (interpolation && character === "}") {
        if (braces === 0) return index + 1;
        braces -= 1;
      } else if (interpolation && character === "{") {
        braces += 1;
      }
      index += 1;
    }
    return index;
  }
  scan(0);
  return values;
}

const nestedTemplateCopy = collectUserFacingJsLiterals('const view = `<section>${["a"].map(() => tx("Sua conta"))}</section><small>Seu perfil</small>`;');
assert(nestedTemplateCopy.includes("Sua conta"), "locale coverage must inspect copy inside nested template expressions");
assert(nestedTemplateCopy.includes("Seu perfil"), "locale coverage must inspect literal rendered template text");

const catalog = loadCatalog();
assert(catalog?.schema === "prototype-ordax.public-site-localization/1", "unexpected localization catalog schema");
assert(catalog.sourceLocale === "pt-BR", "public-site source locale must remain pt-BR");
assert(
  sameArray([...catalog.supportedLocales], ["pt-BR", "en-US"]),
  "public-site MVP must expose exactly pt-BR and en-US"
);

const pt = catalog.messages?.["pt-BR"];
const en = catalog.messages?.["en-US"];
assert(pt && en, "both public-site locale catalogs must exist");

const ptKeys = Object.keys(pt).sort();
const enKeys = Object.keys(en).sort();
assert(ptKeys.length > 0, "public-site catalog must not be empty");
assert(sameArray(ptKeys, enKeys), "pt-BR/en-US message-key parity drift");

for (const key of ptKeys) {
  const ptPlaceholders = placeholders(pt[key]);
  const enPlaceholders = placeholders(en[key]);
  assert(
    sameArray(ptPlaceholders, enPlaceholders),
    `placeholder parity drift for ${key}: pt-BR=${ptPlaceholders} en-US=${enPlaceholders}`
  );
  if (key !== "locale.selector.pt-BR") {
    assert(!looksPortuguese(en[key]), `residual pt-BR copy in en-US message ${key}: ${en[key]}`);
  }
}

const sourceMessages = new Set(Object.keys(catalog.sourceIndex).map(normalize));
const publicShell = JSON.parse(read("contracts/public-shell.json"));
const resolveShellProfile = (group, value) => {
  if (!value || Array.isArray(value) || typeof value !== "object" || !value.profile) return value;
  const profile = publicShell.profiles?.[group]?.[value.profile];
  assert(profile, `unknown public shell ${group} profile: ${value.profile}`);
  return profile;
};
const shellMessages = [
  publicShell.brand.aria_label,
  publicShell.brand.name,
  publicShell.header_navigation_label,
  publicShell.footer_navigation_label,
  ...Object.values(publicShell.profiles.actions).flatMap(items =>
    items.flatMap(item => [item.label, ...(item.mobile_label ? [item.mobile_label] : [])])),
  ...Object.values(publicShell.profiles.navigation).flatMap(items => items.map(item => item.label)),
  ...Object.values(publicShell.profiles.footers).flatMap(footer => [
    footer.tagline,
    ...footer.navigation.map(item => item.label),
  ]),
  ...Object.values(publicShell.routes).flatMap(route => {
    const actions = resolveShellProfile("actions", route.actions);
    const navigation = resolveShellProfile("navigation", route.navigation);
    const footer = resolveShellProfile("footers", route.footer);
    return [
      ...actions.flatMap(item => [item.label, ...(item.mobile_label ? [item.mobile_label] : [])]),
      ...navigation.map(item => item.label),
      footer.tagline,
      ...footer.navigation.map(item => item.label),
    ];
  }),
];
for (const value of shellMessages) {
  if (!looksPortuguese(value)) continue;
  assert(sourceMessages.has(normalize(value)),
    `public shell copy is outside localization owner: ${value}`);
}
const canonicalRoutes = JSON.parse(read("contracts/site-routes.json"));
assert(canonicalRoutes.$schema === "ordax.site-routes/1", "public Site route contract mismatch");
const routes = canonicalRoutes.routes.map(route => "site/" + route.source);
assert(routes.length === 11, "public Site route inventory changed without localization review");

for (const route of routes) {
  const html = read(route);
  assert(/<script src="\/i18n\/catalog\.js(?:\?[^"]+)?" defer><\/script>/.test(html), `${route} missing public-site catalog owner`);
  assert(html.includes('<script src="/i18n/runtime.js" defer></script>'), `${route} missing public-site locale runtime`);
  assert(
    html.indexOf("/i18n/catalog.js") < html.indexOf("/i18n/runtime.js"),
    `${route} loads localization runtime before catalog`
  );

  for (const value of collectUserFacingHtml(html)) {
    if (!looksPortuguese(value)) continue;
    assert(sourceMessages.has(normalize(value)), `${route} has pt-BR copy outside localization owner: ${value}`);
  }

  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    assert(!/^https?:\/\//i.test(match[1]), `${route} introduced remote JavaScript: ${match[1]}`);
  }
  for (const match of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) {
    assert(!/^https?:\/\//i.test(match[1]), `${route} introduced remote CSS: ${match[1]}`);
  }
}

for (const cssPath of fs.readdirSync(path.join(ROOT, "site/assets")).filter(name => name.endsWith(".css"))) {
  const css = read(`public/assets/${cssPath}`);
  assert(!/url\(\s*["']?https?:\/\//i.test(css), `${cssPath} introduced a remote CSS/font asset`);
}

// External Surface/OS catalog text belongs to its respective owner. This
// localization test checks Site-owned strings, never snapshots from another
// repository; release CI verifies the signed preview independently.
assert(!fs.existsSync(path.join(ROOT, "public/assets/playground-fixture.json")),
       "Site must not own a second generated playground fixture");

const runtime = read("site/i18n/runtime.js");
const localeRuntimeContext = vm.createContext({
  window: { OrdaXPublicI18nCatalog: catalog },
  navigator: { languages: ["en-US"], language: "en-US" },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    nodeType: 9,
    documentElement: {},
    querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null }),
    dispatchEvent: () => {},
  },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9 },
  NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
  MutationObserver: class { observe() {} },
  CustomEvent: class {},
});
vm.runInContext(runtime, localeRuntimeContext, { filename: "site/i18n/runtime.js" });
const localeRuntime = localeRuntimeContext.window.OrdaXPublicI18n;
assert(localeRuntime.getLocale() === "en-US", "locale regression must exercise the real runtime in en-US");
assert(localeRuntime.t("site.navigation.menu") === "Menu", "mobile navigation label must use the English catalog");
assert(localeRuntime.t("site.navigation.toggle") === "Toggle primary navigation", "mobile navigation accessible name must use the English catalog");
assert(localeRuntime.t("locale.selector.pt-BR") === "Português", "Portuguese name must stay self-named in English UI");
assert(localeRuntime.t("locale.selector.en-US") === "English", "English name must stay self-named in English UI");
for (const [source, translated] of [
  ["Navegação principal", "Primary navigation"],
  ["Rodapé", "Footer"],
  ["Armazenamento", "Storage"],
  ["Central de ajuda", "Help center"],
  ["IA", "AI"],
  ["Inteligência artificial", "Artificial intelligence"],
  ["APIs e serviços", "APIs and services"],
]) {
  assert(localeRuntime.fromSource(source) === translated, `account resource translation regression: ${source}`);
}
localeRuntime.setLocale("pt-BR");
assert(localeRuntime.t("site.navigation.menu") === "Menu", "mobile navigation label must use the Portuguese catalog");
assert(localeRuntime.t("site.navigation.toggle") === "Alternar navegação principal", "mobile navigation accessible name must use the Portuguese catalog");
assert(localeRuntime.t("locale.selector.pt-BR") === "Português", "Portuguese name must stay self-named in Portuguese UI");
assert(localeRuntime.t("locale.selector.en-US") === "English", "English name must stay self-named in Portuguese UI");
assert(localeRuntime.fromSource("Armazenamento") === "Armazenamento", "resource label must restore pt-BR through the same runtime");
for (const anchor of [
  'const STORAGE_KEY = "ordax.public.locale"',
  'document.documentElement.lang = activeLocale',
  'localStorage.setItem(STORAGE_KEY, activeLocale)',
  'data-public-locale-select',
  'new MutationObserver',
  'fromSource',
]) {
  assert(runtime.includes(anchor), `public-site locale runtime missing invariant: ${anchor}`);
}
assert(runtime.includes('return SOURCE_LOCALE;'), "unsupported public locale must fall back to pt-BR");

const siteJs = read("public/assets/site.js");
const semanticIds = [
  "identity.login.ready.title",
  "identity.login.gated.title",
  "identity.register.ready.title",
  "identity.register.gated.title",
  "identity.recover.ready.title",
  "identity.recover.gated.title",
  "identity.recoverComplete.ready.title",
  "identity.recoverComplete.gated.title",
  "download.action",
  "compliance.thirdParty.label",
  "compliance.source.label",
  "compliance.heading",
  "download.empty.title",
  "download.empty.detail",
  "download.ready.title",
  "download.error.title",
  "compliance.empty.title",
  "compliance.ready.title",
  "compliance.error.title",
];
for (const id of semanticIds) {
  assert(siteJs.includes(id), `dynamic public-site copy is not routed through message id ${id}`);
  assert(!siteJs.includes(pt[id]), `dynamic public-site source literal escaped localization owner for ${id}`);
}
assert(
  siteJs.includes('document.addEventListener("ordax:localechange"'),
  "dynamic download/identity/compliance UI must rerender on locale changes"
);

const playground = read("public/assets/playground.js");
for (const value of collectUserFacingJsLiterals(playground)) {
  if (!looksPortuguese(value)) continue;
  assert(sourceMessages.has(normalize(value)), `playground source copy missing from localization owner: ${value}`);
}
const accountPortal = read("public/assets/account-portal.js");
// These are DOM/route identifiers, not labels. Visible labels remain covered.
const accountImplementationTokens = new Set(["conta", "integracoes", "dados-pessoais", "privacidade", "assinatura", "consumo", "faturamento", "/conta/"]);
for (const value of collectUserFacingJsLiterals(accountPortal, accountImplementationTokens)) {
  if (!looksPortuguese(value)) continue;
  assert(sourceMessages.has(normalize(value)), `account portal copy missing from localization owner: ${value}`);
}
// Direct translation calls and visible metadata cannot rely on Portuguese-word
// heuristics: labels such as "Armazenamento" previously escaped those markers.
for (const expression of [
  /\btx\(\s*"((?:\\.|[^"\\])*)"\s*\)/g,
  /\b(?:title|description|label|name|owner|q|a):\s*"((?:\\.|[^"\\])*)"/g,
]) {
  for (const match of accountPortal.matchAll(expression)) {
    const value = normalize(match[1].replace(/\\(["'\\])/g, "$1"));
    assert(sourceMessages.has(value), `account portal translated label missing from localization owner: ${value}`);
  }
}
assert(/\bi18n(?:\.|\?\.)fromSource\(/.test(accountPortal), "account portal labels must use the existing public-site locale owner");
assert(
  accountPortal.includes('document.addEventListener("ordax:localechange"'),
  "account portal must rerender dynamic copy when the public-site locale changes"
);
for (const id of ["account.usage.unavailablePeriod", "account.activity.period"]) {
  assert(accountPortal.includes(id), `account portal interpolation must use the existing locale owner: ${id}`);
  assert(typeof pt[id] === "string" && typeof en[id] === "string", `account portal interpolation missing translation: ${id}`);
}
for (const id of [
  "playground.note.initialTitle",
  "playground.note.initialBody",
  "playground.appsOnDevice",
  "playground.appOnDevice",
  "playground.noteTitleOnDevice",
  "playground.noteBodyOnDevice",
  "playground.changeOnDevice",
]) {
  assert(playground.includes(id), `playground dynamic locale boundary missing ${id}`);
}
assert(playground.includes("i18n.fromSource"), "playground fixture labels must resolve through the public-site locale owner");
assert(
  playground.includes('document.addEventListener("ordax:localechange"'),
  "playground must rerender locale-sensitive values after selection changes"
);
assert(
  playground.includes("new Intl.DateTimeFormat(activeLocale"),
  "playground dates/times must use the active public-site locale"
);
assert(
  !/Intl\.(?:DateTimeFormat|NumberFormat)\(\s*["']pt-BR["']/.test(playground),
  "playground must not hard-code pt-BR into locale-aware formatters"
);

console.log(`PUBLIC_SITE_LOCALIZATION=PASS messages=${ptKeys.length} routes=${routes.length} locales=pt-BR,en-US`);
