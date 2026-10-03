import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  FIRST_RUN_ACCOUNT_LOCALES,
  firstRunAccountCatalogCoverage,
  translateFirstRunAccountText,
} from "../system/services/i18n/first-run-account.mjs";

const EXPECTED_LOCALES = ["pt-BR", "en-US", "es-ES", "de-DE", "fr-FR"];

test("First Run account catalog is complete for every recognized OOBE locale", () => {
  assert.deepEqual([...FIRST_RUN_ACCOUNT_LOCALES], EXPECTED_LOCALES);
  for (const locale of EXPECTED_LOCALES) {
    assert.equal(firstRunAccountCatalogCoverage(locale).complete, true, locale);
  }
});

test("English registration copy is complete and parameterized", () => {
  assert.equal(
    translateFirstRunAccountText("en-US", "firstRun.account.legal.title"),
    "Current documents",
  );
  assert.equal(
    translateFirstRunAccountText("en-US", "firstRun.account.legal.detail"),
    "Read the canonical documents before creating your OrdaX Account.",
  );
  assert.equal(
    translateFirstRunAccountText("en-US", "firstRun.account.legal.privacy", {
      version: "2026-10-03",
      effectiveDate: "2026-10-03",
    }),
    "Privacy · v2026-10-03 · 2026-10-03",
  );
  assert.equal(
    translateFirstRunAccountText("en-US", "firstRun.account.legal.terms", {
      version: "2026-10-03",
      effectiveDate: "2026-10-03",
    }),
    "Terms · v2026-10-03 · 2026-10-03",
  );
  assert.equal(
    translateFirstRunAccountText("en-US", "firstRun.account.legal.accept"),
    "I have read and accept the current documents listed above.",
  );
  assert.equal(
    translateFirstRunAccountText("en-US", "firstRun.account.register.pending"),
    "Creating account…",
  );
});

test("First Run account formatter fails closed for unknown ids and missing parameters", () => {
  assert.throws(
    () => translateFirstRunAccountText("en-US", "firstRun.account.missing"),
    /Unknown First Run account message/,
  );
  assert.throws(
    () => translateFirstRunAccountText("en-US", "firstRun.account.legal.privacy", { version: "v1" }),
    /Missing First Run account message parameter: effectiveDate/,
  );
});

test("First Run registration renderer uses semantic account copy instead of raw Portuguese", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/first-run.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /translateFirstRunAccountText/);
  for (const messageId of [
    "firstRun.account.legal.title",
    "firstRun.account.legal.detail",
    "firstRun.account.legal.privacy",
    "firstRun.account.legal.terms",
    "firstRun.account.legal.accept",
    "firstRun.account.register.pending",
  ]) {
    assert.equal(source.includes(messageId), true, messageId);
  }
  for (const unsafe of [
    "privacy.textContent = `Privacidade",
    "terms.textContent = `Termos",
    'el(documentObject, "strong", "", "Documentos vigentes")',
    'el(documentObject, "span", "", "Li e aceito os documentos vigentes indicados acima.")',
    'identityPending === "register" ? "Criando conta…"',
  ]) {
    assert.equal(source.includes(unsafe), false, `raw registration copy escaped semantic owner: ${unsafe}`);
  }
});
