import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { createIntelligenceToolGrantAuthority } from "../system/services/intelligence/tool-grants.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function identitySession() {
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-in", subjectId: "user-a", displayName: "User A" };
    },
    subscribe() {
      return () => {};
    },
  };
}

function selectedSpace() {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      return {
        schema: SPACE_SELECTION_SCHEMA,
        state: "selected",
        subjectId: "user-a",
        selectedSpace: {
          id: "space-a",
          name: "Pizzaria",
          kind: "professional",
          state: "active",
          ownerId: "user-a",
          profilePack: "pizzaria-br",
        },
      };
    },
    subscribe() {
      return () => {};
    },
    select() {},
    clear() {},
  };
}

function projectCatalog() {
  return {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot() {
      return {
        persistence: "device",
        projects: [{
          id: "project-1",
          name: "Operacao",
          path: "/Operacao",
          createdAt: 1,
          lastOpenedAt: 1,
          lastFilePath: null,
        }],
      };
    },
    subscribe() {
      return () => {};
    },
    create() {},
    rename() {},
    recordOpened() {},
    recordFileOpened() {},
    clearLastFile() {},
    relocateLastFilePath() {},
    remove() {},
  };
}

function intelligence() {
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
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
    subscribe() {
      return () => {};
    },
    async respond() {
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "resultado",
        engineId: "llama.cpp",
        modelId: "qwen-test",
        authority: "none",
      };
    },
  };
}

test("Native composition reuses canonical owner/context/intelligence ports without implicit binding", () => {
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
  });

  const work = runtime.create("Planejar o proximo passo");
  assert.equal(work.ownerKind, "account");
  assert.equal(work.ownerId, "user-a");
  assert.equal(work.spaceId, null);
  assert.equal(work.projectId, null);
  assert.deepEqual(work.contextRefs, []);
  assert.equal(runtime.getSnapshot().persistence, "device");
  runtime.dispose();
});

test("Native composition persists completed owner-bound Work Result through the native store", async () => {
  const localStorage = memoryStorage();
  const ports = {
    windowRef: { localStorage },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
  };

  const first = createNativePersonalOrdaxComposition(ports);
  const work = first.create("Executar raciocinio foreground", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  await first.run(work.id);
  const completed = first.getSnapshot();
  assert.equal(completed.workItems[0].state, "completed");
  assert.equal(completed.results.length, 1);
  assert.equal(completed.results[0].workItemId, work.id);
  assert.equal(completed.results[0].authority, "none");
  first.dispose();

  const restored = createNativePersonalOrdaxComposition(ports);
  const snapshot = restored.getSnapshot();
  assert.equal(snapshot.persistence, "device");
  assert.equal(snapshot.workItems[0].state, "completed");
  assert.equal(snapshot.results[0].text, "resultado");
  assert.ok(
    snapshot.activities.some((event) =>
      event.workItemId === work.id
      && event.type === "completed"
      && event.artifactRefs.includes(`result:${snapshot.results[0].id}`)
    ),
  );
  restored.dispose();
});


test("Native composition resolves approvals through the injected canonical grant registry", () => {
  const nowMs = Date.now();
  const authority = createIntelligenceToolGrantAuthority({
    now: () => nowMs,
    createGrantId: () => "grant-native-approval-1",
  });
  const runtime = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: memoryStorage() },
    identitySession: identitySession(),
    spaceSelection: selectedSpace(),
    projects: projectCatalog(),
    intelligence: intelligence(),
    grantAuthority: authority,
    toolResolver(toolId) {
      if (toolId !== "files-inspector") return null;
      return {
        id: "files-inspector",
        version: "1.0.0",
        artifactSha256: "a".repeat(64),
        sandbox: "wasi-component",
        actions: [{
          id: "files.document.write",
          mode: "write",
          approval: "per-use",
          scopes: [],
        }],
        network: { allowed: false, destinations: [] },
        filesystem: { allowed: true, scopes: ["/Operacao"] },
        limits: { timeoutMs: 1000, maxOutputBytes: 4096 },
      };
    },
  });

  const work = runtime.create("Atualizar documento", {
    spaceId: "space-a",
    projectId: "project-1",
  });
  const approval = runtime.requestApproval(work.id, {
    actionId: "files.document.write",
    toolId: "files-inspector",
    effect: "write",
    resourceRef: "file-space:/Operacao/menu.md",
    reason: "Salvar alteracao solicitada pelo usuario.",
  });
  const decision = runtime.approvalConsent.approve(work.id, approval.id);

  assert.equal(decision.decision, "allow");
  assert.equal(decision.grantRef, "grant-native-approval-1");
  assert.equal(authority.registry.resolve(decision.grantRef)?.ownerId, "user-a");
  assert.equal(
    authority.registry.resolve(decision.grantRef)?.resourceRef,
    "file-space:/Operacao/menu.md",
  );
  assert.equal(runtime.getSnapshot().workItems[0].state, "queued");
  assert.equal(typeof runtime.issueGrant, "undefined");
  assert.equal(typeof runtime.grantIssuer, "undefined");
  assert.equal(typeof runtime.approvalConsent.approve, "function");
  assert.equal(typeof runtime.approvalConsent.deny, "function");

  runtime.dispose();
  authority.dispose();
});
