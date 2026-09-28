import assert from "node:assert/strict";
import test from "node:test";

import { createIntelligenceContextRegistry } from "../system/services/intelligence/context-registry.mjs";
import { createIntelligenceContextCapsuleBuilder } from "../system/services/intelligence/context-capsule.mjs";
import { createIntelligenceContextGrantBroker } from "../system/services/intelligence/context-grants.mjs";
import { createGrantedIntelligenceContextSource } from "../system/services/intelligence/granted-context-source.mjs";

function broker() {
  let ordinal = 0;
  return createIntelligenceContextGrantBroker({
    now: () => 2_000_000,
    createGrantId: () => `grant-${String(++ordinal).padStart(16, "0")}`,
  });
}

function authorization(grant) {
  return {
    grantId: grant.id,
    sourceId: grant.sourceId,
    target: grant.target,
  };
}

test("context capsule routes independent one-shot grants to multiple app-owned sources", async () => {
  const grants = broker();
  const target = { kind: "project", id: "project-aurora" };
  const registry = createIntelligenceContextRegistry({
    sources: [
      createGrantedIntelligenceContextSource({
        id: "project-context",
        title: "Project context",
        grants,
      }),
      createGrantedIntelligenceContextSource({
        id: "notes-context",
        title: "Selected notes",
        grants,
      }),
    ],
  });
  const builder = createIntelligenceContextCapsuleBuilder(registry);
  const projectGrant = grants.issue({
    sourceId: "project-context",
    target,
    context: [{
      id: "project-aurora-summary",
      scope: "workspace",
      text: "project=Aurora; status=active",
      provenance: "test:project-context",
    }],
  });
  const notesGrant = grants.issue({
    sourceId: "notes-context",
    target,
    context: [{
      id: "project-aurora-note-1",
      scope: "document",
      text: "selected note excerpt",
      provenance: "test:notes-context",
    }],
  });

  const capsule = await builder.build({
    intent: "plan",
    prompt: "Prepare os próximos passos do projeto.",
    target,
    includeExplicitSourceIds: ["project-context", "notes-context"],
    authorizations: [authorization(projectGrant), authorization(notesGrant)],
  });

  assert.deepEqual(capsule.sourceIds, ["project-context", "notes-context"]);
  assert.deepEqual(
    capsule.context.map((item) => item.id),
    ["project-aurora-summary", "project-aurora-note-1"],
  );
  assert.equal(capsule.authority, "none");
  assert.equal(capsule.executable, false);
  assert.equal(capsule.toolExecution, false);

  await assert.rejects(
    () => builder.build({
      intent: "plan",
      prompt: "Tente reutilizar os mesmos grants.",
      target,
      includeExplicitSourceIds: ["project-context", "notes-context"],
      authorizations: [authorization(projectGrant), authorization(notesGrant)],
    }),
    /unavailable or already consumed/,
  );
  grants.dispose();
});

test("registry rejects unknown or duplicate per-source authorizations before collection", async () => {
  const grants = broker();
  const target = { kind: "project", id: "project-aurora" };
  const registry = createIntelligenceContextRegistry({
    sources: [
      createGrantedIntelligenceContextSource({
        id: "project-context",
        title: "Project context",
        grants,
      }),
    ],
  });
  const grant = grants.issue({
    sourceId: "project-context",
    target,
    context: [{
      id: "project-aurora-summary",
      scope: "workspace",
      text: "project=Aurora",
      provenance: "test:project-context",
    }],
  });
  const valid = authorization(grant);

  await assert.rejects(
    () => registry.collect({
      includeExplicitSourceIds: ["project-context"],
      authorizations: [{ ...valid, sourceId: "unknown-context" }],
    }),
    /Unknown Intelligence context authorization source/,
  );
  await assert.rejects(
    () => registry.collect({
      includeExplicitSourceIds: ["project-context"],
      authorizations: [valid, valid],
    }),
    /Duplicate Intelligence context authorization/,
  );

  // Validation failures above must not consume the valid one-shot grant.
  const context = await registry.collect({
    includeExplicitSourceIds: ["project-context"],
    authorizations: [valid],
  });
  assert.equal(context[0].text, "project=Aurora");
  grants.dispose();
});
