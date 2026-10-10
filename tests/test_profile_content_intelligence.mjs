import assert from "node:assert/strict";
import test from "node:test";

import {
  PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
  validateProfileContentContext,
} from "../system/contracts/profile-content-context.mjs";
import { createNativeProfileContentContext } from "../system/adapters/native/profile-content-context.mjs";
import { readNativeProfileContentContextCapability } from "../system/adapters/native/profile-content-context-capability.mjs";
import {
  createProfileContentIntelligence,
  createSelectedSpaceProfileContentIntelligence,
} from "../system/services/intelligence/profile-content.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
  assertIntelligencePort,
} from "../system/contracts/intelligence.mjs";
import { summarizeDocumentWithIntelligence } from "../system/services/intelligence/client-actions.mjs";
import {
  SPACE_SELECTION_SCHEMA,
  validateSpaceSelectionSnapshot,
} from "../system/contracts/space-selection.mjs";
import { PROFILE_ACTIVATION_STATE_PORT_SCHEMA } from "../system/contracts/profile-activation-state.mjs";

function response(body, ok = true, status = 200) {
  return { ok, status, async json() { return body; } };
}

function context(spaceId = "space-dev", entries = [], activeProfile = entries.length
  ? { slug: "developer", version: 1 } : null) {
  return {
    schema: "ordax.profile-content-context/1",
    spaceId,
    profile: activeProfile,
    entries,
  };
}

function spaceSelectionPort(seed) {
  let snapshot = validateSpaceSelectionSnapshot(seed);
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() { return snapshot; },
    subscribe() { return () => {}; },
    select() { throw new Error("not used by this test port"); },
    clear() { throw new Error("not used by this test port"); },
    set(next) { snapshot = validateSpaceSelectionSnapshot(next); },
  };
}

function authorizedContext(selection, extraSpaces = []) {
  let subject = "user-1";
  let catalog = {
    schema: "ordax.spaces-snapshot/1",
    state: "ready",
    spaces: [
      ...(selection.getSnapshot().state === "selected"
        ? [selection.getSnapshot().selectedSpace] : []),
      ...extraSpaces,
    ],
  };
  const identitySessionPort = {
    schema: "ordax.identity-session/1",
    getSnapshot() { return {
      state: "signed-in", subjectId: subject, displayName: "User",
    }; },
    subscribe() { return () => {}; },
  };
  let activation = {
    schema: "ordax.profile-activation-state/1",
    revision: 1,
    persistence: "device",
    spaces: catalog.spaces.map((space) => ({
      spaceId: space.id, spaceKind: space.kind,
      current: {
        profile: { slug: "developer", version: 1 },
        components: [], activatedAt: 100,
      },
      previous: null,
    })),
  };
  const profileActivationStatePort = {
    schema: PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
    getSnapshot() { return activation; },
    async refresh() { return activation; },
    dispose() {},
  };
  const spacesPort = {
    schema: "ordax.spaces/1",
    getSnapshot() { return catalog; },
    subscribe() { return () => {}; },
    async refresh() { return catalog; },
    reset() {},
  };
  return {
    identitySessionPort,
    spacesPort,
    profileActivationStatePort,
    setActivation(next) { activation = next; },
    setSubject(next) { subject = next; },
    setCatalog(next) { catalog = next; },
  };
}

