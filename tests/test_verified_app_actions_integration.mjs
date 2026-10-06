import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { createApplicationActionCapabilityRegistry } from "../system/services/intelligence/application-action-capabilities.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";
import { createApplicationContextIntelligence } from "../system/services/intelligence/application-context.mjs";
import { overlayVerifiedFirstPartyApplications } from "../system/services/intelligence/verified-app-semantics.mjs";

const SHA = "9".repeat(40);

function verifiedNotes() {
  const component = {
    schema: "ordax.component-manifest/1",
    id: "notes",
    title: "Notas",
    kind: "app",
    version: "0.4.2",
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner: "washingtonmsdj/ordax-apps",
    dependencies: [],
  };
  const intelligenceManifest = {
    schema: "ordax.app-intelligence-manifest/1",
    appId: "notes",
    appVersion: "0.4.2",
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use somente capabilities verificadas."],
    intents: [{
      id: "notes.create-note",
      description: "Criar uma nota.",
      effect: "write",
      confirmation: "policy",
      parameters: [{
        name: "title",
        type: "string",
        required: false,
        description: "Título da nota.",
      }],
      examples: ["Crie uma nota."],
    }],
  };
  const actionManifest = {
    schema: "ordax.application-action-manifest/1",
    appId: "notes",
    appVersion: "0.4.2",
    authority: "none",
    execution: "proposal-only",
    capabilities: [{
      schema: "ordax.application-action-capability/1",
      appId: "notes",
      actionId: "notes.create-note",
      title: "Criar nota",
      description: "Criar uma nota.",
      sourceClass: "first-party",
      platform: "ordax",
      provider: {
        kind: "first-party-native",
        adapterId: "notes-native",
        revision: "1",
      },
      binding: { payloadSha256: null },
      parameters: [{
        id: "title",
        type: "string",
        required: false,
        maxLength: 240,
      }],
      riskClass: "local-change",
      confirmation: "policy-gated",
      executionAuthorized: false,
      modelDirectExecutionAuthorized: false,
      provenance: "ordax-apps:apps/notes/actions/manifest.json",
    }],
  };
  return {
    application: {
      id: "notes",
      title: "Notas",
      component,
    },
    intelligenceManifest,
    actionManifest,
    sourceCommit: SHA,
    revision: 12,
  };
}

function baseIntelligence() {
  let lastRequest = null;
  const snapshot = {
    schema: "ordax.intelligence/1",
    state: "ready",
    inferenceAvailable: true,
    engineId: "local",
    modelId: "test",
    authority: "none",
    toolExecution: false,
  };
  return {
    port: {
      schema: "ordax.intelligence/1",
      getSnapshot() { return snapshot; },
      subscribe() { return () => {}; },
      async respond(value) {
        lastRequest = value;
        return {
          schema: "ordax.intelligence-response/1",
          text: "ok",
          engineId: "local",
          modelId: "test",
          authority: "none",
        };
      },
    },
    lastRequest() { return lastRequest; },
  };
}

test("verified first-party Actions reach Intelligence as proposal-only context", async () => {
  const verified = verifiedNotes();
  const applications = overlayVerifiedFirstPartyApplications(
    listFirstPartyApps(),
    [verified],
  );
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: applications,
    firstPartyIntelligenceManifests: [verified.intelligenceManifest],
  });
  const registry = createApplicationActionCapabilityRegistry({
    awareness,
    capabilities: verified.actionManifest.capabilities,
  });
  const base = baseIntelligence();
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: base.port,
    awarenessPort: awareness,
    actionCapabilityRegistryPort: registry,
  });

  await intelligence.respond({
    intent: "ask",
    prompt: "Crie uma nota chamada Ideias",
    context: [],
  });

  const request = base.lastRequest();
  const awarenessContext = request.context.find(
    (item) => item.id === "ordax-application-catalog",
  );
  const actionContext = request.context.find(
    (item) => item.id === "ordax-application-action-capabilities",
  );
  assert.ok(awarenessContext);
  assert.ok(actionContext);

  const payload = JSON.parse(actionContext.text);
  assert.equal(payload.authority, "none");
  assert.equal(payload.toolExecution, false);
  assert.equal(payload.actions.length, 1);
  assert.equal(payload.actions[0].appId, "notes");
  assert.equal(payload.actions[0].actionId, "notes.create-note");
  assert.equal(payload.actions[0].executionAuthorized, false);
  assert.equal(payload.actions[0].modelDirectExecutionAuthorized, false);

  const proposal = registry.propose("notes", "notes.create-note", { title: "Ideias" });
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.modelDirectExecutionAuthorized, false);
  assert.equal(typeof registry.execute, "undefined");
  assert.equal(typeof registry.run, "undefined");
  assert.equal(typeof registry.invoke, "undefined");
  assert.equal(typeof intelligence.execute, "undefined");
});

test("no verified action capabilities means no action context is injected", async () => {
  const verified = verifiedNotes();
  const applications = overlayVerifiedFirstPartyApplications(
    listFirstPartyApps(),
    [verified],
  );
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: applications,
    firstPartyIntelligenceManifests: [verified.intelligenceManifest],
  });
  const base = baseIntelligence();
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: base.port,
    awarenessPort: awareness,
    actionCapabilityRegistryPort: null,
  });

  await intelligence.respond({ prompt: "teste", context: [] });
  assert.equal(
    base.lastRequest().context.some(
      (item) => item.id === "ordax-application-action-capabilities",
    ),
    false,
  );
});
