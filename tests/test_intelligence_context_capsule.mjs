import assert from "node:assert/strict";
import test from "node:test";

import { defineIntelligenceContextSource } from "../system/contracts/intelligence-context.mjs";
import {
  INTELLIGENCE_CONTEXT_CAPSULE_BUILDER_SCHEMA,
  INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA,
  validateIntelligenceContextCapsule,
} from "../system/contracts/intelligence-context-capsule.mjs";
import { createIntelligenceContextRegistry } from "../system/services/intelligence/context-registry.mjs";
import { createIntelligenceContextCapsuleBuilder } from "../system/services/intelligence/context-capsule.mjs";

function source(id, activation, text) {
  return defineIntelligenceContextSource({
    id,
    title: id,
    activation,
    collect({ intent }) {
      return [{
        id: `${id}-${intent}`,
        scope: "system",
        text,
        provenance: `test:${id}`,
      }];
    },
  });
}

test("context capsule collects automatic context without granting execution authority", async () => {
  const registry = createIntelligenceContextRegistry({
    sources: [
      source("app-catalog", "automatic", "files | projects | intelligence"),
      source("selected-project", "explicit", "private project context"),
    ],
  });
  const builder = createIntelligenceContextCapsuleBuilder(registry);
  assert.equal(builder.schema, INTELLIGENCE_CONTEXT_CAPSULE_BUILDER_SCHEMA);

  const capsule = await builder.build({
    intent: "plan",
    prompt: "Planeje uma melhoria no app Projetos",
    target: { kind: "app", id: "projects" },
  });

  assert.equal(capsule.schema, INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA);
  assert.deepEqual(capsule.target, { kind: "app", id: "projects" });
  assert.deepEqual(capsule.sourceIds, ["app-catalog"]);
  assert.deepEqual(capsule.context.map((item) => item.id), ["app-catalog-plan"]);
  assert.equal(capsule.authority, "none");
  assert.equal(capsule.executable, false);
  assert.equal(capsule.toolExecution, false);
});

test("explicit context participates only when the caller authorizes its source id", async () => {
  const registry = createIntelligenceContextRegistry({
    sources: [
      source("app-catalog", "automatic", "public metadata"),
      source("selected-project", "explicit", "private project context"),
    ],
  });
  const builder = createIntelligenceContextCapsuleBuilder(registry);

  const automaticOnly = await builder.build({
    intent: "ask",
    prompt: "Use selected-project please",
  });
  assert.deepEqual(automaticOnly.sourceIds, ["app-catalog"]);
  assert.equal(automaticOnly.context.some((item) => item.id.startsWith("selected-project")), false);

  const explicit = await builder.build({
    intent: "ask",
    prompt: "Agora use o projeto selecionado",
    includeExplicitSourceIds: ["selected-project"],
  });
  assert.deepEqual(explicit.sourceIds, ["app-catalog", "selected-project"]);
  assert.equal(explicit.context.some((item) => item.id === "selected-project-ask"), true);
});

test("capsule validation rejects authority-shaped or executable data", () => {
  assert.throws(
    () => validateIntelligenceContextCapsule({
      schema: INTELLIGENCE_CONTEXT_CAPSULE_SCHEMA,
      intent: "plan",
      target: { kind: "system", id: "ordax" },
      sourceIds: [],
      context: [],
      authority: "model",
      executable: true,
      toolExecution: true,
    }),
    /data-only and non-executable/,
  );
});
