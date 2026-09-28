import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  FIRST_PARTY_APP_CATALOG_SOURCE_ID,
  createFirstPartyAppCatalogContextSource,
} from "../system/apps/intelligence/app-catalog-context.mjs";
import { defineIntelligenceContextSource } from "../system/contracts/intelligence-context.mjs";
import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
} from "../system/contracts/intelligence.mjs";
import { createIntelligenceContextRegistry } from "../system/services/intelligence/context-registry.mjs";
import { listFirstPartyGrantedIntelligenceContextSources } from "../system/services/intelligence/first-party-context-sources.mjs";

function item(id, text) {
  return Object.freeze({
    id,
    scope: "system",
    text,
    provenance: `test:${id}`,
  });
}

test("context registry enables automatic sources but keeps explicit sources opt-in", async () => {
  const automatic = defineIntelligenceContextSource({
    id: "automatic-source",
    title: "Automatic source",
    activation: "automatic",
    collect() {
      return [item("automatic-item", "automatic context")];
    },
  });
  const explicit = defineIntelligenceContextSource({
    id: "explicit-source",
    title: "Explicit source",
    activation: "explicit",
    collect() {
      return [item("explicit-item", "explicit context")];
    },
  });
  const registry = createIntelligenceContextRegistry({ sources: [automatic, explicit] });

  assert.deepEqual(
    registry.listSources().map(({ id, activation }) => ({ id, activation })),
    [
      { id: "automatic-source", activation: "automatic" },
      { id: "explicit-source", activation: "explicit" },
    ],
  );

  const defaultContext = await registry.collect({
    prompt: "please use explicit-source",
    intent: "ask",
  });
  assert.deepEqual(defaultContext.map(({ id }) => id), ["automatic-item"]);

  const authorizedContext = await registry.collect({
    prompt: "same prompt",
    intent: "ask",
    includeExplicitSourceIds: ["explicit-source"],
  });
  assert.deepEqual(
    authorizedContext.map(({ id }) => id),
    ["automatic-item", "explicit-item"],
  );

  await assert.rejects(
    () => registry.collect({ includeExplicitSourceIds: ["unknown-source"] }),
    /Unknown Intelligence context source/,
  );
});

test("first-party app catalog becomes bounded trusted system context automatically", async () => {
  const source = createFirstPartyAppCatalogContextSource();
  assert.equal(source.id, FIRST_PARTY_APP_CATALOG_SOURCE_ID);
  assert.equal(source.activation, "automatic");

  const context = await source.collect({ prompt: "Quais apps existem?", intent: "ask" });
  assert.ok(context.length > 0);
  assert.ok(context.length <= INTELLIGENCE_MAX_CONTEXT_ITEMS);
  const text = context.map((entry) => entry.text).join("\n");
  const total = context.reduce((sum, entry) => sum + entry.text.length, 0);
  assert.ok(total <= INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS);

  for (const entry of context) {
    assert.equal(entry.scope, "system");
    assert.match(entry.provenance, /system\/apps\/catalog\.mjs/);
    assert.ok(entry.text.length <= INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
  }

  for (const app of listFirstPartyApps()) {
    assert.match(text, new RegExp(`id=${app.id}(?:\\s|\\|)`));
    assert.ok(text.includes(`title=${app.title}`));
    assert.ok(text.includes(`version=${app.component.version}`));
    const sources = app.intelligence.contextSourceIds.length > 0
      ? app.intelligence.contextSourceIds.join(",")
      : "none";
    const tools = app.intelligence.toolIds.length > 0
      ? app.intelligence.toolIds.join(",")
      : "none";
    assert.ok(text.includes(`context_sources=${sources}`));
    assert.ok(text.includes(`intelligence_tools=${tools}`));
  }
  assert.match(text, /Declared context sources describe integration points only; they do not authorize collection\./);
});

test("app-declared Intelligence context sources are backed by the canonical explicit-source registry", () => {
  const registered = new Set(
    listFirstPartyGrantedIntelligenceContextSources().map((source) => source.id),
  );
  const declared = [];
  for (const app of listFirstPartyApps()) {
    assert.ok(Object.isFrozen(app.intelligence));
    assert.ok(Object.isFrozen(app.intelligence.contextSourceIds));
    assert.ok(Object.isFrozen(app.intelligence.toolIds));
    for (const sourceId of app.intelligence.contextSourceIds) {
      assert.equal(
        registered.has(sourceId),
        true,
        `${app.id} declares unknown Intelligence context source ${sourceId}`,
      );
      declared.push([app.id, sourceId]);
    }
  }

  assert.deepEqual(declared, [
    ["files", "file-selection"],
    ["projects", "project-selection"],
    ["projects", "project-evidence-selection"],
    ["notes", "note-selection"],
  ]);
});
