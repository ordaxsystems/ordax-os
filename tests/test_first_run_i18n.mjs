import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_RUN_TRANSLATION_LOCALES,
  translateFirstRunText,
} from "../system/services/i18n/first-run.mjs";

const LOCALES = ["en-US", "es-ES", "de-DE", "fr-FR"];

test("first-run catalog exposes the four translated launch locales", () => {
  assert.deepEqual([...FIRST_RUN_TRANSLATION_LOCALES], LOCALES);
});

test("each translated locale changes representative setup, Wi-Fi, account and completion strings", () => {
  const samples = [
    "Primeiro uso",
    "Idioma e região",
    "Procurando redes Wi-Fi…",
    "Disponível",
    "Sinal forte",
    "Continuar sem conta",
    "Memória automática",
    "Tudo pronto",
  ];
  for (const locale of LOCALES) {
    for (const sample of samples) {
      assert.notEqual(translateFirstRunText(locale, sample), sample, `${locale}: ${sample}`);
    }
  }
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

test("changed identity selection warning is translated for each supported first-run locale", () => {
  const message = "A sessão da Conta OrdaX mudou. Entre novamente ou continue sem conta.";
  for (const locale of LOCALES) {
    assert.notEqual(translateFirstRunText(locale, message), message);
  }
});
