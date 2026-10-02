import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";
import { createPersonalActionProposalPlanner } from "../system/services/personal-ordax/proposal-planner.mjs";

function catalog() {
  return createPersonalActionCatalog({
    registrations: [{
      entry: {
        id: "native-file.ensure-directory",
        toolId: "ordax-native-file-space",
        toolArtifactSha256: "a".repeat(64),
        actionId: "files.directory.ensure",
        effect: "write",
        inputKind: "resource-value",
        resourceScheme: "file-space",
      },
      toResourceRef(value) {
        if (typeof value !== "string") throw new TypeError("resource must be text");
        const path = value.trim();
        if (!path.startsWith("/") || path.includes("..")) {
          throw new TypeError("resource path is invalid");
        }
        return "file-space:" + path;
      },
      reason: "Ensure the explicitly selected directory exists.",
    }],
  });
}

function intelligence(text) {
  const requests = [];
  return {
    requests,
    port: {
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
      async respond(request) {
        requests.push(request);
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text,
          engineId: "llama.cpp",
          modelId: "qwen-test",
          authority: "none",
        };
      },
    },
  };
}

function work(state = "queued") {
  return {
    schema: "ordax.personal-work-item/1",
    id: "personal-work-1",
    ownerKind: "account",
    ownerId: "user-a",
    goal: "Organizar uma pasta para os materiais do briefing.",
    state,
    spaceId: "space-a",
    projectId: "project-1",
    pendingApprovalId: null,
    backgroundExecution: false,
    contextRefs: ["space:space-a", "project:project-1"],
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };
}

test("planner exposes only sanitized catalog descriptors to Intelligence", async () => {
  const ai = intelligence(JSON.stringify({
    kind: "proposal",
    entryId: "native-file.ensure-directory",
    resourceValue: "/Operacao/Briefing",
    rationale: "Separar os materiais do briefing.",
  }));
  const planner = createPersonalActionProposalPlanner({
    intelligencePort: ai.port,
    actionCatalog: catalog(),
  });

  const proposal = await planner.propose(work());
  assert.equal(proposal.authority, "none");
  assert.equal(proposal.entryId, "native-file.ensure-directory");
  assert.equal(proposal.resourceValue, "/Operacao/Briefing");
  assert.equal(proposal.approvalRequested, false);
  assert.equal(proposal.executionAuthorized, false);

  assert.equal(ai.requests.length, 1);
  const prompt = ai.requests[0].prompt;
  assert.match(prompt, /native-file\.ensure-directory/);
  assert.match(prompt, /resource-value/);
  assert.match(prompt, /file-space/);
  assert.doesNotMatch(prompt, /ordax-native-file-space/);
  assert.doesNotMatch(prompt, /files\.directory\.ensure/);
  assert.doesNotMatch(prompt, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.doesNotMatch(prompt, /"effect"/);
  assert.doesNotMatch(prompt, /grantRef|approvalId|toolArtifactSha256/);
});

test("planner permits an exact no-action answer without creating a proposal", async () => {
  const ai = intelligence('{"kind":"none"}');
  const planner = createPersonalActionProposalPlanner({
    intelligencePort: ai.port,
    actionCatalog: catalog(),
  });
  assert.equal(await planner.propose(work("paused")), null);
});

test("planner rejects model attempts to smuggle authority or unknown fields", async () => {
  for (const text of [
    '{"kind":"proposal","entryId":"native-file.ensure-directory","resourceValue":"/A","rationale":"x","authority":"model"}',
    '{"kind":"proposal","entryId":"native-file.ensure-directory","resourceValue":"/A","rationale":"x","approvalRequested":true}',
    '~~~json\n{"kind":"none"}\n~~~',
  ]) {
    const ai = intelligence(text);
    const planner = createPersonalActionProposalPlanner({
      intelligencePort: ai.port,
      actionCatalog: catalog(),
    });
    await assert.rejects(() => planner.propose(work()), /JSON|undeclared/);
  }
});

test("planner cannot select an unregistered action or invalid resource", async () => {
  const unknown = intelligence(JSON.stringify({
    kind: "proposal",
    entryId: "shell.execute",
    resourceValue: "/tmp",
    rationale: "Executar comando.",
  }));
  await assert.rejects(
    () => createPersonalActionProposalPlanner({
      intelligencePort: unknown.port,
      actionCatalog: catalog(),
    }).propose(work()),
    /unavailable/,
  );

  const invalid = intelligence(JSON.stringify({
    kind: "proposal",
    entryId: "native-file.ensure-directory",
    resourceValue: "../fora",
    rationale: "Sair do file-space.",
  }));
  await assert.rejects(
    () => createPersonalActionProposalPlanner({
      intelligencePort: invalid.port,
      actionCatalog: catalog(),
    }).propose(work()),
    /invalid/,
  );
});

test("planner runs only for queued or paused Work", async () => {
  const ai = intelligence('{"kind":"none"}');
  const planner = createPersonalActionProposalPlanner({
    intelligencePort: ai.port,
    actionCatalog: catalog(),
  });
  await assert.rejects(() => planner.propose(work("running")), /queued or paused/);
  assert.equal(ai.requests.length, 0);
});
