import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { translateSurfaceMessage } from "../system/services/i18n/surface.mjs";

const PORTUGUESE_MARKER = /(?:[ãõáéíóúâêôç])|\b(?:abrir|ajustes|agora|aguarde|arquivo|arquivos|atualização|atualizando|bateria|cadastro|carregando|conectar|conectado|conta|continuar|criar|desconectado|disponível|documentos|energia|excluir|falha|fechar|fuso|idioma|indisponível|início|nenhum|nenhuma|notas|ontem|pendrive|primeiro|privacidade|pronto|procurar|rede|região|renomear|salvar|salvo|salva|segurança|senha|sessão|sinal|sistema|somente|termos|tudo|vigentes|voltar)\b/iu;

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

test("rendering modules outside First Run contain no direct Portuguese UI literals", async () => {
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
    for (const literal of literalBodies(source)) {
      if (!PORTUGUESE_MARKER.test(literal)) continue;
      violations.push(`${path.relative(repositoryRoot, file)} :: ${literal}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `direct PT-BR UI literals bypass localization:\n${violations.join("\n")}`,
  );
});
