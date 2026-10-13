import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dir, "../../../../..");
const PACKAGE = path.resolve(import.meta.dir, "../..");
const CATALOG_PATH = path.join(ROOT, "sites/public/i18n/catalog.js");

const UI_SOURCES = [
  "src/components/account/shell.tsx",
  "src/components/account/overview.tsx",
  "src/components/account/details.tsx",
  "src/components/account/integration-panel.tsx",
  "src/lib/account/model.ts",
];

const PORTUGUESE_MARKERS = /[ãõçÃÕÇ]|\b(?:não|uma|para|seu|sua|conta|cadastro|senha|privacidade|recuperação|disponível|indisponível|segurança|criar|entrar|início|ainda|quando|dados|acesso|sessão|preferências|dispositivos|assinatura|consumo|faturamento|plano|serviço|serviços|ajuda|atividade|perfil|armazenamento|cobrança|pagamento|fatura|histórico|alterações|informações|identidade|proteção|verificação|região|idioma|notificações|comunicações|excluir|exportar|salvar|nenhuma|nenhum)\b/i;

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function loadCatalog() {
  const context = vm.createContext({ window: {} as Record<string, unknown> });
  vm.runInContext(fs.readFileSync(CATALOG_PATH, "utf8"), context, { filename: CATALOG_PATH });
  return (context.window as any).OrdaXPublicI18nCatalog;
}

function looksPortuguese(value: string) {
  return PORTUGUESE_MARKERS.test(normalize(value));
}

function isTechnicalLiteral(value: string) {
  const normalized = normalize(value);
  return !normalized
    || normalized.startsWith("/")
    || normalized.startsWith("@/")
    || normalized.startsWith(".")
    || normalized === "pt-BR"
    || normalized === "en-US";
}

function collectPortugueseLiterals(relativePath: string) {
  const absolute = path.join(PACKAGE, relativePath);
  const source = fs.readFileSync(absolute, "utf8");
  const file = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = new Set<string>();
  const dynamicFragments = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) {
      const value = normalize(node.text);
      if (!isTechnicalLiteral(value) && looksPortuguese(value)) found.add(value);
    } else if (
      ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)
    ) {
      const value = normalize(node.text);
      if (value && looksPortuguese(value)) dynamicFragments.add(value);
    } else if (ts.isJsxText(node)) {
      const value = normalize(node.text);
      if (value && looksPortuguese(value)) found.add(value);
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return { found, dynamicFragments };
}

describe("official public i18n owner", () => {
  test("React Account candidate loads the canonical public catalog/runtime before React", () => {
    const html = fs.readFileSync(path.join(PACKAGE, "index.html"), "utf8");
    const catalog = "/i18n/catalog.js";
    const runtime = "/i18n/runtime.js";
    const entry = "/src/account-entry.tsx";
    expect(html).toContain(catalog);
    expect(html).toContain(runtime);
    expect(html).toContain(entry);
    expect(html.indexOf(catalog)).toBeLessThan(html.indexOf(runtime));
    expect(html.indexOf(runtime)).toBeLessThan(html.indexOf(entry));
  });

  test("all static pt-BR account copy is owned by the canonical public catalog", () => {
    const catalog = loadCatalog();
    expect(catalog?.schema).toBe("prototype-ordax.public-site-localization/1");
    const sourceMessages = new Set(Object.keys(catalog.sourceIndex).map(normalize));
    const missing: string[] = [];

    for (const relativePath of UI_SOURCES) {
      const { found } = collectPortugueseLiterals(relativePath);
      for (const value of found) {
        if (!sourceMessages.has(value)) missing.push(`${relativePath}: ${value}`);
      }
    }

    expect(missing.sort()).toEqual([]);
  });

  test("dynamic pt-BR template fragments cannot bypass message IDs", () => {
    const dynamic: string[] = [];
    for (const relativePath of UI_SOURCES) {
      const { dynamicFragments } = collectPortugueseLiterals(relativePath);
      for (const value of dynamicFragments) dynamic.push(`${relativePath}: ${value}`);
    }
    expect(dynamic.sort()).toEqual([]);
  });
});
