import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceSnapshot,
} from "../system/contracts/intelligence.mjs";
import { assertSpaceSelectionPort } from "../system/contracts/space-selection.mjs";
import { createUnavailableWebIntelligencePort } from "../system/adapters/web/intelligence.mjs";
import {
  WEB_INTELLIGENCE_REMOTE_REQUEST_SCHEMA,
  WEB_INTELLIGENCE_REMOTE_RESPONSE_SCHEMA,
  WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
  createRemoteWebIntelligencePort,
} from "../system/adapters/web/intelligence-remote.mjs";
import { createUnavailableWebSpaceSelection } from "../system/adapters/web/space-selection.mjs";
import { createIntelligenceClient } from "../system/surface/workspace/lib/intelligence/client.mjs";

const readyIntelligenceSnapshot = () => ({
  schema: INTELLIGENCE_PORT_SCHEMA,
  state: "ready",
  inferenceAvailable: true,
  engineId: "engine-test",
  modelId: "model-test",
  authority: "none",
  toolExecution: false,
});

const remoteContext = (overrides = {}) => ({
  subjectId: "subject-1",
  targetDeviceId: "device-1",
  spaceId: "space-1",
  projectId: "project-1",
  ...overrides,
});

const remoteResponse = (context, overrides = {}) => ({
  schema: WEB_INTELLIGENCE_REMOTE_RESPONSE_SCHEMA,
  context,
  response: {
    schema: INTELLIGENCE_RESPONSE_SCHEMA,
    text: "Resposta remota verificada",
    engineId: "engine-test",
    modelId: "model-test",
    authority: "none",
    ...overrides,
  },
});

test("Web Assistant uses canonical, explicitly unavailable Space port without a second selector", () => {
  const port = createUnavailableWebSpaceSelection();
  assert.equal(assertSpaceSelectionPort(port), port);
  assert.equal(port.getSnapshot().state, "unavailable");
  assert.equal(port.getSnapshot().subjectId, null);
  assert.equal(port.getSnapshot().selectedSpace, null);
  assert.throws(() => port.select("space-1"), /not available/);
  assert.equal(port.clear().state, "unavailable");
  const seen = [];
  const unsubscribe = port.subscribe((value) => seen.push(value.state));
  unsubscribe();
  assert.deepEqual(seen, ["unavailable"]);
});

test("Web Intelligence fallback is a canonical fail-closed port", async () => {
  const port = createUnavailableWebIntelligencePort();
  assert.doesNotThrow(() => assertIntelligencePort(port));
  const snapshot = validateIntelligenceSnapshot(port.getSnapshot());
  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.inferenceAvailable, false);
  assert.equal(snapshot.authority, "none");
  assert.equal(snapshot.toolExecution, false);
  const seen = [];
  const release = port.subscribe(value => seen.push(value.state));
  release();
  assert.deepEqual(seen, ["degraded"]);
  await assert.rejects(port.respond({ intent: "ask", prompt: "teste", context: [] }), /transport is unavailable/);
});

test("Web Intelligence client keeps snapshot identity stable until semantic state changes", () => {
  let raw = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
    authority: "none",
    toolExecution: false,
  };
  let emit = () => {};
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({ ...raw }),
    subscribe(listener) { emit = listener; listener({ ...raw }); return () => {}; },
    async respond() { throw new Error("not ready"); },
  };
  const client = createIntelligenceClient(port);
  const first = client.getSnapshot();
  let notifications = 0;
  client.subscribe(() => { notifications += 1; });
  assert.equal(client.getSnapshot(), first, "Immediate equivalent source notification must retain object identity");
  assert.equal(notifications, 0, "Equivalent source state must not notify React consumers");

  raw = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "ready",
    inferenceAvailable: true,
    engineId: "engine-test",
    modelId: "model-test",
    authority: "none",
    toolExecution: false,
  };
  emit({ ...raw });
  assert.equal(notifications, 1);
  assert.notEqual(client.getSnapshot(), first);
  assert.equal(client.getSnapshot().state, "ready");

  const readySnapshot = client.getSnapshot();
  emit({ ...raw });
  assert.equal(notifications, 1, "Repeated equivalent ready state must not notify again");
  assert.equal(client.getSnapshot(), readySnapshot);
});

