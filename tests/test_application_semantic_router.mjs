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
    "files",
    "settings",
    "system",
  ]);
  assert.equal(ids.includes("studio"), false);
  assert.equal(ids.includes("assistant"), false, "source not transferred/installed while Gate A is pending");
  for (const manifest of manifests) {
    assert.equal(manifest.authority, "none");
    assert.equal(manifest.execution, "declarative-only");
  }
});

test("semantic router does not invent an Internet app after remove-first Gate A", () => {
  const { router } = runtime();
  const selected = router.select("Abra uma nova aba no YouTube");
  assert.equal(selected.some((candidate) => candidate.appId === "internet"), false);
  const detail = router.contextItemsForPrompt("Abra uma nova aba no YouTube");
  assert.equal(detail.some((item) => item.id === "ordax-application-detail:internet"), false);
});

test("semantic router exposes Wi-Fi settings but cannot invent an uninstalled Network app", () => {
  const { router } = runtime();
  const selected = router.select("Abra os Ajustes de rede e configure o Wi-Fi");
  assert.equal(selected[0].appId, "settings");
  assert.equal(selected.some((entry) => entry.appId === "network"), false);
});

test("semantic router retains Files but cannot invent an absent Projects app", () => {
  const { router } = runtime();
  assert.equal(router.select("Encontre imagens do catálogo")[0].appId, "files");
  assert.equal(
    router.select("Abra o projeto Bay of All Saints").some((candidate) => candidate.appId === "projects"),
    false,
  );
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