function intelligencePort() {
  const requests = [];
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    requests,
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready",
        inferenceAvailable: true,
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
        toolExecution: false,
      };
    },
    subscribe() { return () => {}; },
    async respond(request) {
      requests.push(request);
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "ok",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

test("Profile content context contract remains bounded and workspace-only", () => {
  const value = validateProfileContentContext(context("space-dev", [{
    id: "profile.123456789abc.developer.architecture",
    scope: "workspace",
    text: "Arquitetura verificada.",
    provenance: "profile-content:knowledge-pack:knowledge.developer-core@1.0.0:developer.architecture;revision=rev-1",
  }]));
  assert.equal(value.entries.length, 1);
  assert.equal(value.entries[0].scope, "workspace");

  assert.throws(() => validateProfileContentContext(context("space-dev", [{
    id: "x",
    scope: "system",
    text: "não permitido",
    provenance: "test",
  }])), /workspace scope/);
});

test("Native Profile context adapter requires explicit Space and preserves identity", async () => {
  const requests = [];
  const windowRef = {
    async fetch(path, options) {
      requests.push({ path, options });
      return response(context("space-dev", []));
    },
  };
  const port = createNativeProfileContentContext(windowRef);
  assert.equal(port.schema, PROFILE_CONTENT_CONTEXT_PORT_SCHEMA);
  await assert.rejects(() => port.read(""), /Space id is invalid/);
  const value = await port.read("space-dev");
  assert.equal(value.spaceId, "space-dev");
  assert.match(requests[0].path, /spaceId=space-dev/);
  assert.equal(requests[0].options.credentials, "same-origin");

  const mismatched = createNativeProfileContentContext({
    async fetch() { return response(context("space-other", [])); },
  });
  await assert.rejects(
    () => mismatched.read("space-dev"),
    /Space identity changed/,
  );
});

test("Profile content bridge appends verified context without replacing consumer context", async () => {
  const intelligence = intelligencePort();
  const profileContentContextPort = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read(spaceId) {
      assert.equal(spaceId, "space-dev");
      return validateProfileContentContext(context(spaceId, [{
        id: "profile.123456789abc.developer.architecture",
        scope: "workspace",
        text: "Use contratos explícitos.",
        provenance: "profile-content:knowledge-pack:knowledge.developer-core@1.0.0:developer.architecture;revision=rev-1",
      }]));
    },
  };
  const bridge = createProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort,
  });
  const bound = bridge.forSpace("space-dev");
  assert.equal(assertIntelligencePort(bound), bound);
  await bound.respond({
    intent: "explain",
    prompt: "Explique",
    context: [{
      id: "doc-1",
      scope: "document",
      text: "Contexto do documento",
      provenance: "user-document",
    }],
  });

  assert.equal(intelligence.requests.length, 1);
  assert.equal(intelligence.requests[0].context.length, 2);
  assert.equal(intelligence.requests[0].context[0].id, "doc-1");
  assert.match(intelligence.requests[0].context[1].provenance, /^profile-content:/);
});

test("Profile content bridge never infers a Space implicitly", async () => {
  const intelligence = intelligencePort();
  let reads = 0;
  const profileContentContextPort = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read() { reads += 1; return context("space-dev", []); },
  };
  const bridge = createProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort,
  });
  await assert.rejects(
    () => bridge.respond({ prompt: "teste" }),
    /Space id must be text/,
  );
  assert.equal(reads, 0);
  assert.equal(intelligence.requests.length, 0);
});

test("Space-bound Profile Intelligence works with existing client actions", async () => {
  const intelligence = intelligencePort();
  const profileContentContextPort = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read(spaceId) {
      return validateProfileContentContext(context(spaceId, [{
        id: "profile.123456789abc.dev.note",
        scope: "workspace",
        text: "Contexto profissional adicional.",
        provenance: "profile-content:knowledge-pack:knowledge.dev@1.0.0:dev.note;revision=1",
      }]));
    },
  };
  const bound = createProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort,
  }).forSpace("space-dev");

  await summarizeDocumentWithIntelligence(bound, {
    id: "doc-1",
    title: "Documento",
    text: "Conteúdo principal.",
    provenance: "user-document",
  });
  assert.equal(intelligence.requests[0].context[0].id, "doc-1");
  assert.match(intelligence.requests[0].context[1].provenance, /^profile-content:/);
});


test("Selected-Space Profile Intelligence injects only the explicitly selected Space", async () => {
  const intelligence = intelligencePort();
  const reads = [];
  const profileContentContextPort = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read(spaceId) {
      reads.push(spaceId);
      return validateProfileContentContext(context(spaceId, [{
        id: "profile.123456789abc.dev.selected",
        scope: "workspace",
        text: "Contexto do Profile do Space selecionado.",
        provenance: "profile-content:knowledge-pack:knowledge.dev@1.0.0:selected;revision=1",
      }]));
    },
  };
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-selected",
      ownerId: "user-1",
      name: "Selected",
      kind: "professional",
      state: "active",
      profilePack: "developer",
    },
  });
  const auth = authorizedContext(selection);
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort,
    spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
  });

  assert.equal(assertIntelligencePort(port), port);
  await port.respond({ prompt: "teste", context: [] });
  assert.deepEqual(reads, ["space-selected"]);
  assert.match(intelligence.requests[0].context[0].provenance, /^profile-content:/);
});

