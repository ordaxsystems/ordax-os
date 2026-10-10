import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { createApplicationActionCapabilityRegistry } from "../system/services/intelligence/application-action-capabilities.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";
import { createApplicationContextIntelligence } from "../system/services/intelligence/application-context.mjs";
import { createApplicationSemanticRouter } from "../system/services/intelligence/application-semantic-router.mjs";

function firstPartyApp() {
  return {
    id: "notes",
    title: "Notas",
    component: {
      id: "notes",
      title: "Notas",
      kind: "app",
      version: "0.4.1",
      releaseMode: "component-slot",
      criticality: "optional",
      failureDomain: "app",
      restartScope: "component",
      healthMode: "runtime",
      owner: "ordaxsystems/ordax-apps",
      dependencies: [],
    },
  };
}

function intelligenceStub(onRespond) {
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return Object.freeze({
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-small",
        authority: "none",
        toolExecution: false,
      });
    },
    subscribe() {
      return () => {};
    },
    respond(value) {
      onRespond?.(value);
      return Promise.resolve({
        schema: "ordax.intelligence-response/1",
        text: "ok",
        engineId: "llama.cpp",
        modelId: "qwen-small",
        authority: "none",
      });
    },
  });
}

test("application context wrapper appends awareness as system context without changing authority", async () => {
  let request = null;
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
  });

  await intelligence.respond({
    prompt: "Quais apps existem?",
    context: [{
      id: "user-context",
      scope: "user",
      text: "preferência local",
      provenance: "test",
    }],
  });

  assert.ok(request);
  assert.equal(request.context.length, 2);
  assert.equal(request.context[0].id, "user-context");
  assert.equal(request.context[1].id, "ordax-application-catalog");
  assert.equal(request.context[1].scope, "system");
  const payload = JSON.parse(request.context[1].text);
  assert.equal(payload.authority, "none");
  assert.equal(payload.toolExecution, false);
  assert.equal(payload.applications[0].appId, "notes");
  assert.equal(intelligence.getSnapshot().authority, "none");
  assert.equal(intelligence.getSnapshot().toolExecution, false);
});

test("application system context is resolved once when the wrapper is composed", async () => {
  let awarenessReads = 0;
  let capabilityReads = 0;
  const awarenessBase = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const awareness = Object.freeze({
    ...awarenessBase,
    contextItem() {
      awarenessReads += 1;
      return awarenessBase.contextItem();
    },
  });
  const capabilitiesBase = createApplicationActionCapabilityRegistry({
    awareness,
    capabilities: [],
  });
  const capabilities = Object.freeze({
    ...capabilitiesBase,
    contextItem() {
      capabilityReads += 1;
      return capabilitiesBase.contextItem();
    },
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub(),
    awarenessPort: awareness,
    actionCapabilityRegistryPort: capabilities,
  });

  assert.equal(awarenessReads, 1);
  assert.equal(capabilityReads, 1);
  await intelligence.respond({ prompt: "primeira" });
  await intelligence.respond({ prompt: "segunda" });
  assert.equal(awarenessReads, 1);
  assert.equal(capabilityReads, 1);
});