test("Web Intelligence client consumes only the canonical port and sanitizes the response", async () => {
  let received = null;
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe(listener) { listener(this.getSnapshot()); return () => {}; },
    async respond(request) {
      received = request;
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "Resposta verificada",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "none",
        ignoredProviderField: "must-not-become-surface-authority",
      };
    },
  };
  const client = createIntelligenceClient(port);
  const response = await client.ask("Explique o estado atual");
  assert.equal(received.intent, "ask");
  assert.equal(received.prompt, "Explique o estado atual");
  assert.deepEqual(received.context, []);
  assert.deepEqual(response, {
    schema: INTELLIGENCE_RESPONSE_SCHEMA,
    text: "Resposta verificada",
    engineId: "engine-test",
    modelId: "model-test",
    authority: "none",
  });
});

test("Web Intelligence client rejects malformed or authority-bearing responses", async () => {
  const ready = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe: () => () => {},
  };
  const authority = createIntelligenceClient({ ...ready, respond: async () => ({ schema: INTELLIGENCE_RESPONSE_SCHEMA, text: "x", engineId: "engine-test", modelId: "model-test", authority: "execute" }) });
  await assert.rejects(authority.ask("teste"), /authority is invalid/);
  const malformed = createIntelligenceClient({ ...ready, respond: async () => ({ schema: INTELLIGENCE_RESPONSE_SCHEMA, text: "", engineId: "engine-test", modelId: "model-test", authority: "none" }) });
  await assert.rejects(malformed.ask("teste"), /response text/);
});

test("Web Intelligence client drops results from ports that ignore cancellation", async () => {
  let finish;
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe: () => () => {},
    respond: () => new Promise(resolve => { finish = resolve; }),
  };
  const client = createIntelligenceClient(port);
  const controller = new AbortController();
  const pending = client.ask("Teste de cancelamento", { signal: controller.signal });
  controller.abort(new Error("client-request-cancelled"));
  finish(remoteResponse(remoteContext()).response);
  // The canonical Surface abort helper normalizes cancellation to AbortError;
  // the late provider value must still be discarded, not rendered as success.
  await assert.rejects(pending, (error) =>
    error?.name === "AbortError" && error?.message === "Aura request was cancelled");
});

test("Remote Web Intelligence rejects late responses after cancellation or disposal", async () => {
  const context = remoteContext();
  let finish;
  let emit;
  const transport = {
    schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe(listener) { emit = listener; return () => {}; },
    respond: () => new Promise(resolve => { finish = resolve; }),
  };
  const port = createRemoteWebIntelligencePort({ transport, readContext: () => context });
  const controller = new AbortController();
  const cancelled = port.respond({ prompt: "Cancelada" }, { signal: controller.signal });
  controller.abort(new Error("remote-request-cancelled"));
  finish(remoteResponse(context));
  await assert.rejects(cancelled, /remote-request-cancelled/);

  const beforeDispose = port.getSnapshot();
  const disposedRequest = port.respond({ prompt: "Descartada" });
  port.dispose();
  emit({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
    authority: "none",
    toolExecution: false,
  });
  assert.equal(port.getSnapshot(), beforeDispose, "A disposed adapter must ignore late transport events");
  finish(remoteResponse(context));
  await assert.rejects(disposedRequest, /adapter is disposed/);
});