test("Selected-Space Profile Intelligence never invents context while selection is absent", async () => {
  const intelligence = intelligencePort();
  let reads = 0;
  const profileContentContextPort = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read() {
      reads += 1;
      throw new Error("must not read Profile content without a selected Space");
    },
  };
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "user-1",
    selectedSpace: null,
  });
  const auth = authorizedContext(selection);
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort,
    spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
  });

  await port.respond({
    prompt: "teste",
    context: [{
      id: "doc-1",
      scope: "document",
      text: "Contexto do usuário.",
      provenance: "user-document",
    }],
  });
  assert.equal(reads, 0);
  assert.equal(intelligence.requests[0].context.length, 1);
  assert.equal(intelligence.requests[0].context[0].id, "doc-1");
});

test("Selected-Space Profile Intelligence follows current selection without stale binding", async () => {
  const intelligence = intelligencePort();
  const reads = [];
  const profileContentContextPort = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read(spaceId) {
      reads.push(spaceId);
      return validateProfileContentContext(context(spaceId, [], { slug: "developer", version: 1 }));
    },
  };
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-one",
      ownerId: "user-1",
      name: "One",
      kind: "professional",
      state: "active",
      profilePack: "developer",
    },
  });
  const auth = authorizedContext(selection, [{
    id: "space-two", ownerId: "user-1", name: "Two",
    kind: "professional", state: "active", profilePack: "developer",
  }]);
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort,
    spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
  });

  await port.respond({ prompt: "one" });
  selection.set({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId: "user-1",
    selectedSpace: {
      id: "space-two",
      ownerId: "user-1",
      name: "Two",
      kind: "professional",
      state: "active",
      profilePack: "developer",
    },
  });
  await port.respond({ prompt: "two" });

  assert.deepEqual(reads, ["space-one", "space-two"]);
});



test("Professional knowledge never reads another identity's selected Space", async () => {
  const ai = intelligencePort();
  let reads = 0;
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected", subjectId: "user-1",
    selectedSpace: {
      id: "pizza-space", ownerId: "user-1", name: "Pizza", kind: "professional",
      state: "active", profilePack: "pizzaria-br",
    },
  });
  const auth = authorizedContext(selection);
  auth.setSubject("user-2");
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai, spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read() { reads++; return context("pizza-space", []); },
    },
  });
  await assert.rejects(() => port.respond({ prompt: "pedido anterior?" }), /authorized Space/);
  assert.equal(reads, 0);
  assert.equal(ai.requests.length, 0);
});

test("Professional knowledge never reads a revoked or archived catalog Space", async () => {
  const ai = intelligencePort();
  let reads = 0;
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected", subjectId: "user-1",
    selectedSpace: {
      id: "space-a", ownerId: "user-1", name: "A", kind: "professional",
      state: "active", profilePack: "pizzaria-br",
    },
  });
  const auth = authorizedContext(selection);
  auth.setCatalog({
    schema: "ordax.spaces-snapshot/1", state: "ready", spaces: [],
  });
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai, spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort, spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read() { reads++; return context("space-a", []); },
    },
  });
  await assert.rejects(() => port.respond({ prompt: "teste" }), /authorized Space/);
  assert.equal(reads, 0);
  assert.equal(ai.requests.length, 0);
});

test("Changing account while verified professional Knowledge is loading rejects its late result", async () => {
  const ai = intelligencePort();
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected", subjectId: "user-1",
    selectedSpace: {
      id: "legal-space", ownerId: "user-1", name: "Legal", kind: "professional",
      state: "active", profilePack: "developer",
    },
  });
  const auth = authorizedContext(selection);
  let complete;
  let begin;
  const begun = new Promise((resolve) => { begin = resolve; });
  const loading = new Promise((resolve) => { complete = resolve; });
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai, spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort, spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read(spaceId) {
        begin();
        await loading;
        return context(spaceId, [{
          id: "proof-1", scope: "workspace", text: "Dados do perfil anterior",
          provenance: "profile-content:knowledge-pack:verified",
        }]);
      },
    },
  });
  const pending = port.respond({ prompt: "consultar conhecimento" });
  await begun;
  auth.setSubject("user-2");
  complete();
  await assert.rejects(pending, /Space changed while reading context/);
  assert.equal(ai.requests.length, 0);
});

