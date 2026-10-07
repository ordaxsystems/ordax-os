import { assertLocalizationPort } from "../../contracts/localization.mjs";
import { canonicalizeLocale } from "../../contracts/locale-profile.mjs";

const RELATIVE_TIME_UNITS = Object.freeze(new Set([
  "year",
  "quarter",
  "month",
  "week",
  "day",
  "hour",
  "minute",
  "second",
]));

const DISPLAY_NAME_TYPES = Object.freeze(new Set([
  "language",
  "region",
  "script",
  "currency",
  "calendar",
  "dateTimeField",
]));

function assertOptions(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} options must be an object`);
  }
  return value;
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function assertText(value, label, maxLength = 64) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string up to ${maxLength} characters`);
  }
  return text;
}

function assertDateValue(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Date value must be valid");
  }
  return date;
}

function assertListItems(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("List value must be an array");
  }
  return value.map((item) => assertText(item, "List item", 1024));
}

function activeLocale(localization) {
  const port = assertLocalizationPort(localization);
  return canonicalizeLocale(port.getLocale());
}

export function createLocaleFormatting(localization) {
  const port = assertLocalizationPort(localization);

  return Object.freeze({
    formatDate(value, options) {
      return new Intl.DateTimeFormat(
        activeLocale(port),
        assertOptions(options, "Date formatting"),
      ).format(assertDateValue(value));
    },

    formatNumber(value, options) {
      return new Intl.NumberFormat(
        activeLocale(port),
        assertOptions(options, "Number formatting"),
      ).format(assertFiniteNumber(value, "Number value"));
    },

    formatPercent(value, options) {
      const resolved = assertOptions(options, "Percent formatting");
      if (resolved.style !== undefined && resolved.style !== "percent") {
        throw new TypeError("Percent formatting style cannot be overridden");
      }
      return new Intl.NumberFormat(activeLocale(port), {
        ...resolved,
        style: "percent",
      }).format(assertFiniteNumber(value, "Percent value"));
    },

    formatCurrency(value, currency, options) {
      const code = assertText(currency, "Currency code", 64).toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        throw new TypeError("Currency code must be a three-letter currency code");
      }
      const resolved = assertOptions(options, "Currency formatting");
      if (resolved.style !== undefined && resolved.style !== "currency") {
        throw new TypeError("Currency formatting style cannot be overridden");
      }
      if (resolved.currency !== undefined && String(resolved.currency).toUpperCase() !== code) {
        throw new TypeError("Currency formatting currency must match the explicit currency code");
      }
      return new Intl.NumberFormat(activeLocale(port), {
        ...resolved,
        style: "currency",
        currency: code,
      }).format(assertFiniteNumber(value, "Currency value"));
    },

    formatUnit(value, unit, options) {
      const unitId = assertText(unit, "Unit id", 64);
      const resolved = assertOptions(options, "Unit formatting");
      if (resolved.style !== undefined && resolved.style !== "unit") {
        throw new TypeError("Unit formatting style cannot be overridden");
      }
      if (resolved.unit !== undefined && resolved.unit !== unitId) {
        throw new TypeError("Unit formatting unit must match the explicit unit id");
      }
      return new Intl.NumberFormat(activeLocale(port), {
        ...resolved,
        style: "unit",
        unit: unitId,
      }).format(assertFiniteNumber(value, "Unit value"));
    },

    formatList(values, options) {
      return new Intl.ListFormat(
        activeLocale(port),
        assertOptions(options, "List formatting"),
      ).format(assertListItems(values));
    },

    formatRelativeTime(value, unit, options) {
      const unitId = assertText(unit, "Relative time unit", 16);
      if (!RELATIVE_TIME_UNITS.has(unitId)) {
        throw new TypeError(`Unsupported relative time unit: ${unitId}`);
      }
      return new Intl.RelativeTimeFormat(
        activeLocale(port),
        assertOptions(options, "Relative time formatting"),
      ).format(assertFiniteNumber(value, "Relative time value"), unitId);
    },

    selectPlural(value, options) {
      return new Intl.PluralRules(
        activeLocale(port),
        assertOptions(options, "Plural selection"),
      ).select(assertFiniteNumber(value, "Plural value"));
    },

    formatDisplayName(value, type, options) {
      const code = assertText(value, "Display name code", 64);
      const displayType = assertText(type, "Display name type", 16);
      if (!DISPLAY_NAME_TYPES.has(displayType)) {
        throw new TypeError(`Unsupported display name type: ${displayType}`);
      }
      const resolved = assertOptions(options, "Display name formatting");
      if (resolved.type !== undefined && resolved.type !== displayType) {
        throw new TypeError("Display name formatting type must match the explicit type");
      }
      return new Intl.DisplayNames(activeLocale(port), {
        ...resolved,
        type: displayType,
      }).of(code);
    },
  });
}
