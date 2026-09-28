import assert from "node:assert/strict";
import test from "node:test";

import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import { createIntelligenceChatSession } from "../system/apps/intelligence/session.mjs";
import { createIntelligenceContextRegistry } from "../system/services/intelligence/context-registry.mjs";
import { createIntelligenceContextGrantBroker } from "../system/services/intelligence/context-grants.mjs";
import { createGrantedIntelligenceContextSource } from "../system/services/intelligence/granted-context-source.mjs";
import { createIntelligenceContextShare } from "../system/services/intelligence/context-share.mjs";

function createFakeIntelligence() {
  const requests = [];
  const snapshot = Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "ready",
    inferenceAvailable: true,
    engineId: "llama.cpp",
    modelId: "qwen-test",
    authority: "none",
    toolExecution: false,
  });
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    requests,
    getSnapshot() {
      return snapshot;
    },
    subscribe() {
      return () => {};
    },
    async respond(request) {
      requests.push(request);
      return Object.freeze({
        schema: "ordax.intelligence-response/1",
        text: `eco:${request.prompt}`,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      });
    },
  });
}

function createGrantBroker() {
  let ordinal = 0;
  return createIntelligenceContextGrantBroker({
    now: () => 1_000_000,
    createGrantId: () => `grant-${String(++ordinal).padStart(16, "0")}`,
  });
}

test("context share keeps private payload out of the handoff and releases it once", async () => {
  const grants = createGrantBroker();
  const shares = createIntelligenceContextShare(grants);
  const contextRegistry = createIntelligenceContextRegistry({
    sources: [
      createGrantedIntelligenceContextSource({
        id: "project-selection",
        title: "Projeto selecionado",
        grants,
      }),
    ],
  });
  const intelligence = createFakeIntelligence();
  const session = createIntelligenceChatSession(intelligence, { contextRegistry });

  const offered = shares.offer({
    sourceAppId: "projects",
    sourceId: "project-selection",
    target: { kind: "project", id: "project-7" },
    displayLabel: "Aurora",
    context: [{
      id: "project-selection-project-7",
      scope: "workspace",
      text: "name=Aurora; continuity=local-only",
      provenance: "ordax:projects:user-authorized-selection",
    }],
  });
  assert.equal(offered.displayLabel, "Aurora");
  assert.equal("grantId" in offered, false);
  assert.equal("context" in offered, false);

  assert.equal(
    shares.take({
      sourceAppId: "projects",
      target: { kind: "project", id: "project-other" },
    }),
    null,
  );

  const authorization = shares.take({
    sourceAppId: "projects",
    target: { kind: "project", id: "project-7" },
  });
  assert.ok(authorization);
  assert.equal(authorization.sourceId, "project-selection");
  assert.equal("context" in authorization, false);

  const plan = await session.plan(
    {
      goal: "Defina os próximos passos",
      target: { kind: "project", id: "project-7" },
    },
    { authorizations: [authorization] },
  );
  assert.deepEqual(plan.target, { kind: "project", id: "project-7" });
  assert.deepEqual(intelligence.requests[0].context, [{
    id: "project-selection-project-7",
    scope: "workspace",
    text: "name=Aurora; continuity=local-only",
    provenance: "ordax:projects:user-authorized-selection",
  }]);
  assert.deepEqual(session.getSnapshot().lastContextCapsule.sourceIds, ["project-selection"]);
  assert.equal(session.getSnapshot().lastContextCapsule.authority, "none");
  assert.equal(session.getSnapshot().lastContextCapsule.executable, false);

  await assert.rejects(
    () => session.plan(
      {
        goal: "Tente reutilizar o contexto",
        target: { kind: "project", id: "project-7" },
      },
      { authorizations: [authorization] },
    ),
    /unavailable or already consumed/,
  );

  session.dispose();
  shares.dispose();
  grants.dispose();
});

test("a newer share from the same app replaces the older pending selection", () => {
  const grants = createGrantBroker();
  const shares = createIntelligenceContextShare(grants);

  shares.offer({
    sourceAppId: "projects",
    sourceId: "project-selection",
    target: { kind: "project", id: "project-1" },
    displayLabel: "Primeiro",
    context: [{
      id: "project-selection-project-1",
      scope: "workspace",
      text: "name=Primeiro",
      provenance: "ordax:projects:user-authorized-selection",
    }],
  });
  shares.offer({
    sourceAppId: "projects",
    sourceId: "project-selection",
    target: { kind: "project", id: "project-2" },
    displayLabel: "Segundo",
    context: [{
      id: "project-selection-project-2",
      scope: "workspace",
      text: "name=Segundo",
      provenance: "ordax:projects:user-authorized-selection",
    }],
  });

  assert.equal(
    shares.take({
      sourceAppId: "projects",
      target: { kind: "project", id: "project-1" },
    }),
    null,
  );
  const current = shares.take({
    sourceAppId: "projects",
    target: { kind: "project", id: "project-2" },
  });
  assert.equal(current.displayLabel, "Segundo");

  shares.revoke(current);
  shares.dispose();
  grants.dispose();
});