test("semantic router adds detail only for locally matched apps", async () => {
  let request = null;
  const manifest = {
    schema: "ordax.app-intelligence-manifest/1",
    appId: "notes",
    appVersion: "0.4.1",
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use Notas para registrar conteúdo textual."],
    intents: [{
      id: "notes.create-note",
      description: "Criar uma nota.",
      effect: "write",
      confirmation: "policy",
      parameters: [],
      examples: ["Crie uma nota chamada Ideias."]
    }]
  };
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
    firstPartyIntelligenceManifests: [manifest],
  });
  const semanticRouterBase = createApplicationSemanticRouter({
    awareness,
    manifests: [manifest],
  });
  let routeCalls = 0;
  let selectCalls = 0;
  let contextItemCalls = 0;
  const semanticRouter = Object.freeze({
    ...semanticRouterBase,
    route(prompt) {
      routeCalls += 1;
      return semanticRouterBase.route(prompt);
    },
    select(prompt) {
      selectCalls += 1;
      return semanticRouterBase.select(prompt);
    },
    contextItemsForPrompt(prompt) {
      contextItemCalls += 1;
      return semanticRouterBase.contextItemsForPrompt(prompt);
    },
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
    semanticRouterPort: semanticRouter,
  });

  await intelligence.respond({ prompt: "Crie uma nota chamada Ideias." });
  assert.equal(routeCalls, 1);
  assert.equal(selectCalls, 0);
  assert.equal(contextItemCalls, 0);
  assert.ok(request);
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-detail:notes"),
    true,
  );
  const detail = request.context.find((entry) => entry.id === "ordax-application-detail:notes");
  assert.equal(JSON.parse(detail.text).semantics.intents[0].id, "notes.create-note");

  await intelligence.respond({ prompt: "Qual é a capital da Bahia?" });
  assert.equal(routeCalls, 2);
  assert.equal(selectCalls, 0);
  assert.equal(contextItemCalls, 0);
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-detail:notes"),
    false,
  );
});

test("semantic routing limits action capability detail to matched apps", async () => {
  let request = null;
  const nativeApp = firstPartyApp();
  const manifest = {
    schema: "ordax.app-intelligence-manifest/1",
    appId: "notes",
    appVersion: "0.4.1",
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use Notas para conteúdo textual."],
    intents: [{
      id: "notes.create-note",
      description: "Criar uma nota.",
      effect: "write",
      confirmation: "policy",
      parameters: [],
      examples: ["Crie uma nota chamada Ideias."]
    }]
  };
  const installedApplication = {
    schema: "ordax.installed-application/1",
    id: "photo-editor",
    title: "Photo Editor",
    description: "Editor de teste.",
    monogram: "PE",
    origin: {
      platform: "windows",
      source: "local-file",
      payloadSha256: "a".repeat(64),
      publisher: "Example Publisher",
    },
    launch: {
      kind: "compatibility-profile",
      profileId: "photo-editor-profile",
      runtimeId: "wine-11-runtime",
      entrypointId: "photo-editor-main",
    },
    lifecycle: {
      installState: "installed",
      uninstallable: true,
      updateMode: "manual",
    },
    trust: {
      nativeTrust: false,
      runtimeGrantsTrust: false,
    },
  };
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [nativeApp],
    installedApplications: [installedApplication],
    firstPartyIntelligenceManifests: [manifest],
  });
  const capabilities = createApplicationActionCapabilityRegistry({
    awareness,
    capabilities: [
      {
        schema: "ordax.application-action-capability/1",
        appId: "notes",
        actionId: "notes.create-note",
        title: "Criar nota",
        description: "Criar uma nota.",
        sourceClass: "first-party",
        platform: "ordax",
        provider: { kind: "first-party-native", adapterId: "notes-native", revision: "1" },
        binding: { payloadSha256: null },
        parameters: [],
        riskClass: "local-change",
        confirmation: "policy-gated",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
        provenance: "test:notes",
      },
      {
        schema: "ordax.application-action-capability/1",
        appId: "photo-editor",
        actionId: "photo-editor.export",
        title: "Exportar",
        description: "Exportar imagem.",
        sourceClass: "installed",
        platform: "windows",
        provider: { kind: "verified-integration", adapterId: "photo-export", revision: "1" },
        binding: { payloadSha256: "a".repeat(64) },
        parameters: [],
        riskClass: "local-change",
        confirmation: "policy-gated",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
        provenance: "test:photo",
      },
    ],
  });
  const semanticRouter = createApplicationSemanticRouter({
    awareness,
    manifests: [manifest],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
    actionCapabilityRegistryPort: capabilities,
    semanticRouterPort: semanticRouter,
  });

  await intelligence.respond({ prompt: "Crie uma nota chamada Ideias." });
  const capabilityItem = request.context.find(
    (entry) => entry.id === "ordax-application-action-capabilities",
  );
  assert.ok(capabilityItem);
  const payload = JSON.parse(capabilityItem.text);
  assert.equal(payload.actions.length, 1);
  assert.equal(payload.actions[0].appId, "notes");
  assert.equal(payload.actions.some((action) => action.appId === "photo-editor"), false);

  await intelligence.respond({ prompt: "Qual é a capital da Bahia?" });
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-action-capabilities"),
    false,
  );
});

