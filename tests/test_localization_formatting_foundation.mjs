import assert from "node:assert/strict";
import test from "node:test";

import { LOCALIZATION_SCHEMA } from "../system/contracts/localization.mjs";
import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import { createLocaleFormatting } from "../system/services/i18n/formatting.mjs";

function createLocalization(initialLocale = "pt-BR") {
  let locale = initialLocale;
  let profileLocale = initialLocale;
  return {
    schema: LOCALIZATION_SCHEMA,
    getLocale() {
      return locale;
    },
    getProfile() {
      return createLocaleProfile(profileLocale);
    },
    translate(id) {
      return id;
    },
    subscribe() {
      return () => {};
    },
    setLocale(nextLocale) {
      locale = nextLocale;
      profileLocale = nextLocale;
    },
    setProfileLocale(nextLocale) {
      profileLocale = nextLocale;
    },
  };
}

function nativeDate(locale, value, options) {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}

function nativeNumber(locale, value, options) {
  return new Intl.NumberFormat(locale, options).format(value);
}

test("locale formatting follows the active localization owner instead of caching locale state", () => {
  const localization = createLocalization("pt-BR");
  const formatting = createLocaleFormatting(localization);
  const options = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

  assert.equal(formatting.formatNumber(1234.5, options), nativeNumber("pt-BR", 1234.5, options));
  localization.setLocale("en-US");
  assert.equal(formatting.formatNumber(1234.5, options), nativeNumber("en-US", 1234.5, options));
});

test("date, percent, currency and unit formatting delegate to Intl with explicit semantics", () => {
  const localization = createLocalization("en-US");
  const formatting = createLocaleFormatting(localization);
  const instant = Date.UTC(2026, 9, 7, 12, 30, 0);
  const dateOptions = { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" };

  assert.equal(formatting.formatDate(instant, dateOptions), nativeDate("en-US", instant, dateOptions));
  assert.equal(
    formatting.formatPercent(0.125, { maximumFractionDigits: 1 }),
    nativeNumber("en-US", 0.125, { style: "percent", maximumFractionDigits: 1 }),
  );
  assert.equal(
    formatting.formatCurrency(19.9, "brl", { currencyDisplay: "code" }),
    nativeNumber("en-US", 19.9, { style: "currency", currency: "BRL", currencyDisplay: "code" }),
  );
  assert.equal(
    formatting.formatUnit(5, "kilometer", { unitDisplay: "long" }),
    nativeNumber("en-US", 5, { style: "unit", unit: "kilometer", unitDisplay: "long" }),
  );
});

test("list, relative-time, plural and display-name helpers preserve locale semantics", () => {
  const localization = createLocalization("pt-BR");
  const formatting = createLocaleFormatting(localization);

  assert.equal(
    formatting.formatList(["Arquivos", "Notas", "Internet"], { style: "long", type: "conjunction" }),
    new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(["Arquivos", "Notas", "Internet"]),
  );
  assert.equal(
    formatting.formatRelativeTime(-1, "day", { numeric: "auto" }),
    new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(-1, "day"),
  );
  assert.equal(
    formatting.selectPlural(1),
    new Intl.PluralRules("pt-BR").select(1),
  );
  assert.equal(
    formatting.formatDisplayName("US", "region"),
    new Intl.DisplayNames("pt-BR", { type: "region" }).of("US"),
  );
});

test("formatting helpers reject ambiguous or invalid inputs instead of guessing", () => {
  const formatting = createLocaleFormatting(createLocalization("en-US"));

  assert.throws(() => formatting.formatNumber(Number.NaN), /finite number/);
  assert.throws(() => formatting.formatDate("not-a-date"), /Date value must be valid/);
  assert.throws(() => formatting.formatCurrency(10, "REAL"), /three-letter currency code/);
  assert.throws(() => formatting.formatCurrency(10, "BRL", { currency: "USD" }), /must match/);
  assert.throws(() => formatting.formatPercent(0.5, { style: "decimal" }), /cannot be overridden/);
  assert.throws(() => formatting.formatUnit(1, "meter", { unit: "kilometer" }), /must match/);
  assert.throws(() => formatting.formatList("a,b"), /must be an array/);
  assert.throws(() => formatting.formatRelativeTime(-1, "fortnight"), /Unsupported relative time unit/);
  assert.throws(() => formatting.formatDisplayName("US", "territory"), /Unsupported display name type/);
});

test("canonical locale and locale/profile agreement remain part of every formatting call", () => {
  const localization = createLocalization("en-US");
  const formatting = createLocaleFormatting(localization);

  localization.setProfileLocale("pt-BR");
  assert.throws(() => formatting.formatNumber(1), /locale\/profile mismatch/);

  localization.setLocale("not_a_locale");
  assert.throws(() => formatting.formatNumber(1), /Invalid locale id/);
});