test("Switching to another Space during Knowledge retrieval never feeds stale context to AI", async () => {
  const ai = intelligencePort();
  const oldSpace = {
    id: "pizzaria", ownerId: "user-1", name: "Pizzaria",
    kind: "professional", state: "active", profilePack: "pizzaria-br",
  };
  const newSpace = {
    id: "impressao", ownerId: "user-1", name: "3D",
    kind: "professional", state: "active", profilePack: "impressao-3d-br",
  };
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected",
    subjectId: "user-1", selectedSpace: oldSpace,
  });
  const auth = authorizedContext(selection, [newSpace]);
  let begin; let finish;
  const started = new Promise((resolve) => { begin = resolve; });
  const waiting = new Promise((resolve) => { finish = resolve; });
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai, spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort, spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read(spaceId) {
        begin();
        await waiting;
        return context(spaceId, [], { slug: "developer", version: 1 });
      },
    },
  });
  const pending = port.respond({ prompt: "consulta" });
  await started;
  selection.set({
    schema: SPACE_SELECTION_SCHEMA, state: "selected",
    subjectId: "user-1", selectedSpace: newSpace,
  });
  finish();
  await assert.rejects(pending, /Space changed while reading context/);
  assert.equal(ai.requests.length, 0);
});

test("Profile-content wrapper rejects a cross-Space response from its reader", async () => {
  const ai = intelligencePort();
  const port = createProfileContentIntelligence({
    intelligencePort: ai,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read() { return context("another-space", []); },
    },
  });
  await assert.rejects(
    () => port.forSpace("expected-space").respond({ prompt: "teste" }),
    /Space identity changed/,
  );
  assert.equal(ai.requests.length, 0);
});


test("Updating the Profile Pack in the same Space during a Knowledge read rejects stale instructions", async () => {
  const ai = intelligencePort();
  const activeSpace = {
    id: "space-one", ownerId: "user-1", name: "One",
    kind: "professional", state: "active", profilePack: "developer",
  };
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected",
    subjectId: "user-1", selectedSpace: activeSpace,
  });
  const auth = authorizedContext(selection);
  let start; let finish;
  const entered = new Promise((resolve) => { start = resolve; });
  const waiting = new Promise((resolve) => { finish = resolve; });
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai,
    spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read(spaceId) {
        start();
        await waiting;
        return context(spaceId, [{
          id: "dev-old", scope: "workspace",
          text: "Old professional instructions",
          provenance: "profile-content:knowledge-pack:verified",
        }]);
      },
    },
  });
  const pending = port.respond({ prompt: "Como proceder?" });
  await entered;
  auth.setActivation({
    schema: "ordax.profile-activation-state/1",
    revision: 2,
    persistence: "device",
    spaces: [{
      spaceId: activeSpace.id, spaceKind: activeSpace.kind,
      current: {
        profile: { slug: "impressao-3d-br", version: 1 },
        components: [], activatedAt: 200,
      },
      previous: {
        profile: { slug: "developer", version: 1 },
        components: [], activatedAt: 100,
      },
    }],
  });
  finish();
  await assert.rejects(pending, /activation changed while reading context/);
  assert.equal(ai.requests.length, 0);
});

test("Professional Knowledge from an inactive Profile is rejected on the same authorized Space", async () => {
  const ai = intelligencePort();
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected", subjectId: "user-1",
    selectedSpace: {
      id: "space-1", ownerId: "user-1", name: "A",
      kind: "professional", state: "active", profilePack: "developer",
    },
  });
  const auth = authorizedContext(selection);
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai,
    spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read(spaceId) {
        return context(spaceId, [{
          id: "wrong-pack", scope: "workspace",
          text: "Instructions for another profile",
          provenance: "profile-content:knowledge-pack:verified",
        }], { slug: "pizzaria-br", version: 1 });
      },
    },
  });
  await assert.rejects(() => port.respond({ prompt: "teste" }), /inactive Profile/);
  assert.equal(ai.requests.length, 0);
});

test("Native Profile context capability is explicit and bounded", async () => {
  const requests = [];
  const enabled = await readNativeProfileContentContextCapability({
    async fetch(path, options) {
      requests.push({ path, options });
      return response({
        schema: "ordax.profile-content-context-capability/1",
        available: true,
      });
    },
  });
  assert.equal(enabled.available, true);
  assert.equal(requests[0].path, "/__ordax/native/profile-content-context-capability");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "same-origin");
  assert.equal(requests[0].options.cache, "no-store");

  const disabled = await readNativeProfileContentContextCapability({
    async fetch() {
      return response({
        schema: "ordax.profile-content-context-capability/1",
        available: false,
      });
    },
  });
  assert.equal(disabled.available, false);

  await assert.rejects(
    () => readNativeProfileContentContextCapability({
      async fetch() {
        return response({ schema: "wrong", available: true });
      },
    }),
    /capability is incompatible/,
  );
});


