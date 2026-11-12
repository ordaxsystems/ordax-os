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
    "settings",
    "system",
  ]);
  assert.equal(ids.includes("studio"), false);
  assert.equal(ids.includes("assistant"), false, "source not transferred/installed while Gate A is pending");
  assert.equal(ids.includes("activity"), false, "Activity Gate A must remain fail-closed");
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

test("semantic router cannot invent uninstalled Files or Projects products", () => {
  const { router } = runtime();
  assert.equal(router.select("Encontre imagens do catálogo").some(c=>c.appId==="files"), false);
  assert.equal(
    router.select("Abra o projeto Bay of All Saints").some((candidate) => candidate.appId === "projects"),
    false,
  );
});

test("unrelated questions do not inject arbitrary app details", () => {
  const { router } = runtime();
  assert.deepEqual(router.contextItemsForPrompt("Qual é a capital da Bahia?"), []);
});

test("semantic routing withdraws an external slot's stale intent context without affecting bundled OS",()=>{
  const {awareness,manifests}=runtime();
  let current=false;
  const router=createApplicationSemanticRouter({
    awareness,manifests,
    isManifestCurrent:appId=>appId!=="settings"||current,
  });
  const prompt="Abra os Ajustes de rede e configure o Wi-Fi";
  assert.equal(router.select(prompt).some(item=>item.appId==="settings"),false);
  assert.equal(router.contextItemsForPrompt(prompt).some(item=>
    item.id==="ordax-application-detail:settings"),false);
  current=true;
  assert.equal(router.select(prompt).some(item=>item.appId==="settings"),true);
  current=false;
  assert.equal(router.route(prompt).contextItems.some(item=>
    item.id==="ordax-application-detail:settings"),false);
  assert.throws(()=>createApplicationSemanticRouter({
    awareness,manifests,isManifestCurrent:true,
  }),/verifier/);
});
test("Aura routing fails closed on malformed batch CURRENT results", () => {
  const { awareness, manifests } = runtime();
  for (const decisions of [[], [1], ["true"], [null]]) {
    const router = createApplicationSemanticRouter({
      awareness, manifests,
      isManifestCurrent: () => true,
      isManifestCurrentBatch: () => decisions,
    });
    assert.throws(() => router.select("Abra Ajustes de rede"),
      /batch verifier returned invalid decisions/);
  }
  assert.throws(() => createApplicationSemanticRouter({
    awareness, manifests, isManifestCurrentBatch: () => [true],
  }), /batch verifier requires a current-slot verifier/);
});

test("semantic router remains bounded and exposes no execution authority", () => {
  const { router } = runtime();
  assert.ok(router.select("Abra internet arquivos projetos ajustes sistema conta atividade assistente rede").length <= 3);
  for (const method of ["execute", "invoke", "run", "launch", "grant", "authorize"]) {
    assert.equal(router[method], undefined);
  }
});
