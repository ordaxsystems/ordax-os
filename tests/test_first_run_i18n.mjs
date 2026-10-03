import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  FIRST_RUN_TRANSLATION_LOCALES,
  translateFirstRunText,
} from "../system/services/i18n/first-run.mjs";

const LOCALES = ["en-US", "es-ES", "de-DE", "fr-FR"];

test("first-run catalog exposes the four translated launch locales", () => {
  assert.deepEqual([...FIRST_RUN_TRANSLATION_LOCALES], LOCALES);
});

test("each translated locale changes representative setup, Wi-Fi, account, legal and completion strings", () => {
  const samples = [
    "Primeiro uso",
    "Idioma e região",
    "Procurando redes Wi-Fi…",
    "Disponível",
    "Sinal forte",
    "Continuar sem conta",
    "Criando conta…",
    "Documentos vigentes",
    "Leia os documentos canônicos antes de criar sua Conta OrdaX.",
    "Li e aceito os documentos vigentes indicados acima.",
    "Termos",
    "Tudo pronto",
  ];
  for (const locale of LOCALES) {
    for (const sample of samples) {
      assert.notEqual(translateFirstRunText(locale, sample), sample, `${locale}: ${sample}`);
    }
  }
});

test("English account registration legal copy is complete and natural", () => {
  assert.equal(translateFirstRunText("en-US", "Criando conta…"), "Creating account…");
  assert.equal(translateFirstRunText("en-US", "Documentos vigentes"), "Current documents");
  assert.equal(
    translateFirstRunText("en-US", "Leia os documentos canônicos antes de criar sua Conta OrdaX."),
    "Read the canonical documents before creating your OrdaX Account.",
  );
  assert.equal(
    translateFirstRunText("en-US", "Li e aceito os documentos vigentes indicados acima."),
    "I have read and accept the current documents listed above.",
  );
  assert.equal(translateFirstRunText("en-US", "Privacidade"), "Privacy");
  assert.equal(translateFirstRunText("en-US", "Termos"), "Terms");
});

test("first-run legal links route visible labels through the locale owner", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/first-run.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /privacy\.textContent = `\$\{translateFirstRunText\(draft\.locale, "Privacidade"\)\}/,
  );
  assert.match(
    source,
    /terms\.textContent = `\$\{translateFirstRunText\(draft\.locale, "Termos"\)\}/,
  );
  assert.doesNotMatch(source, /privacy\.textContent = `Privacidade/);
  assert.doesNotMatch(source, /terms\.textContent = `Termos/);
});

test("dynamic Wi-Fi password and signed-in identity text are localized", () => {
  for (const locale of LOCALES) {
    assert.notEqual(translateFirstRunText(locale, "Senha de MinhaRede"), "Senha de MinhaRede");
    assert.notEqual(
      translateFirstRunText(locale, "Conta autenticada como Ana."),
      "Conta autenticada como Ana.",
    );
  }
});

test("Portuguese remains the canonical source language and unknown locales fail back safely", () => {
  assert.equal(translateFirstRunText("pt-BR", "Continuar"), "Continuar");
  assert.equal(translateFirstRunText("it-IT", "Continuar"), "Continuar");
});
