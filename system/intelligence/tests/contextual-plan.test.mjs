// Keep the architectural roadmap discoverable across future engineer sessions.
// This is a documentation integrity check, not proof of RAG or agent capability.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(
  fileURLToPath(new URL("../" + path, import.meta.url)), "utf8",
);
const planName = "INTELLIGENCE-001-AURA-CONTEXTUAL-INTELLIGENCE.md";

test("Aura contextual Intelligence has one discoverable canonical execution plan", () => {
  const plan = read("docs/plans/" + planName);
  for (const file of [
    "README.md",
    "docs/ARCHITECTURE.md",
  ]) {
    assert.ok(read(file).includes(planName), file + " must link the canonical plan");
  }
  for (let stage = 0; stage <= 5; stage += 1) {
    assert.match(plan, new RegExp("^### Fase " + stage + " \\u2014", "m"));
  }
  for (const authority of [
    "ordax-os", "ordax-apps", "ordax-surface", "ordax-runtime",
    "ordax-platform", "docs/contracts/intelligence-source.json",
    "semantic_search_enabled=false", "embedding_generation_enabled=false",
    "toolExecution=false", "authority=none",
  ]) {
    assert.ok(plan.includes(authority), "roadmap lost a critical boundary: " + authority);
  }
  assert.match(plan, /## 4\. Matriz mínima de regressões/);
  assert.match(plan, /## 5\. Regras de SSOT e não regressão/);
});
