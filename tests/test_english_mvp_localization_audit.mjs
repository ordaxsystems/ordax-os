import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  surfaceCatalogCoverage,
  surfaceMessageIds,
  translateSurfaceMessage,
} from "../system/services/i18n/surface.mjs";
import { translateFirstRunText } from "../system/services/i18n/first-run.mjs";
import {
  FIRST_RUN_PUBLIC_MVP_LOCALES,
} from "../system/contracts/first-run-state-store.mjs";
import {
  FILES_SOURCE_MESSAGES,
  FILES_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/files.mjs";
import {
  SETTINGS_SOURCE_MESSAGES,
  SETTINGS_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/settings.mjs";
import {
  SYSTEM_SOURCE_MESSAGES,
  SYSTEM_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/system.mjs";
import {
  SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES,
  SYSTEM_DIAGNOSTICS_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/system-diagnostics.mjs";
import {
  NOTES_SOURCE_MESSAGES,
  NOTES_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/notes.mjs";
import {
  INTERNET_SOURCE_MESSAGES,
  INTERNET_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/internet.mjs";
import {
  PROJECTS_SOURCE_MESSAGES,
  PROJECTS_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/projects.mjs";
import {
  ACCOUNT_SOURCE_MESSAGES,
  ACCOUNT_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/account.mjs";
import {
  ASSISTANT_SOURCE_MESSAGES,
  ASSISTANT_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/assistant.mjs";
import {
  ACTIVITY_SOURCE_MESSAGES,
  ACTIVITY_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/activity.mjs";
import {
  NETWORK_SOURCE_MESSAGES,
  NETWORK_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/network.mjs";
import {
  NETWORK_APP_SOURCE_MESSAGES,
  NETWORK_APP_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/network-app.mjs";
import {
  POWER_SOURCE_MESSAGES,
  POWER_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/power.mjs";
import {
  NOTIFICATIONS_SOURCE_MESSAGES,
  NOTIFICATIONS_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/notifications.mjs";
import {
  LOCAL_SESSION_SOURCE_MESSAGES,
  LOCAL_SESSION_ENGLISH_MESSAGES,
} from "../system/services/i18n/catalog/local-session.mjs";

const CATALOG_PAIRS = Object.freeze([
  ["files", FILES_SOURCE_MESSAGES, FILES_ENGLISH_MESSAGES],
  ["settings", SETTINGS_SOURCE_MESSAGES, SETTINGS_ENGLISH_MESSAGES],
  ["system", SYSTEM_SOURCE_MESSAGES, SYSTEM_ENGLISH_MESSAGES],
  ["system-diagnostics", SYSTEM_DIAGNOSTICS_SOURCE_MESSAGES, SYSTEM_DIAGNOSTICS_ENGLISH_MESSAGES],
  ["notes", NOTES_SOURCE_MESSAGES, NOTES_ENGLISH_MESSAGES],
  ["internet", INTERNET_SOURCE_MESSAGES, INTERNET_ENGLISH_MESSAGES],
  ["projects", PROJECTS_SOURCE_MESSAGES, PROJECTS_ENGLISH_MESSAGES],
  ["account", ACCOUNT_SOURCE_MESSAGES, ACCOUNT_ENGLISH_MESSAGES],
  ["assistant", ASSISTANT_SOURCE_MESSAGES, ASSISTANT_ENGLISH_MESSAGES],
  ["activity", ACTIVITY_SOURCE_MESSAGES, ACTIVITY_ENGLISH_MESSAGES],
  ["network", NETWORK_SOURCE_MESSAGES, NETWORK_ENGLISH_MESSAGES],
  ["network-app", NETWORK_APP_SOURCE_MESSAGES, NETWORK_APP_ENGLISH_MESSAGES],
  ["power", POWER_SOURCE_MESSAGES, POWER_ENGLISH_MESSAGES],
  ["notifications", NOTIFICATIONS_SOURCE_MESSAGES, NOTIFICATIONS_ENGLISH_MESSAGES],
  ["local-session", LOCAL_SESSION_SOURCE_MESSAGES, LOCAL_SESSION_ENGLISH_MESSAGES],
]);

const FIRST_RUN_LEGAL_ENGLISH = Object.freeze({
  "Documentos vigentes": "Current documents",
  "Leia os documentos canônicos antes de criar sua Conta OrdaX.":
    "Read the canonical documents before creating your OrdaX Account.",
  "Privacidade": "Privacy",
  "Termos": "Terms",
  "Li e aceito os documentos vigentes indicados acima.":
    "I have read and accept the current documents listed above.",
  "Criando conta…": "Creating account…",
});

function placeholders(value) {
  return [...String(value).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

function unique(values) {
  return [...new Set(values)];
}

// These fragments are deliberately kept in their native spelling when English is active.
const ENGLISH_NATIVE_LANGUAGE_EXCEPTIONS = new Set([
  "settings.preference.locale.description",
  "settings.preference.locale.option.ptBr.description",
  "settings.keyboard.option.brAbnt2.label",
  "settings.keyboard.option.brAbnt2.description",
]);

const PORTUGUESE_MARKER = /(?:[ãõáéíóúâêôç])|\b(?:abrir|ajustes|agora|aguarde|arquivo|arquivos|atualização|atualizando|bateria|carregando|conectar|conectado|conta|continuar|criar|desconectado|disponível|documentos|energia|excluir|falha|fechar|fuso|idioma|indisponível|início|nenhum|nenhuma|notas|ontem|pendrive|primeiro|privacidade|pronto|procurar|rede|região|renomear|salvar|salvo|salva|segurança|senha|sessão|sinal|sistema|somente|termos|tudo|vigentes|voltar)\b/iu;

function decodeQuotedBody(body) {
  return JSON.parse(`"${body}"`);
}

function collapseAdjacentStringConcats(source) {
  const adjacent = /"((?:\\.|[^"\\])*)"\s*\+\s*"((?:\\.|[^"\\])*)"/g;
  let current = source;
  while (adjacent.test(current)) {
    adjacent.lastIndex = 0;
    current = current.replace(adjacent, (_match, left, right) =>
      JSON.stringify(decodeQuotedBody(left) + decodeQuotedBody(right)));
    adjacent.lastIndex = 0;
  }
  return current;
}

function parseDoubleQuotedLiterals(source) {
  const values = [];
  const regex = /"((?:\\.|[^"\\])*)"/g;
  for (const match of source.matchAll(regex)) {
    try {
      values.push(decodeQuotedBody(match[1]));
    } catch {
      // Non-JSON escape syntax is not a user-facing literal for this audit.
    }
  }
  return values;
}

test("every first-party English catalog has the exact source key set and placeholder contract", () => {
  for (const [name, source, english] of CATALOG_PAIRS) {
    const sourceIds = Object.keys(source).sort();
    const englishIds = Object.keys(english).sort();
    assert.deepEqual(englishIds, sourceIds, `${name}: English/source message ids diverged`);

    for (const messageId of sourceIds) {
      assert.equal(typeof source[messageId], "string", `${name}:${messageId}: source copy must be text`);
      assert.ok(source[messageId].length > 0, `${name}:${messageId}: source copy must not be empty`);
      assert.equal(typeof english[messageId], "string", `${name}:${messageId}: English copy must be text`);
      assert.ok(english[messageId].length > 0, `${name}:${messageId}: English copy must not be empty`);
      assert.deepEqual(
        placeholders(english[messageId]),
        placeholders(source[messageId]),
        `${name}:${messageId}: interpolation placeholders diverged`,
      );
    }
  }
});

test("aggregate en-US Surface output preserves placeholders and contains no accidental PT-BR UI copy", () => {
  const ids = surfaceMessageIds();
  assert.ok(ids.length > 100, "audit must cover the complete aggregated Surface catalog");
  assert.equal(surfaceCatalogCoverage("en-US").complete, true);

  for (const messageId of ids) {
    const source = translateSurfaceMessage("pt-BR", messageId);
    const english = translateSurfaceMessage("en-US", messageId);
    assert.equal(typeof english, "string");
    assert.ok(english.length > 0, `${messageId}: English output must not be empty`);
    assert.deepEqual(
      placeholders(english),
      placeholders(source),
      `${messageId}: aggregate interpolation placeholders diverged`,
    );
    if (!ENGLISH_NATIVE_LANGUAGE_EXCEPTIONS.has(messageId)) {
      assert.equal(
        PORTUGUESE_MARKER.test(english),
        false,
        `${messageId}: possible PT-BR copy leaked into en-US: ${english}`,
      );
    }
  }
});

test("public MVP locale selector stays limited to Surface-complete PT-BR and en-US", () => {
  assert.deepEqual(FIRST_RUN_PUBLIC_MVP_LOCALES, ["pt-BR", "en-US"]);
  for (const locale of FIRST_RUN_PUBLIC_MVP_LOCALES) {
    assert.equal(surfaceCatalogCoverage(locale).complete, true, `${locale} must be Surface-complete`);
  }
});

test("First Run legal registration copy is explicitly complete in en-US", () => {
  for (const [source, expected] of Object.entries(FIRST_RUN_LEGAL_ENGLISH)) {
    assert.equal(translateFirstRunText("en-US", source), expected, source);
  }
});

test("every Portuguese first-run UI literal with product copy has an en-US translation", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/first-run.mjs", import.meta.url),
    "utf8",
  );
  const runtimeLiteralSource = collapseAdjacentStringConcats(source);
  const candidates = unique(
    parseDoubleQuotedLiterals(runtimeLiteralSource)
      .filter((value) => typeof value === "string" && PORTUGUESE_MARKER.test(value)),
  );
  assert.ok(candidates.length > 45, "audit must inspect the real first-run Portuguese copy set");

  const missing = candidates.filter((value) => translateFirstRunText("en-US", value) === value);
  assert.deepEqual(missing, [], `First Run has untranslated en-US copy: ${missing.join(" | ")}`);
});

test("First Run legal links never bypass localization with raw PT-BR labels", async () => {
  const source = await readFile(
    new URL("../system/surface/ui/first-run.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /privacy\.textContent\s*=\s*`\$\{translateFirstRunText\(draft\.locale, "Privacidade"\)\}/,
  );
  assert.match(
    source,
    /terms\.textContent\s*=\s*`\$\{translateFirstRunText\(draft\.locale, "Termos"\)\}/,
  );
  assert.doesNotMatch(source, /privacy\.textContent\s*=\s*`Privacidade\s*·/);
  assert.doesNotMatch(source, /terms\.textContent\s*=\s*`Termos\s*·/);
});
