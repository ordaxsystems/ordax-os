import { assertLocalizationPort } from "../../contracts/localization.mjs";
import {
  assertLocaleProfile,
  canonicalizeLocale,
} from "../../contracts/locale-profile.mjs";

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

const CURRENCY_OPTION_KEYS = Object.freeze([
  "currency",
  "currencyDisplay",
  "currencySign",
]);

const UNIT_OPTION_KEYS = Object.freeze([
  "unit",
  "unitDisplay",
]);

function assertOptions(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} options must be an object`);
  }
  return { ...value };
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function assertIdentifier(value, label, maxLength = 64) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty string up to ${maxLength} characters`);
  }
  return text;
}

function assertDisplayText(value, label, maxLength = 1024) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  if (!value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} must be non-empty text up to ${maxLength} characters`);
  }
  return value;
}

function assertDateValue(value) {
  let date;
  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value);
  } else {
    throw new TypeError("Date value must be a Date or finite epoch-millisecond number");
  }
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Date value must be valid");
  }
  return date;
}

function assertListItems(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("List value must be an array");
  }
  return value.map((item) => assertDisplayText(item, "List item"));
}

function assertStyle(options, expected, label) {
  if (options.style !== undefined && options.style !== expected) {
    throw new TypeError(`${label} style cannot be overridden`);
  }
}

function rejectOptions(options, keys, label) {
  for (const key of keys) {
    if (options[key] !== undefined) {
      throw new TypeError(`${label} option ${key} is not allowed`);
    }
  }
}

function activeLocale(localization) {
  const locale = canonicalizeLocale(localization.getLocale());
  const profile = assertLocaleProfile(localization.getProfile());
  if (profile.locale !== locale) {
    throw new TypeError("Localization port locale/profile mismatch");
  }
  return locale;
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
      const resolved = assertOptions(options, "Number formatting");
      assertStyle(resolved, "decimal", "Number formatting");
      rejectOptions(resolved, [...CURRENCY_OPTION_KEYS, ...UNIT_OPTION_KEYS], "Number formatting");
      return new Intl.NumberFormat(activeLocale(port), {
        ...resolved,
        style: "decimal",
      }).format(assertFiniteNumber(value, "Number value"));
    },

    formatPercent(value, options) {
      const resolved = assertOptions(options, "Percent formatting");
      assertStyle(resolved, "percent", "Percent formatting");
      rejectOptions(resolved, [...CURRENCY_OPTION_KEYS, ...UNIT_OPTION_KEYS], "Percent formatting");
      return new Intl.NumberFormat(activeLocale(port), {
        ...resolved,
        style: "percent",
      }).format(assertFiniteNumber(value, "Percent value"));
    },

    formatCurrency(value, currency, options) {
      const code = assertIdentifier(currency, "Currency code").toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        throw new TypeError("Currency code must be a three-letter currency code");
      }
      const resolved = assertOptions(options, "Currency formatting");
      assertStyle(resolved, "currency", "Currency formatting");
      rejectOptions(resolved, UNIT_OPTION_KEYS, "Currency formatting");
      if (resolved.currency !== undefined) {
        const optionCurrency = assertIdentifier(resolved.currency, "Currency formatting currency")
          .toUpperCase();
        if (optionCurrency !== code) {
          throw new TypeError("Currency formatting currency must match the explicit currency code");
        }
      }
      return new Intl.NumberFormat(activeLocale(port), {
        ...resolved,
        style: "currency",
        currency: code,
      }).format(assertFiniteNumber(value, "Currency value"));
    },

    formatUnit(value, unit, options) {
      const unitId = assertIdentifier(unit, "Unit id");
      const resolved = assertOptions(options, "Unit formatting");
      assertStyle(resolved, "unit", "Unit formatting");
      rejectOptions(resolved, CURRENCY_OPTION_KEYS, "Unit formatting");
      if (resolved.unit !== undefined) {
        const optionUnit = assertIdentifier(resolved.unit, "Unit formatting unit");
        if (optionUnit !== unitId) {
          throw new TypeError("Unit formatting unit must match the explicit unit id");
        }
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
      const unitId = assertIdentifier(unit, "Relative time unit", 16);
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
      const code = assertIdentifier(value, "Display name code");
      const displayType = assertIdentifier(type, "Display name type", 16);
      if (!DISPLAY_NAME_TYPES.has(displayType)) {
        throw new TypeError(`Unsupported display name type: ${displayType}`);
      }
      const resolved = assertOptions(options, "Display name formatting");
      if (resolved.type !== undefined) {
        const optionType = assertIdentifier(resolved.type, "Display name formatting type", 16);
        if (optionType !== displayType) {
          throw new TypeError("Display name formatting type must match the explicit type");
        }
      }
      return new Intl.DisplayNames(activeLocale(port), {
        ...resolved,
        type: displayType,
      }).of(code);
    },
  });
}
