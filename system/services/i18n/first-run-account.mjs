const TABLES = Object.freeze({
  "pt-BR": Object.freeze({
    "firstRun.account.legal.title": "Documentos vigentes",
    "firstRun.account.legal.detail": "Leia os documentos canônicos antes de criar sua Conta OrdaX.",
    "firstRun.account.legal.privacy": "Privacidade · v{version} · {effectiveDate}",
    "firstRun.account.legal.terms": "Termos · v{version} · {effectiveDate}",
    "firstRun.account.legal.accept": "Li e aceito os documentos vigentes indicados acima.",
    "firstRun.account.register.pending": "Criando conta…",
  }),
  "en-US": Object.freeze({
    "firstRun.account.legal.title": "Current documents",
    "firstRun.account.legal.detail": "Read the canonical documents before creating your OrdaX Account.",
    "firstRun.account.legal.privacy": "Privacy · v{version} · {effectiveDate}",
    "firstRun.account.legal.terms": "Terms · v{version} · {effectiveDate}",
    "firstRun.account.legal.accept": "I have read and accept the current documents listed above.",
    "firstRun.account.register.pending": "Creating account…",
  }),
  "es-ES": Object.freeze({
    "firstRun.account.legal.title": "Documentos vigentes",
    "firstRun.account.legal.detail": "Lee los documentos canónicos antes de crear tu Cuenta OrdaX.",
    "firstRun.account.legal.privacy": "Privacidad · v{version} · {effectiveDate}",
    "firstRun.account.legal.terms": "Términos · v{version} · {effectiveDate}",
    "firstRun.account.legal.accept": "He leído y acepto los documentos vigentes indicados arriba.",
    "firstRun.account.register.pending": "Creando cuenta…",
  }),
  "de-DE": Object.freeze({
    "firstRun.account.legal.title": "Gültige Dokumente",
    "firstRun.account.legal.detail": "Lies die gültigen Dokumente, bevor du dein OrdaX-Konto erstellst.",
    "firstRun.account.legal.privacy": "Datenschutz · v{version} · {effectiveDate}",
    "firstRun.account.legal.terms": "Nutzungsbedingungen · v{version} · {effectiveDate}",
    "firstRun.account.legal.accept": "Ich habe die oben genannten gültigen Dokumente gelesen und stimme ihnen zu.",
    "firstRun.account.register.pending": "Konto wird erstellt…",
  }),
  "fr-FR": Object.freeze({
    "firstRun.account.legal.title": "Documents en vigueur",
    "firstRun.account.legal.detail": "Lisez les documents canoniques avant de créer votre compte OrdaX.",
    "firstRun.account.legal.privacy": "Confidentialité · v{version} · {effectiveDate}",
    "firstRun.account.legal.terms": "Conditions · v{version} · {effectiveDate}",
    "firstRun.account.legal.accept": "J’ai lu et j’accepte les documents en vigueur indiqués ci-dessus.",
    "firstRun.account.register.pending": "Création du compte…",
  }),
});

const SOURCE = TABLES["pt-BR"];
const MESSAGE_IDS = Object.freeze(Object.keys(SOURCE));

for (const [locale, table] of Object.entries(TABLES)) {
  if (
    Object.keys(table).length !== MESSAGE_IDS.length
    || MESSAGE_IDS.some((messageId) => typeof table[messageId] !== "string" || table[messageId].length === 0)
  ) {
    throw new Error(`First Run account catalog is incomplete for ${locale}`);
  }
}

function format(template, params) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => {
    if (!(key in params)) throw new TypeError(`Missing First Run account message parameter: ${key}`);
    return String(params[key]);
  });
}

export const FIRST_RUN_ACCOUNT_LOCALES = Object.freeze(Object.keys(TABLES));

export function translateFirstRunAccountText(locale, messageId, params = Object.freeze({})) {
  if (!MESSAGE_IDS.includes(messageId)) {
    throw new TypeError(`Unknown First Run account message: ${String(messageId)}`);
  }
  const table = TABLES[locale] ?? SOURCE;
  return format(table[messageId] ?? SOURCE[messageId], params);
}

export function firstRunAccountCatalogCoverage(locale) {
  const table = TABLES[locale] ?? null;
  return Object.freeze({
    locale,
    total: MESSAGE_IDS.length,
    translated: table ? Object.keys(table).length : 0,
    complete: Boolean(table && MESSAGE_IDS.every((messageId) => typeof table[messageId] === "string" && table[messageId].length > 0)),
  });
}
