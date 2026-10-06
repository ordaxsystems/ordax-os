import assert from "node:assert/strict";
import test from "node:test";

import { createNativeVerifiedApplicationContextIntelligence } from "../system/composition/native/application-intelligence.mjs";

const SHA = "8".repeat(40);

function windowRef(fetchImpl = null) {
  const value = { location: { href: "http://127.0.0.1:43121/" } };
  if (fetchImpl !== null) value.fetch = fetchImpl;
  return value;
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function slotMetadata(appId = "notes", version = "0.4.1") {
  return {
    componentId: appId,
    state: "current",
    source: "slot",
    revision: 7,
    version,
    sourceCommit: SHA,
    entrypoint: `system/apps/${appId}/src/runtime.mjs`,
    pendingHealth: null,
  };
}

function absentMetadata(appId) {
  return {
    componentId: appId,
    state: "current",
    source: "absent",
    revision: 0,
    version: null,
    sourceCommit: null,
    entrypoint: null,
    pendingHealth: null,
  };
}

function appManifest(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function semantics() {
  return {
    schema: "ordax.app-intelligence-manifest/1",
    appId: "notes",
    appVersion: "0.4.1",
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use somente a semântica declarada pelo Notes verificado."],
    intents: [
      {
        id: "notes.create-note",
        description: "Criar uma nota.",
        effect: "write",
        confirmation: "policy",
        parameters: [],
        examples: ["Crie uma nota."],
      },
    ],
  };
}

function verifiedFetch({ manifest = appManifest() } = {}) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/__ordax/native/component-runtime") {
      const appId = parsed.searchParams.get("component");
      return jsonResponse(appId === "notes" ? slotMetadata() : absentMetadata(appId));
    }
    if (parsed.pathname.endsWith("/system/apps/notes/app.json")) {
      return jsonResponse(manifest);
    }
    if (parsed.pathname.endsWith("/system/apps/notes/ai/manifest.json")) {
      return jsonResponse(semantics());
    }
    throw new Error(`Unexpected Native Application Intelligence URL: ${parsed.pathname}`);
  };
}

function intelligenceProbe() {
  let lastRequest = null;
  const port = {
    schema: "ordax.intelligence/1",
    getSnapshot() {
      return {
        schema: "ordax.intelligence/1",
        state: "ready",
        inferenceAvailable: true,
        engineId: "test-engine",
        modelId: "test-model",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe() {
      return () => {};
    },
    async respond(request) {
      lastRequest = request;
      return {
        schema: "ordax.intelligence-response/1",
        text: "ok",
        engineId: "test-engine",
        modelId: "test-model",
        authority: "none",
      };
    },
  };
  return {
    port,
    lastRequest: () => lastRequest,
  };
}

function applicationContext(request) {
  const entry = request.context.find((item) => item.id === "ordax-application-catalog");
  assert.ok(entry);
  assert.equal(entry.scope, "system");
  return JSON.parse(entry.text);
}

test("Native composition overlays verified Notes semantics without granting execution", async () => {
  const probe = intelligenceProbe();
  const intelligence = await createNativeVerifiedApplicationContextIntelligence({
    windowRef: windowRef(),
    intelligencePort: probe.port,
    fetchImpl: verifiedFetch(),
  });

  await intelligence.respond({ prompt: "Crie uma nota de compras." });
  const request = probe.lastRequest();
  const context = applicationContext(request);
  const notes = context.applications.find((app) => app.appId === "notes");

  assert.ok(notes);
  assert.equal(notes.sourceClass, "first-party");
  assert.equal(notes.semantics.instructions[0], "Use somente a semântica declarada pelo Notes verificado.");
  assert.equal(notes.semantics.intents[0].id, "notes.create-note");
  assert.equal(notes.actionExecutionAuthorized, false);
  assert.equal(notes.modelToolExecutionAuthorized, false);
  assert.equal(context.authority, "none");
  assert.equal(context.toolExecution, false);
  assert.equal(
    request.context.some((item) => item.id === "ordax-application-action-capabilities"),
    false,
  );
});

test("invalid external app semantics fail soft per app and cannot replace the base catalog", async () => {
  const probe = intelligenceProbe();
  const errors = [];
  const intelligence = await createNativeVerifiedApplicationContextIntelligence({
    windowRef: windowRef(),
    intelligencePort: probe.port,
    fetchImpl: verifiedFetch({
      manifest: appManifest({ owner: "system/apps/notes" }),
    }),
    onSemanticError(error, context) {
      errors.push({ error, context });
    },
  });

  await intelligence.respond({ prompt: "Liste os aplicativos conhecidos." });
  const context = applicationContext(probe.lastRequest());

  assert.equal(errors.length, 1);
  assert.equal(errors[0].context.appId, "notes");
  assert.match(errors[0].error.message, /identity drifted/);
  assert.equal(context.applications.some((app) => app.appId === "notes"), false);
  assert.equal(context.applications.some((app) => app.appId === "files"), true);
});

test("missing Native fetch keeps bounded base awareness and does not invent external semantics", async () => {
  const probe = intelligenceProbe();
  const intelligence = await createNativeVerifiedApplicationContextIntelligence({
    windowRef: windowRef(),
    intelligencePort: probe.port,
  });

  await intelligence.respond({ prompt: "Quais apps existem?" });
  const request = probe.lastRequest();
  const context = applicationContext(request);

  assert.equal(context.applications.some((app) => app.appId === "files"), true);
  assert.equal(context.applications.some((app) => app.appId === "notes"), false);
  assert.equal(
    request.context.some((item) => item.id === "ordax-application-action-capabilities"),
    false,
  );
});
