import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { listBundledFirstPartyIntelligenceManifests } from "../system/apps/intelligence-catalog.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";
import { createApplicationSemanticRouter } from "../system/services/intelligence/application-semantic-router.mjs";

function runtime() {
  const apps = listFirstPartyApps();
  const manifests = listBundledFirstPartyIntelligenceManifests();
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: apps,
    firstPartyIntelligenceManifests: manifests,
  });
  const router = createApplicationSemanticRouter({ awareness, manifests });
  return { apps, manifests, awareness, router };
}

test("bundled first-party semantics cover internal apps without duplicating external Studio ownership", () => {
  const { manifests } = runtime();
  const ids = manifests.map((manifest) => manifest.appId).sort();
  assert.deepEqual(ids, [
    "account",
    "activity",
    "assistant",
    "files",
    "internet",
    "network",
    "projects",
    "settings",
    "system",
  ]);
  assert.equal(ids.includes("studio"), false);
  for (const manifest of manifests) {
    assert.equal(manifest.authority, "none");
    assert.equal(manifest.execution, "declarative-only");
  }
});

test("semantic router resolves YouTube/new-tab phrasing to OrdaX Internet without model inference", () => {
  const { router } = runtime();
  const selected = router.select("Abra uma nova aba no YouTube");
  assert.equal(selected[0].appId, "internet");
  const detail = router.contextItemsForPrompt("Abra uma nova aba no YouTube");
  assert.equal(detail[0].id, "ordax-application-detail:internet");
  const payload = JSON.parse(detail[0].text);
  assert.equal(payload.application.appId, "internet");
  assert.equal(
    payload.semantics.intents.some((intent) => intent.id === "internet.navigate"),
    true,
  );
  assert.equal(payload.authority, "none");
  assert.equal(payload.toolExecution, false);
});

test("semantic router distinguishes settings network configuration from professional Network app", () => {
  const { router } = runtime();
  const selected = router.select("Abra os Ajustes de rede e configure o Wi-Fi");
  assert.equal(selected[0].appId, "settings");
  assert.equal(selected.some((entry) => entry.appId === "network"), true);
});

test("semantic router recognizes file and project workflows from local examples", () => {
  const { router } = runtime();
  assert.equal(router.select("Encontre imagens do catálogo")[0].appId, "files");
  assert.equal(router.select("Abra o projeto Bay of All Saints")[0].appId, "projects");
});

test("unrelated questions do not inject arbitrary app details", () => {
  const { router } = runtime();
  assert.deepEqual(router.contextItemsForPrompt("Qual é a capital da Bahia?"), []);
});

test("semantic router remains bounded and exposes no execution authority", () => {
  const { router } = runtime();
  assert.ok(router.select("Abra internet arquivos projetos ajustes sistema conta atividade assistente rede").length <= 3);
  for (const method of ["execute", "invoke", "run", "launch", "grant", "authorize"]) {
    assert.equal(router[method], undefined);
  }
});
