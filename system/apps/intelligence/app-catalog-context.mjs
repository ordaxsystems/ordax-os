import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  validateIntelligenceContext,
} from "../../contracts/intelligence.mjs";
import { defineIntelligenceContextSource } from "../../contracts/intelligence-context.mjs";
import { listFirstPartyApps } from "../catalog.mjs";

export const FIRST_PARTY_APP_CATALOG_SOURCE_ID = "first-party-app-catalog";

const CHUNK_TARGET_CHARS = Math.min(3800, INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
const PROVENANCE = "ordax:first-party-app-catalog@system/apps/catalog.mjs";

function idList(values) {
  return values.length > 0 ? values.join(",") : "none";
}

function appLine(app) {
  return [
    `id=${app.id}`,
    `title=${app.title}`,
    `version=${app.component.version}`,
    `description=${app.description}`,
    `required=${idList(app.requiredCapabilities)}`,
    `optional=${idList(app.optionalCapabilities)}`,
    `context_sources=${idList(app.intelligence.contextSourceIds)}`,
    `intelligence_tools=${idList(app.intelligence.toolIds)}`,
  ].join(" | ");
}

function buildCatalogContext() {
  const apps = listFirstPartyApps();
  const header = [
    "Trusted OrdaX first-party application catalog.",
    "This is public system metadata, not user content and not permission to read app data.",
    "Declared context sources describe integration points only; they do not authorize collection.",
    `registered_apps=${apps.length}`,
  ].join(" ");

  const chunks = [];
  let lines = [header];
  let currentLength = header.length;

  for (const app of apps) {
    const line = appLine(app);
    const nextLength = currentLength + 1 + line.length;
    if (lines.length > 1 && nextLength > CHUNK_TARGET_CHARS) {
      chunks.push(lines.join("\n"));
      lines = [header, line];
      currentLength = header.length + 1 + line.length;
      continue;
    }
    lines.push(line);
    currentLength = nextLength;
  }
  if (lines.length > 1 || apps.length === 0) chunks.push(lines.join("\n"));

  const items = chunks.map((text, index) => Object.freeze({
    id: `first-party-app-catalog-${index + 1}`,
    scope: "system",
    text,
    provenance: PROVENANCE,
  }));
  return validateIntelligenceContext(items);
}

export function createFirstPartyAppCatalogContextSource() {
  const context = buildCatalogContext();
  return defineIntelligenceContextSource({
    id: FIRST_PARTY_APP_CATALOG_SOURCE_ID,
    title: "OrdaX first-party application catalog",
    activation: "automatic",
    collect() {
      return context;
    },
  });
}
