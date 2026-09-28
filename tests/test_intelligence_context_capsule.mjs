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
import { createIntelligenceContextGrantBroker } from "../system/services/intelligence/context-grants.mjs";
import { createGrantedIntelligenceContextSource } from "../system/services/intelligence/granted-context-source.mjs";

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

function grantBroker() {
  let ordinal = 0;
  return createIntelligenceContextGrantBroker({
    now: () => 1_000_000,
    createGrantId: () => `grant-${String(++ordinal).padStart(16, "0")}`,
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

test("grant-backed explicit source requires a valid one-shot authorization", async () => {
  const grants = grantBroker();
  const registry = createIntelligenceContextRegistry({
    sources: [
      source("app-catalog", "automatic", "public metadata"),
      createGrantedIntelligenceContextSource({
        id: "selected-project",
        title: "Selected project",
        grants,
      }),
    ],
  });
  const builder = createIntelligenceContextCapsuleBuilder(registry);
  const grant = grants.issue({
    sourceId: "selected-project",
    target: { kind: "project", id: "project-9" },
    context: [{
      id: "selected-project-project-9",
      scope: "workspace",
      text: "name=Aurora; continuity=local-only",
      provenance: "test:selected-project",
    }],
  });

  await assert.rejects(
    () => builder.build({
      intent: "plan",
      prompt: "Planeje",
      target: { kind: "project", id: "project-9" },
      includeExplicitSourceIds: ["selected-project"],
    }),
    /requires an explicit grant/,
  );

  const capsule = await builder.build({
    intent: "plan",
    prompt: "Planeje",
    target: { kind: "project", id: "project-9" },
    includeExplicitSourceIds: ["selected-project"],
    authorization: {
      grantId: grant.id,
      sourceId: "selected-project",
      target: { kind: "project", id: "project-9" },
    },
  });
  assert.deepEqual(capsule.sourceIds, ["app-catalog", "selected-project"]);
  assert.equal(capsule.context.at(-1).text, "name=Aurora; continuity=local-only");
  await assert.rejects(
    () => builder.build({
      intent: "plan",
      prompt: "Replay",
      target: { kind: "project", id: "project-9" },
      includeExplicitSourceIds: ["selected-project"],
      authorization: {
        grantId: grant.id,
        sourceId: "selected-project",
        target: { kind: "project", id: "project-9" },
      },
    }),
    /unavailable or already consumed/,
  );
  grants.dispose();
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