test("Remote Web Intelligence dispatches once with explicit target context and forwards cancellation", async () => {
  const calls = [];
  const context = remoteContext();
  const transport = {
    schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe(listener) { listener(readyIntelligenceSnapshot()); return () => {}; },
    async respond(envelope, options) {
      calls.push({ envelope, options });
      return remoteResponse(envelope.context, { ignoredProviderField: "drop-me" });
    },
  };
  const port = createRemoteWebIntelligencePort({ transport, readContext: () => context });
  assert.equal(assertIntelligencePort(port), port);
  const controller = new AbortController();
  const response = await port.respond({ intent: "ask", prompt: "Estado?", context: [] }, { signal: controller.signal });
  assert.equal(calls.length, 1, "Remote adapter must never replay a dispatch");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].envelope.schema, WEB_INTELLIGENCE_REMOTE_REQUEST_SCHEMA);
  assert.deepEqual(calls[0].envelope.context, context);
  assert.equal(calls[0].envelope.request.prompt, "Estado?");
  assert.deepEqual(response, {
    schema: INTELLIGENCE_RESPONSE_SCHEMA,
    text: "Resposta remota verificada",
    engineId: "engine-test",
    modelId: "model-test",
    authority: "none",
  });
  port.dispose();
});

test("Remote Web Intelligence keeps context hierarchy separate from transport grant scope", async () => {
  let rejectedCalls = 0;
  const rejectingTransport = {
    schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe: () => () => {},
    async respond() { rejectedCalls += 1; throw new Error("must not dispatch"); },
  };
  const missingTarget = createRemoteWebIntelligencePort({
    transport: rejectingTransport,
    readContext: () => ({ subjectId: "subject-1", spaceId: null, projectId: null }),
  });
  await assert.rejects(missingTarget.respond({ prompt: "x" }), /targetDeviceId/);

  const inferredScope = createRemoteWebIntelligencePort({
    transport: rejectingTransport,
    readContext: () => ({ subjectId: "subject-1", targetDeviceId: "device-1" }),
  });
  await assert.rejects(inferredScope.respond({ prompt: "x" }), /state Space and project explicitly/);

  const projectWithoutSpace = createRemoteWebIntelligencePort({
    transport: rejectingTransport,
    readContext: () => remoteContext({ spaceId: null }),
  });
  await assert.rejects(projectWithoutSpace.respond({ prompt: "x" }), /project context requires an explicit Space/);
  assert.equal(rejectedCalls, 0);

  const acceptedContexts = [];
  const acceptingTransport = {
    schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
    getSnapshot: () => readyIntelligenceSnapshot(),
    subscribe: () => () => {},
    async respond(envelope) {
      acceptedContexts.push(envelope.context);
      return remoteResponse(envelope.context);
    },
  };
  for (const context of [
    remoteContext({ spaceId: null, projectId: null }),
    remoteContext({ projectId: null }),
    remoteContext(),
  ]) {
    const port = createRemoteWebIntelligencePort({
      transport: acceptingTransport,
      readContext: () => context,
    });
    await port.respond({ prompt: "x" });
    port.dispose();
  }
  assert.deepEqual(acceptedContexts, [
    remoteContext({ spaceId: null, projectId: null }),
    remoteContext({ projectId: null }),
    remoteContext(),
  ]);
});

test("Remote Web Intelligence rejects mismatched and stale result context", async () => {
  const expected = remoteContext();
  const mismatched = createRemoteWebIntelligencePort({
    transport: {
      schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
      getSnapshot: () => readyIntelligenceSnapshot(),
      subscribe: () => () => {},
      async respond(envelope) {
        return remoteResponse({ ...envelope.context, targetDeviceId: "device-2" });
      },
    },
    readContext: () => expected,
  });
  await assert.rejects(mismatched.respond({ prompt: "x" }), /does not match the request/);

  let currentContext = expected;
  const stale = createRemoteWebIntelligencePort({
    transport: {
      schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
      getSnapshot: () => readyIntelligenceSnapshot(),
      subscribe: () => () => {},
      async respond(envelope) {
        currentContext = remoteContext({ spaceId: "space-2", projectId: "project-2" });
        return remoteResponse(envelope.context);
      },
    },
    readContext: () => currentContext,
  });
  await assert.rejects(stale.respond({ prompt: "x" }), /context changed while the request was pending/);
});

