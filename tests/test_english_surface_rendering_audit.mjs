import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  STUDIO_WORKSPACE_ENGLISH_MESSAGES,
  STUDIO_WORKSPACE_SOURCE_MESSAGES,
} from "../system/services/i18n/catalog/studio-workspace.mjs";
import { translateSurfaceMessage } from "../system/services/i18n/surface.mjs";

const PORTUGUESE_MARKER = /(?:[ãõáéíóúâêôç])|\b(?:abrir|ajustes|agora|aguarde|arquivo|arquivos|atualização|atualizando|bateria|cadastro|carregando|conectar|conectado|conta|continuar|criar|degradado|desconectado|disponível|documentos|energia|escrita|excluir|falha|fechar|fuso|idioma|indisponível|início|leitura|nenhum|nenhuma|nota|notas|ontem|pendrive|primeiro|privacidade|pronto|procurar|rede|região|renomear|salvar|salvo|salva|segurança|senha|sessão|sinal|sistema|somente|termos|tudo|vigentes|voltar)\b/iu;

const PROVEN_LOCALIZED_DEFAULTS = Object.freeze({
});

function literalBodies(source) {
  const values = [];
  const regex = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g;
  for (const match of source.matchAll(regex)) {
    const body = match[1] ?? match[2] ?? match[3] ?? "";
    values.push(body.replace(/\$\{[^}]*\}/g, " "));
  }
  return values;
}

async function walkMjs(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walkMjs(full));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) output.push(full);
  }
  return output;
}

function assertEnglishCopy(messageId, sourceCopy = null) {
  const english = translateSurfaceMessage("en-US", messageId);
  assert.equal(typeof english, "string", `${messageId}: en-US copy must be text`);
  assert.ok(english.length > 0, `${messageId}: en-US copy must not be empty`);
  if (sourceCopy !== null) {
    assert.equal(
      translateSurfaceMessage("pt-BR", messageId),
      sourceCopy,
      `${messageId}: app metadata drifted from the PT-BR source catalog`,
    );
  }
  assert.equal(
    PORTUGUESE_MARKER.test(english),
    false,
    `${messageId}: possible PT-BR copy leaked into en-US: ${english}`,
  );
}

function exactCatalogKeys(source, english, label) {
  assert.deepEqual(
    Object.keys(english).sort(),
    Object.keys(source).sort(),
    `${label}: en-US must have the exact PT-BR message-id set`,
  );
  for (const [messageId, value] of Object.entries(english)) {
    assert.equal(typeof value, "string", `${messageId}: English copy must be text`);
    assert.ok(value.length > 0, `${messageId}: English copy must not be empty`);
    assert.equal(
      PORTUGUESE_MARKER.test(value),
      false,
      `${messageId}: possible PT-BR copy leaked into English: ${value}`,
    );
  }
}

test("every registered first-party app has localized en-US display metadata", () => {
  const apps = listFirstPartyApps();
  assert.ok(apps.length >= 8, "audit must inspect the canonical first-party app catalog");

  for (const app of apps) {
    assertEnglishCopy(`app.${app.id}.title`, app.title);
    assertEnglishCopy(`app.${app.id}.description`, app.description);

    app.panels.forEach((panel, index) => {
      assertEnglishCopy(`app.${app.id}.panel.${index}.label`, panel.label);
      assertEnglishCopy(`app.${app.id}.panel.${index}.title`, panel.title);
      if (panel.body) assertEnglishCopy(`app.${app.id}.panel.${index}.body`, panel.body);

      // The generic Surface renderer currently displays preference-choice option.label
      // directly. Until that renderer consumes localized message identities, no public
      // first-party app may use this panel kind without risking a locale leak.
      assert.notEqual(
        panel.kind,
        "preference-choice",
        `${app.id} panel ${index}: preference-choice would render raw option.label without localization`,
      );
    });
  }
});

test("Studio workspace has an exact shared pt-BR/en-US catalog", () => {
  exactCatalogKeys(
    STUDIO_WORKSPACE_SOURCE_MESSAGES,
    STUDIO_WORKSPACE_ENGLISH_MESSAGES,
    "Studio workspace",
  );
});

test("rendering modules outside First Run contain no unowned Portuguese UI literals", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const surfaceUiRoot = path.join(repositoryRoot, "system", "surface", "ui");
  const appsRoot = path.join(repositoryRoot, "system", "apps");

  const surfaceFiles = (await walkMjs(surfaceUiRoot))
    .filter((file) => path.basename(file) !== "first-run.mjs");
  const appUiFiles = (await walkMjs(appsRoot))
    .filter((file) => file.split(path.sep).includes("ui"));
  const files = [...surfaceFiles, ...appUiFiles];
  assert.ok(files.length > 15, "audit must cover the real Surface/app UI module set");

  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(repositoryRoot, file).split(path.sep).join("/");
    for (const literal of literalBodies(source)) {
      if (!PORTUGUESE_MARKER.test(literal)) continue;
      // Absolute application paths are data, not presentation copy. They are rendered
      // only where a path is intentionally shown to the user and must not be translated.
      if (literal.startsWith("/")) continue;
      if (PROVEN_LOCALIZED_DEFAULTS[relative]?.has(literal)) continue;
      violations.push(`${relative} :: ${literal}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `direct PT-BR UI literals bypass localization:\n${violations.join("\n")}`,
  );
});
