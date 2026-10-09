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

test("date, decimal, percent, currency and unit formatting delegate to Intl with explicit semantics", () => {
  const localization = createLocalization("en-US");
  const formatting = createLocaleFormatting(localization);
  const instant = Date.UTC(2026, 9, 7, 12, 30, 0);
  const dateOptions = { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" };

  assert.equal(formatting.formatDate(instant, dateOptions), nativeDate("en-US", instant, dateOptions));
  assert.equal(
    formatting.formatNumber(1234.5, { maximumFractionDigits: 1 }),
    nativeNumber("en-US", 1234.5, { style: "decimal", maximumFractionDigits: 1 }),
  );
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

test("list, relative-time, plural and display-name helpers preserve locale semantics and list text", () => {
  const localization = createLocalization("pt-BR");
  const formatting = createLocaleFormatting(localization);
  const list = [" Arquivos ", "Notas", "Internet"];

  assert.equal(
    formatting.formatList(list, { style: "long", type: "conjunction" }),
    new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(list),
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

test("generic number formatting cannot bypass explicit percent, currency or unit helpers", () => {
  const formatting = createLocaleFormatting(createLocalization("en-US"));

  assert.throws(
    () => formatting.formatNumber(10, { style: "currency", currency: "USD" }),
    /Number formatting style cannot be overridden/,
  );
  assert.throws(
    () => formatting.formatNumber(10, { currency: "USD" }),
    /Number formatting option currency is not allowed/,
  );
  assert.throws(
    () => formatting.formatNumber(10, { unit: "meter" }),
    /Number formatting option unit is not allowed/,
  );
});

test("specialized number helpers reject conflicting semantic options", () => {
  const formatting = createLocaleFormatting(createLocalization("en-US"));

  assert.throws(
    () => formatting.formatPercent(0.5, { currency: "USD" }),
    /Percent formatting option currency is not allowed/,
  );
  assert.throws(
    () => formatting.formatCurrency(10, "USD", { unit: "meter" }),
    /Currency formatting option unit is not allowed/,
  );
  assert.throws(
    () => formatting.formatUnit(10, "meter", { currency: "USD" }),
    /Unit formatting option currency is not allowed/,
  );
});

test("formatting helpers reject coercive or invalid inputs instead of guessing", () => {
  const formatting = createLocaleFormatting(createLocalization("en-US"));

  assert.throws(() => formatting.formatNumber(Number.NaN), /finite number/);
  assert.throws(() => formatting.formatDate(null), /Date or finite epoch-millisecond number/);
  assert.throws(() => formatting.formatDate("2026-10-07"), /Date or finite epoch-millisecond number/);
  assert.throws(() => formatting.formatDate(new Date(Number.NaN)), /Date value must be valid/);
  assert.throws(() => formatting.formatCurrency(10, 840), /Currency code must be a string/);
  assert.throws(() => formatting.formatCurrency(10, "REAL"), /three-letter currency code/);
  assert.throws(() => formatting.formatCurrency(10, "BRL", { currency: "USD" }), /must match/);
  assert.throws(() => formatting.formatCurrency(10, "BRL", { currency: 986 }), /must be a string/);
  assert.throws(() => formatting.formatPercent(0.5, { style: "decimal" }), /cannot be overridden/);
  assert.throws(() => formatting.formatUnit(1, "meter", { unit: "kilometer" }), /must match/);
  assert.throws(() => formatting.formatUnit(1, { unit: "meter" }), /Unit id must be a string/);
  assert.throws(() => formatting.formatList("a,b"), /must be an array/);
  assert.throws(() => formatting.formatList(["a", 2]), /List item must be a string/);
  assert.throws(() => formatting.formatRelativeTime(-1, "fortnight"), /Unsupported relative time unit/);
  assert.throws(() => formatting.formatRelativeTime(-1, 1), /Relative time unit must be a string/);
  assert.throws(() => formatting.formatDisplayName("US", "territory"), /Unsupported display name type/);
  assert.throws(() => formatting.formatDisplayName({ code: "US" }, "region"), /Display name code must be a string/);
});

test("formatting snapshots option bags instead of depending on later mutation", () => {
  const formatting = createLocaleFormatting(createLocalization("en-US"));
  const options = { maximumFractionDigits: 1 };
  const expected = nativeNumber("en-US", 1234.5, { style: "decimal", maximumFractionDigits: 1 });

  assert.equal(formatting.formatNumber(1234.5, options), expected);
  assert.deepEqual(options, { maximumFractionDigits: 1 });
});

test("canonical locale and locale/profile agreement remain part of every formatting call", () => {
  const localization = createLocalization("en-US");
  const formatting = createLocaleFormatting(localization);

  localization.setProfileLocale("pt-BR");
  assert.throws(() => formatting.formatNumber(1), /locale\/profile mismatch/);

  localization.setLocale("not_a_locale");
  assert.throws(() => formatting.formatNumber(1), /Invalid locale id/);
});
