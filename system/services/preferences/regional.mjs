import {
  FIRST_RUN_PUBLIC_MVP_LOCALES,
  FIRST_RUN_SUPPORTED_LOCALES,
  FIRST_RUN_SUPPORTED_TIME_ZONES,
} from "../../contracts/first-run-state-store.mjs";

export const REGIONAL_LOCALE_PREFERENCE_ID = "regional.locale";
export const REGIONAL_TIME_ZONE_PREFERENCE_ID = "regional.time-zone";

const LOCALE_LABELS = Object.freeze({
  "pt-BR": "Português (Brasil)",
  "en-US": "English (United States)",
  "es-ES": "Español",
  "de-DE": "Deutsch",
  "fr-FR": "Français",
});

const TIME_ZONE_LABELS = Object.freeze({
  "America/Bahia": "Bahia",
  "America/Sao_Paulo": "Brasília / São Paulo",
  "America/Manaus": "Manaus",
  "America/Rio_Branco": "Rio Branco",
  "America/Noronha": "Fernando de Noronha",
});

export const REGIONAL_LOCALE_OPTIONS = Object.freeze(
  FIRST_RUN_PUBLIC_MVP_LOCALES.map((value) =>
    Object.freeze({ value, label: LOCALE_LABELS[value] ?? value })),
);

export const REGIONAL_TIME_ZONE_OPTIONS = Object.freeze(
  FIRST_RUN_SUPPORTED_TIME_ZONES.map((value) =>
    Object.freeze({ value, label: TIME_ZONE_LABELS[value] ?? value })),
);

const LOCALES = new Set(FIRST_RUN_SUPPORTED_LOCALES);
const TIME_ZONES = new Set(FIRST_RUN_SUPPORTED_TIME_ZONES);

function choicePreference({ id, title, description, defaultValue, options, values }) {
  return Object.freeze({
    id,
    sectionId: "regional",
    label: "Idioma e região",
    title,
    description,
    defaultValue,
    options,
    validate(value) {
      if (!values.has(value)) {
        throw new TypeError(`Unsupported ${id}: ${String(value)}`);
      }
      return value;
    },
  });
}

export const regionalLocalePreference = choicePreference({
  id: REGIONAL_LOCALE_PREFERENCE_ID,
  title: "Idioma",
  description:
    "O MVP público oferece Português (Brasil) e English. Español, Deutsch e Français permanecem reconhecidos para compatibilidade e futura reativação quando a Surface correspondente estiver completa.",
  defaultValue: "pt-BR",
  options: REGIONAL_LOCALE_OPTIONS,
  values: LOCALES,
});

export const regionalTimeZonePreference = choicePreference({
  id: REGIONAL_TIME_ZONE_PREFERENCE_ID,
  title: "Fuso horário",
  description: "Escolha o fuso usado pelo relógio e pelas datas apresentadas pela Surface.",
  defaultValue: "America/Bahia",
  options: REGIONAL_TIME_ZONE_OPTIONS,
  values: TIME_ZONES,
});

export function resolveRegionalTimeZone(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Regional preference snapshot must be an object");
  }
  const candidate = Object.prototype.hasOwnProperty.call(snapshot, REGIONAL_TIME_ZONE_PREFERENCE_ID)
    ? snapshot[REGIONAL_TIME_ZONE_PREFERENCE_ID]
    : regionalTimeZonePreference.defaultValue;
  return regionalTimeZonePreference.validate(candidate);
}

export function isSupportedRegionalTimeZone(value) {
  return TIME_ZONES.has(value);
}