test("Remote Web Intelligence fails closed before dispatch when unavailable, busy or already aborted", async () => {
  let calls = 0;
  const makeTransport = (snapshot) => ({
    schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async respond() { calls += 1; throw new Error("must not dispatch"); },
  });
  const unavailable = createRemoteWebIntelligencePort({
    transport: makeTransport({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "degraded",
      inferenceAvailable: false,
      engineId: null,
      modelId: null,
      authority: "none",
      toolExecution: false,
    }),
    readContext: () => remoteContext(),
  });
  await assert.rejects(unavailable.respond({ prompt: "x" }), /transport is unavailable/);

  const busy = createRemoteWebIntelligencePort({
    transport: makeTransport({ ...readyIntelligenceSnapshot(), state: "busy" }),
    readContext: () => remoteContext(),
  });
  await assert.rejects(busy.respond({ prompt: "x" }), /transport is unavailable/);

  const aborted = createRemoteWebIntelligencePort({
    transport: makeTransport(readyIntelligenceSnapshot()),
    readContext: () => remoteContext(),
  });
  const controller = new AbortController();
  controller.abort(new Error("cancelled-before-send"));
  await assert.rejects(aborted.respond({ prompt: "x" }, { signal: controller.signal }), /cancelled-before-send/);
  assert.equal(calls, 0);
});

test("Remote Web Intelligence rejects authority-bearing responses", async () => {
  const authority = createRemoteWebIntelligencePort({
    transport: {
      schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
      getSnapshot: () => readyIntelligenceSnapshot(),
      subscribe: () => () => {},
      async respond(envelope) { return remoteResponse(envelope.context, { authority: "execute" }); },
    },
    readContext: () => remoteContext(),
  });
  await assert.rejects(authority.respond({ prompt: "x" }), /authority is invalid/);
});

test("Remote Web Intelligence keeps repeated transport snapshots stable", () => {
  let emit = () => {};
  let raw = readyIntelligenceSnapshot();
  const transport = {
    schema: WEB_INTELLIGENCE_REMOTE_TRANSPORT_SCHEMA,
    getSnapshot: () => ({ ...raw }),
    subscribe(listener) { emit = listener; listener({ ...raw }); return () => {}; },
    async respond() { throw new Error("not used"); },
  };
  const port = createRemoteWebIntelligencePort({ transport, readContext: () => remoteContext() });
  const first = port.getSnapshot();
  const seen = [];
  port.subscribe(snapshot => seen.push(snapshot.state));
  emit({ ...raw });
  assert.equal(port.getSnapshot(), first);
  assert.deepEqual(seen, ["ready"]);
  raw = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "degraded",
    inferenceAvailable: false,
    engineId: null,
    modelId: null,
    authority: "none",
    toolExecution: false,
  };
  emit({ ...raw });
  assert.deepEqual(seen, ["ready", "degraded"]);
});

test("Canonical Web injects Intelligence without owning provider transport or credentials", async () => {
  const source = await readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../system/adapters/web/intelligence.mjs", import.meta.url), "utf8");
  const remoteAdapter = await readFile(new URL("../system/adapters/web/intelligence-remote.mjs", import.meta.url), "utf8");
  const windowContent = await readFile(new URL("../system/surface/workspace/components/central/window-content.tsx", import.meta.url), "utf8");
  const aura = await readFile(new URL("../system/surface/workspace/components/intelligence/aura-content.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../system/surface/workspace/lib/intelligence/client.mjs", import.meta.url), "utf8");
  const desktop = await readFile(new URL("../system/surface/workspace/components/central/desktop.tsx", import.meta.url), "utf8");
  assert.match(source, /createUnavailableWebIntelligencePort/);
  assert.doesNotMatch(source, /intelligence-remote/);
  assert.match(source, /<IntelligenceClientProvider port=\{intelligence\}>/);
  assert.match(source, /<Central key=/);
  assert.doesNotMatch(source, /WebShell/);
  assert.match(windowContent, /AuraContent/);
  assert.match(aura, /client\.ask/);
  assert.doesNotMatch(desktop, /title === 'Aura'/);
  assert.doesNotMatch(desktop, /Pergunte ao Aura/);
  for (const text of [source, adapter, remoteAdapter, aura, client]) {
    assert.doesNotMatch(text, /fetch\(|process\.env|apiKey|OPENAI|xAI|adapters\/native/);
  }
});