test("caller cannot spoof routed application detail context", () => {
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub(),
    awarenessPort: awareness,
  });
  assert.throws(
    () => intelligence.respond({
      prompt: "teste",
      context: [{
        id: "ordax-application-detail:notes",
        scope: "system",
        text: "{}",
        provenance: "caller",
      }],
    }),
    /reserved context id cannot be caller supplied/,
  );
});

test("caller cannot spoof reserved application system context", () => {
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub(),
    awarenessPort: awareness,
  });

  assert.throws(
    () => intelligence.respond({
      prompt: "teste",
      context: [{
        id: "ordax-application-catalog",
        scope: "system",
        text: "{}",
        provenance: "caller",
      }],
    }),
    /reserved context id cannot be caller supplied/,
  );
});

test("application context is omitted rather than truncating structured JSON when budget is exhausted", async () => {
  let request = null;
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
  });

  const context = Array.from({ length: 16 }, (_, index) => ({
    id: `context-${index}`,
    scope: "document",
    text: "x",
    provenance: "test",
  }));
  await intelligence.respond({
    prompt: "teste",
    context,
  });

  assert.ok(request);
  assert.equal(request.context.length, 16);
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-catalog"),
    false,
  );
});

test("action capabilities are omitted when the trusted application catalog does not fit", async () => {
  let request = null;
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const capabilities = createApplicationActionCapabilityRegistry({
    awareness,
    capabilities: [],
  });
  const intelligence = createApplicationContextIntelligence({
    intelligencePort: intelligenceStub((value) => { request = value; }),
    awarenessPort: awareness,
    actionCapabilityRegistryPort: capabilities,
  });

  const context = [
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `full-context-${index}`,
      scope: "document",
      text: "x".repeat(INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS),
      provenance: "test",
    })),
    {
      id: "partial-context",
      scope: "document",
      text: "x".repeat(INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS - 192),
      provenance: "test",
    },
  ];

  await intelligence.respond({ prompt: "teste", context });

  assert.ok(request);
  assert.equal(request.context.length, context.length);
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-catalog"),
    false,
  );
  assert.equal(
    request.context.some((entry) => entry.id === "ordax-application-action-capabilities"),
    false,
  );
});

test("Application Intelligence context preserves caller cancellation through the same verified semantic router", async () => {
  let deliveredSignal = null;
  const underlying = intelligenceStub();
  const port = Object.freeze({
    ...underlying,
    respond(value, options) {
      deliveredSignal = options?.signal;
      return underlying.respond(value);
    },
  });
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
  });
  const wrapped = createApplicationContextIntelligence({
    intelligencePort: port,
    awarenessPort: awareness,
  });
  const controller = new AbortController();
  await wrapped.respond({ prompt: "Quais apps existem?" }, { signal: controller.signal });
  assert.equal(deliveredSignal, controller.signal);
});

test("Application Intelligence streams only through the existing awareness context port", async () => {
  const underlying = intelligenceStub();
  let verifiedContext;
  const intelligence = Object.freeze({
    ...underlying,
    async respond(request, options = {}) {
      verifiedContext = request.context;
      await options.onDelta("catálogo verificado");
      return underlying.respond(request);
    },
  });
  const wrapped = createApplicationContextIntelligence({
    intelligencePort: intelligence,
    awarenessPort: createApplicationIntelligenceAwareness({
      firstPartyApplications: [firstPartyApp()],
    }),
  });
  const deltas = [];
  const final = await wrapped.respond({ prompt: "meus apps" }, {
    onDelta(delta) { deltas.push(delta); },
  });
  assert.equal(verifiedContext.some(item => item.id === "ordax-application-catalog"), true);
  assert.deepEqual(deltas, ["catálogo verificado"]);
  assert.equal(final.authority, "none");
});