test("Native Profile reader carries bounded relevance terms to loopback only", async () => {
  const urls = [];
  const port = createNativeProfileContentContext({
    async fetch(path, options) {
      urls.push([path, options]);
      return response(context("space-dev"));
    },
  });
  await port.read("space-dev", { query: "  temperatura extrusao PLA  " });
  assert.equal(
    new URL(urls[0][0], "https://native.invalid").searchParams.get("query"),
    "temperatura extrusao PLA",
  );
  assert.equal(urls[0][1].method, "GET");
  assert.equal(urls[0][1].credentials, "same-origin");
  await assert.rejects(() => port.read("space-dev", { query: "x".repeat(257) }),
    /retrieval query is invalid/);
  await assert.rejects(() => port.read("space-dev", { query: "  " }),
    /retrieval query is invalid/);
  assert.equal(urls.length, 1);
  port.dispose();
});

test("Intelligence requests query-specific verified Profile context without increasing permissions", async () => {
  const ai = intelligencePort();
  const reads = [];
  const bridge = createProfileContentIntelligence({
    intelligencePort: ai,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read(spaceId, options) {
        reads.push({ spaceId, options });
        return context(spaceId, [{
          id: "verified-entry", scope: "workspace",
          text: "A temperatura de extrusão do PLA precisa ser ajustada.",
          provenance: "profile-content:knowledge-pack:verified",
        }]);
      },
    },
  });
  await bridge.forSpace("space-dev").respond({
    prompt: "  temperatura  da   extrusão  do PLA ",
  });
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0], {
    spaceId: "space-dev",
    options: { query: "temperatura da extrusão do PLA" },
  });
  assert.equal(ai.requests.length, 1);
  assert.equal(ai.requests[0].context.length, 1);
  assert.equal(ai.requests[0].context[0].scope, "workspace");
  assert.equal(ai.requests[0].context[0].provenance,
    "profile-content:knowledge-pack:verified");
});

test("Current Space authorization wrapper forwards the same bounded relevance query", async () => {
  const selectedSpace = {
    id: "space-test", name: "3D", ownerId: "user-1",
    state: "active", kind: "professional", profilePack: "developer",
  };
  const selection = spaceSelectionPort({
    schema: SPACE_SELECTION_SCHEMA, state: "selected",
    subjectId: "user-1", selectedSpace,
  });
  const auth = authorizedContext(selection);
  const ai = intelligencePort();
  const reads = [];
  const port = createSelectedSpaceProfileContentIntelligence({
    intelligencePort: ai,
    spaceSelectionPort: selection,
    identitySessionPort: auth.identitySessionPort,
    spacesPort: auth.spacesPort,
    profileActivationStatePort: auth.profileActivationStatePort,
    profileContentContextPort: {
      schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
      async read(spaceId, options) {
        reads.push([spaceId, options]);
        return context(spaceId, [{
          id: "ref", scope: "workspace", text: "PLA verificado",
          provenance: "profile-content:knowledge-pack:verified",
        }], { slug: "developer", version: 1 });
      },
    },
  });
  await port.respond({ prompt: "Extrusão  de PLA" });
  assert.deepEqual(reads, [["space-test", { query: "Extrusão de PLA" }]]);
  assert.equal(ai.requests.length, 1);
});

test("Profile-content bridge preserves inference cancellation through the verified Space reader", async () => {
  const intelligence = intelligencePort();
  const originalRespond = intelligence.respond.bind(intelligence);
  let deliveredSignal = null;
  intelligence.respond = (request, options) => {
    deliveredSignal = options?.signal;
    return originalRespond(request);
  };
  const port = {
    schema: PROFILE_CONTENT_CONTEXT_PORT_SCHEMA,
    async read(spaceId) { return validateProfileContentContext(context(spaceId, [])); },
  };
  const bridge = createProfileContentIntelligence({
    intelligencePort: intelligence,
    profileContentContextPort: port,
  }).forSpace("space-dev");
  const controller = new AbortController();
  await bridge.respond({ prompt: "Explique" }, { signal: controller.signal });
  assert.equal(deliveredSignal, controller.signal);
  assert.equal(intelligence.requests.length, 1);
});
