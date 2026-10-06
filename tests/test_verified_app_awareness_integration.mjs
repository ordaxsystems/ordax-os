import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";
import { createApplicationAwareIntelligence } from "../system/services/intelligence/application-context.mjs";
import {
  overlayVerifiedFirstPartyApplications,
} from "../system/services/intelligence/verified-app-semantics.mjs";

function notesEntry() {
  return {
    application: {
      id: "notes",
      title: "Notas",
      component: {
        schema: "ordax.component-manifest/1",
        id: "notes",
        title: "Notas",
        kind: "app",
        version: "0.4.1",
        releaseMode: "component-slot",
        criticality: "optional",
        failureDomain: "app",
        restartScope: "component",
        healthMode: "runtime",
        owner: "washingtonmsdj/ordax-apps",
        dependencies: [],
      },
    },
    intelligenceManifest: {
      schema: "ordax.app-intelligence-manifest/1",
      appId: "notes",
      appVersion: "0.4.1",
      authority: "none",
      execution: "declarative-only",
      instructions: ["Use somente capacidades declaradas."],
      intents: [{
        id: "notes.create-note",
        description: "Criar uma nova nota.",
        effect: "write",
        confirmation: "policy",
        parameters: [{
          name: "title",
          type: "string",
          required: false,
          description: "Título da nota.",
        }],
        examples: ["Crie uma nota chamada Ideias."],
      }],
    },
    sourceCommit: "a".repeat(40),
    revision: 9,
  };
}

function baseIntelligence() {
  let request = null;
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
        request = value;
        return {
          schema: "ordax.intelligence-response/1",
          text: "ok",
          engineId: "local",
          modelId: "test",
          authority: "none",
        };
      },
    },
    request() { return request; },
  };
}

test("verified external app semantics reach user Intelligence as authority-free context", async () => {
  const verified = notesEntry();
  const applications = overlayVerifiedFirstPartyApplications(
    listFirstPartyApps(),
    [verified],
  );
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: applications,
    installedApplications: [],
    firstPartyIntelligenceManifests: [verified.intelligenceManifest],
  });
  const base = baseIntelligence();
  const intelligence = createApplicationAwareIntelligence({
    intelligencePort: base.port,
    applicationAwarenessPort: awareness,
  });

  await intelligence.respond({
    intent: "ask",
    prompt: "Crie uma nota chamada Ideias",
    context: [],
  });

  const context = base.request().context.find(
    (item) => item.id === "ordax-application-catalog",
  );
  assert.ok(context);
  const payload = JSON.parse(context.text);
  const notes = payload.applications.find((app) => app.appId === "notes");
  assert.ok(notes);
  assert.equal(notes.title, "Notas");
  assert.equal(notes.actionExecutionAuthorized, false);
  assert.equal(notes.modelToolExecutionAuthorized, false);
  assert.equal(notes.semantics.intents[0].id, "notes.create-note");
  assert.equal(payload.authority, "none");
  assert.equal(payload.toolExecution, false);
  assert.equal(intelligence.getSnapshot().toolExecution, false);
});

test("absence of verified external semantics leaves Notes out without inventing it", () => {
  const applications = overlayVerifiedFirstPartyApplications(
    listFirstPartyApps(),
    [],
  );
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: applications,
    installedApplications: [],
    firstPartyIntelligenceManifests: [],
  });

  assert.equal(awareness.get("notes"), null);
  const payload = JSON.parse(awareness.contextItem().text);
  assert.equal(payload.applications.some((app) => app.appId === "notes"), false);
});
