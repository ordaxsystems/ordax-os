const SOURCE = Object.freeze({
  "studio.runtime.ready": "Device Agent pronto",
  "studio.runtime.degraded": "Device Agent degradado",
  "studio.runtime.disconnected": "Runtime ainda não conectado",
  "studio.metrics.capabilities": "Capabilities",
  "studio.metrics.read": "Leitura",
  "studio.metrics.write": "Escrita",
  "studio.security.readOnly": "Descoberta somente-leitura. Autoridade de mutação: nenhuma.",
});

const ENGLISH = Object.freeze({
  "studio.runtime.ready": "Device Agent ready",
  "studio.runtime.degraded": "Device Agent degraded",
  "studio.runtime.disconnected": "Runtime not connected yet",
  "studio.metrics.capabilities": "Capabilities",
  "studio.metrics.read": "Read",
  "studio.metrics.write": "Write",
  "studio.security.readOnly": "Read-only discovery. Mutation authority: none.",
});

const TABLES = Object.freeze({
  "pt-BR": SOURCE,
  "en-US": ENGLISH,
});

const SOURCE_IDS = Object.freeze(Object.keys(SOURCE));
if (
  Object.keys(ENGLISH).length !== SOURCE_IDS.length
  || SOURCE_IDS.some((messageId) => !(messageId in ENGLISH))
) {
  throw new Error("Studio English catalog must cover every source message");
}

export const STUDIO_LOCALIZATION_SCHEMA = "ordax.studio-localization/1";

export function createStudioLocalization(surfaceLocalization) {
  if (
    !surfaceLocalization
    || typeof surfaceLocalization.getLocale !== "function"
    || typeof surfaceLocalization.subscribe !== "function"
  ) {
    throw new TypeError("Studio localization requires the shared Surface localization owner");
  }

  const getLocale = () => surfaceLocalization.getLocale();
  const translate = (messageId) => {
    if (!SOURCE_IDS.includes(messageId)) {
      throw new TypeError(`Unknown Studio localization message: ${String(messageId)}`);
    }
    const table = TABLES[getLocale()] ?? SOURCE;
    return table[messageId] ?? SOURCE[messageId];
  };

  return Object.freeze({
    schema: STUDIO_LOCALIZATION_SCHEMA,
    getLocale,
    translate,
    subscribe: (listener) => surfaceLocalization.subscribe(listener),
  });
}

export function studioCatalogCoverage(locale) {
  const table = TABLES[locale] ?? null;
  return Object.freeze({
    locale,
    total: SOURCE_IDS.length,
    translated: table ? Object.keys(table).length : 0,
    complete: Boolean(
      table
      && Object.keys(table).length === SOURCE_IDS.length
      && SOURCE_IDS.every((messageId) => typeof table[messageId] === "string" && table[messageId].length > 0)
    ),
  });
}
