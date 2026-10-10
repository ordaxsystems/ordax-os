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
  vm.runInContext(read("sites/public/i18n/catalog.js"), context, {
    filename: "sites/public/i18n/catalog.js",
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
const routes = [
  "sites/public/index.html",
  "sites/public/download/index.html",
  "sites/public/login/index.html",
  "sites/public/cadastro/index.html",
  "sites/public/conta/index.html",
  "sites/public/conta-2/index.html",
  "sites/public/web/index.html",
  "sites/public/recuperar/index.html",
  "sites/public/recuperar/nova-senha/index.html",
  "sites/public/licencas/index.html",
  "sites/public/privacidade/index.html",
  "sites/public/termos/index.html",
];

for (const route of routes) {
  const html = read(route);
  assert(html.includes('<script src="/i18n/catalog.js" defer></script>'), `${route} missing public-site catalog owner`);
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

for (const cssPath of fs.readdirSync(path.join(ROOT, "sites/public/assets")).filter(name => name.endsWith(".css"))) {
  const css = read(`sites/public/assets/${cssPath}`);
  assert(!/url\(\s*["']?https?:\/\//i.test(css), `${cssPath} introduced a remote CSS/font asset`);
}

const fixture = JSON.parse(read("sites/public/assets/playground-fixture.json"));
const fixtureStrings = [];
(function walk(value) {
  if (typeof value === "string") {
    fixtureStrings.push(value);
  } else if (Array.isArray(value)) {
    value.forEach(walk);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(walk);
  }
})(fixture);
for (const value of fixtureStrings) {
  if (!looksPortuguese(value)) continue;
  assert(sourceMessages.has(normalize(value)), `playground fixture copy missing from localization owner: ${value}`);
}

const runtime = read("sites/public/i18n/runtime.js");
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
vm.runInContext(runtime, localeRuntimeContext, { filename: "sites/public/i18n/runtime.js" });
const localeRuntime = localeRuntimeContext.window.OrdaXPublicI18n;
assert(localeRuntime.getLocale() === "en-US", "locale regression must exercise the real runtime in en-US");
for (const [source, translated] of [
  ["Armazenamento", "Storage"],
  ["Central de ajuda", "Help center"],
  ["IA", "AI"],
  ["Inteligência artificial", "Artificial intelligence"],
  ["APIs e serviços", "APIs and services"],
]) {
  assert(localeRuntime.fromSource(source) === translated, `account resource translation regression: ${source}`);
}
localeRuntime.setLocale("pt-BR");
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

const siteJs = read("sites/public/assets/site.js");
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

const playground = read("sites/public/assets/playground.js");
for (const value of collectUserFacingJsLiterals(playground)) {
  if (!looksPortuguese(value)) continue;
  assert(sourceMessages.has(normalize(value)), `playground source copy missing from localization owner: ${value}`);
}
const accountExperiment = read("sites/public/assets/account-2.js");
// These are DOM/route identifiers, not labels. Visible labels remain covered.
const accountImplementationTokens = new Set(["conta-2", "dados-pessoais", "privacidade", "assinatura", "consumo", "faturamento", "/conta/", "/conta-2/"]);
for (const value of collectUserFacingJsLiterals(accountExperiment, accountImplementationTokens)) {
  if (!looksPortuguese(value)) continue;
  assert(sourceMessages.has(normalize(value)), `account experiment copy missing from localization owner: ${value}`);
}
// Direct translation calls and visible metadata cannot rely on Portuguese-word
// heuristics: labels such as "Armazenamento" previously escaped those markers.
for (const expression of [
  /\btx\(\s*"((?:\\.|[^"\\])*)"\s*\)/g,
  /\b(?:title|description|label|name|owner|q|a):\s*"((?:\\.|[^"\\])*)"/g,
]) {
  for (const match of accountExperiment.matchAll(expression)) {
    const value = normalize(match[1].replace(/\\(["'\\])/g, "$1"));
    assert(sourceMessages.has(value), `account experiment translated label missing from localization owner: ${value}`);
  }
}
assert(/\bi18n(?:\.|\?\.)fromSource\(/.test(accountExperiment), "account experiment labels must use the existing public-site locale owner");
assert(
  accountExperiment.includes('document.addEventListener("ordax:localechange"'),
  "account experiment must rerender dynamic copy when the public-site locale changes"
);
for (const id of ["account2.usage.unavailablePeriod", "account2.activity.period"]) {
  assert(accountExperiment.includes(id), `account experiment interpolation must use the existing locale owner: ${id}`);
  assert(typeof pt[id] === "string" && typeof en[id] === "string", `account experiment interpolation missing translation: ${id}`);
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
