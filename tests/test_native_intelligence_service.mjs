import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA,
  NATIVE_INTELLIGENCE_SERVICE_RESPONSE_SCHEMA,
  NATIVE_INTELLIGENCE_SERVICE_SCHEMA,
  createNativeIntelligenceService,
  validateNativeIntelligenceServiceRequest,
} from "../system/services/intelligence/native-service.mjs";

const subjectId = "subject-1";
const spaceId = "space-1";

function identityPort(initial = { state: "signed-in", subjectId, displayName: "User" }) {
  let snapshot = initial;
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set(next) { snapshot = next; },
  };
}

function selectedSpace(id = spaceId, subject = subjectId) {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: subject,
    selectedSpace: {
      id,
      name: "Workspace",
      kind: "work",
      state: "active",
      ownerId: subject,
      profilePack: null,
    },
  };
}

function unselectedSpace(subject = subjectId) {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: subject,
    selectedSpace: null,
  };
}

function spacePort(initial = selectedSpace()) {
  let snapshot = initial;
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    select() {},
    clear() {},
    set(next) { snapshot = next; },
  };
}

function intelligencePort({ onRespond = null } = {}) {
  const calls = [];
  return {
    calls,
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "ready",
      inferenceAvailable: true,
      engineId: "engine-test",
      modelId: "model-test",
      authority: "none",
      toolExecution: false,
    }),
    subscribe: () => () => {},
    async respond(request) {
      calls.push(request);
      if (onRespond) return await onRespond(request);
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "Resposta canônica",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "none",
      };
    },
  };
}

function envelope({
  subject = subjectId,
  space = spaceId,
  project = null,
  request = {},
  extra = {},
} = {}) {
  return {
    schema: NATIVE_INTELLIGENCE_SERVICE_REQUEST_SCHEMA,
    requestId: "request-1",
    context: {
      subjectId: subject,
      spaceId: space,
      projectId: project,
    },
    request: {
      intent: "ask",
      prompt: "Qual é o estado?",
      context: [],
      maxTokens: 512,
      ...request,
    },
    ...extra,
  };
}

test("Native Intelligence service forwards only the canonical request through the supplied final port", async () => {
  const intelligence = intelligencePort();
  const service = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });
  assert.equal(service.schema, NATIVE_INTELLIGENCE_SERVICE_SCHEMA);
  const result = await service.respond(envelope());
  assert.equal(intelligence.calls.length, 1);
  assert.deepEqual(intelligence.calls[0], {
    intent: "ask",
    prompt: "Qual é o estado?",
    context: [],
    maxTokens: 512,
  });
  assert.deepEqual(result, {
    schema: NATIVE_INTELLIGENCE_SERVICE_RESPONSE_SCHEMA,
    requestId: "request-1",
    context: { subjectId, spaceId, projectId: null },
    response: {
      schema: INTELLIGENCE_RESPONSE_SCHEMA,
      text: "Resposta canônica",
      engineId: "engine-test",
      modelId: "model-test",
      authority: "none",
    },
  });
});

test("Native Intelligence service supports global context only when no Space is selected", async () => {
  const intelligence = intelligencePort();
  const spaces = spacePort(unselectedSpace());
  const service = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spaces,
  });
  const result = await service.respond(envelope({ space: null }));
  assert.equal(result.context.spaceId, null);
  spaces.set(selectedSpace());
  await assert.rejects(
    service.respond(envelope({ space: null })),
    /does not match current identity\/Space/,
  );
  assert.equal(intelligence.calls.length, 1);
});

test("Native Intelligence service rejects subject/Space mismatch before inference", async () => {
  const intelligence = intelligencePort();
  const service = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });
  await assert.rejects(service.respond(envelope({ subject: "subject-2" })), /does not match/);
  await assert.rejects(service.respond(envelope({ space: "space-2" })), /does not match/);
  assert.equal(intelligence.calls.length, 0);
});

test("Native Intelligence service requires signed-in identity and matching Space-selection subject", async () => {
  const intelligence = intelligencePort();
  const signedOut = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort({ state: "signed-out", subjectId: null, displayName: null }),
    spaceSelectionPort: spacePort(),
  });
  await assert.rejects(signedOut.respond(envelope()), /requires a signed-in identity/);

  const mismatchedSelection = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(selectedSpace(spaceId, "subject-2")),
  });
  await assert.rejects(mismatchedSelection.respond(envelope()), /selection is unavailable/);
  assert.equal(intelligence.calls.length, 0);
});

test("Native Intelligence project context remains fail closed until a canonical Native project binding exists", async () => {
  const intelligence = intelligencePort();
  const service = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });
  await assert.rejects(service.respond(envelope({ project: "project-1" })), /project context is not available yet/);
  assert.equal(intelligence.calls.length, 0);
});

test("Native Intelligence service rejects extra provider, credential, authority and envelope fields", () => {
  for (const value of [
    envelope({ request: { provider: "openai" } }),
    envelope({ request: { apiKey: "secret" } }),
    envelope({ request: { authority: "execute" } }),
    envelope({ request: { toolExecution: true } }),
    envelope({ extra: { targetDeviceId: "device-1" } }),
    {
      ...envelope(),
      context: { ...envelope().context, grantId: "grant-1" },
    },
    {
      ...envelope(),
      request: {
        ...envelope().request,
        context: [{
          id: "ctx-1",
          scope: "user",
          text: "x",
          provenance: "test",
          authority: "execute",
        }],
      },
    },
  ]) assert.throws(
    () => validateNativeIntelligenceServiceRequest(value),
    /Native Intelligence .*incompatible/,
  );
});

test("Native Intelligence service drops a response when identity or Space changes while inference is pending", async () => {
  const identity = identityPort();
  const spaces = spacePort();
  let releases = [];
  const intelligence = intelligencePort({
    async onRespond() {
      await new Promise((resolve) => releases.push(resolve));
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "stale",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "none",
      };
    },
  });
  const service = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identity,
    spaceSelectionPort: spaces,
  });

  const pendingSpace = service.respond(envelope());
  while (releases.length < 1) await new Promise((resolve) => setImmediate(resolve));
  spaces.set(selectedSpace("space-2"));
  releases.shift()();
  await assert.rejects(pendingSpace, /changed while inference was pending/);

  spaces.set(selectedSpace());
  const pendingIdentity = service.respond(envelope());
  while (releases.length < 1) await new Promise((resolve) => setImmediate(resolve));
  identity.set({ state: "signed-in", subjectId: "subject-2", displayName: "Other" });
  releases.shift()();
  await assert.rejects(pendingIdentity, /changed while inference was pending|selection is unavailable/);
});

test("Native Intelligence service revalidates canonical response authority", async () => {
  const intelligence = intelligencePort({
    async onRespond() {
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "x",
        engineId: "engine-test",
        modelId: "model-test",
        authority: "execute",
      };
    },
  });
  const service = createNativeIntelligenceService({
    intelligencePort: intelligence,
    identitySessionPort: identityPort(),
    spaceSelectionPort: spacePort(),
  });
  await assert.rejects(service.respond(envelope()), /response authority is invalid/);
});

test("Native Intelligence service source remains transport-neutral and uncomposed", async () => {
  const [service, composition, browserHost] = await Promise.all([
    readFile(new URL("../system/services/intelligence/native-service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/runtime/ordax_browser_host.py", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(service, /fetch\(|local-ai|model-router|llama|Qwen|apiKey|OPENAI|xAI/);
  assert.doesNotMatch(composition, /native-service\.mjs|createNativeIntelligenceService/);
  assert.doesNotMatch(browserHost, /native-intelligence-service|intelligence\.respond/);
});
