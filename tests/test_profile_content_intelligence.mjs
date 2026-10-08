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

function response(body, ok = true, status = 200) {
  return { ok, status, async json() { return body; } };
}

function context(spaceId = "space-dev", entries = []) {
  return {
    schema: "ordax.profile-content-context/1",
    spaceId,
    profile: entries.length ? { slug: "developer", version: 1 } : null,
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
      return validateProfileContentContext(context(spaceId, []));
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
