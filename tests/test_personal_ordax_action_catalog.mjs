import assert from "node:assert/strict";
import test from "node:test";

import { PERSONAL_ORDAX_RUNTIME_SCHEMA } from "../system/contracts/personal-ordax-store.mjs";
import {
  PERSONAL_ACTION_PROPOSAL_SCHEMA,
  validatePersonalActionProposal,
} from "../system/contracts/personal-action-proposal.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";

function registration(overrides = {}) {
  return {
    entry: {
      id: "native-file.ensure-directory",
      toolId: "ordax-native-file-space",
      toolArtifactSha256: "a".repeat(64),
      actionId: "files.directory.ensure",
      effect: "write",
      inputKind: "resource-value",
      resourceScheme: "file-space",
      ...overrides.entry,
    },
    toResourceRef(value) {
      if (typeof value !== "string") throw new TypeError("resource must be text");
      const path = value.trim();
      if (!path.startsWith("/") || path.includes("..")) {
        throw new TypeError("resource path is invalid");
      }
      return `file-space:${path}`;
    },
    reason: "Ensure the explicitly selected directory exists.",
    ...overrides,
  };
}

function runtime() {
  const calls = [];
  return {
    calls,
    port: {
      schema: PERSONAL_ORDAX_RUNTIME_SCHEMA,
      requestApproval(workItemId, request) {
        calls.push({ workItemId, request });
        return { id: "approval-1", ...request };
      },
    },
  };
}

test("action catalog exposes immutable authority-free descriptors", () => {
  const catalog = createPersonalActionCatalog({ registrations: [registration()] });
  const entries = catalog.list();

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "native-file.ensure-directory");
  assert.equal(entries[0].toolArtifactSha256, "a".repeat(64));
  assert.equal(entries[0].resourceScheme, "file-space");
  assert.equal(entries[0].inputKind, "resource-value");
  assert.equal(Object.isFrozen(entries), true);
  assert.equal(Object.isFrozen(entries[0]), true);
  assert.equal("toResourceRef" in entries[0], false);
  assert.equal("reason" in entries[0], false);
});

test("action catalog canonicalizes human resource input before approval", () => {
  const catalog = createPersonalActionCatalog({ registrations: [registration()] });
  const target = runtime();

  catalog.request(target.port, "personal-work-1", "native-file.ensure-directory", {
    resourceValue: " /Documentos/Novo ",
  });

  assert.deepEqual(target.calls, [{
    workItemId: "personal-work-1",
    request: {
      actionId: "files.directory.ensure",
      toolId: "ordax-native-file-space",
      toolArtifactSha256: "a".repeat(64),
      effect: "write",
      resourceRef: "file-space:/Documentos/Novo",
      reason: "Ensure the explicitly selected directory exists.",
    },
  }]);
});

test("action catalog fails closed for unknown, duplicate and invalid resources", () => {
  assert.throws(
    () => createPersonalActionCatalog({
      registrations: [registration(), registration()],
    }),
    /Duplicate Personal action entry/,
  );

  const catalog = createPersonalActionCatalog({ registrations: [registration()] });
  const target = runtime();
  assert.throws(
    () => catalog.request(target.port, "personal-work-1", "missing", {
      resourceValue: "/Documentos/Novo",
    }),
    /unavailable/,
  );
  assert.throws(
    () => catalog.request(target.port, "personal-work-1", "native-file.ensure-directory", {
      resourceValue: "../fora",
    }),
    /invalid/,
  );
  assert.deepEqual(target.calls, []);
});


test("action proposal is catalog-bound, authority-free and creates no approval", () => {
  const catalog = createPersonalActionCatalog({ registrations: [registration()] });
  const proposal = catalog.propose(
    "personal-work-1",
    "native-file.ensure-directory",
    {
      resourceValue: " /Documentos/Novo ",
      rationale: "Organizar os arquivos deste trabalho em uma pasta explícita.",
    },
  );

  assert.deepEqual(proposal, {
    schema: PERSONAL_ACTION_PROPOSAL_SCHEMA,
    workItemId: "personal-work-1",
    entryId: "native-file.ensure-directory",
    resourceValue: "/Documentos/Novo",
    rationale: "Organizar os arquivos deste trabalho em uma pasta explícita.",
    authority: "none",
    executionAuthorized: false,
    approvalRequested: false,
  });
  assert.equal(Object.isFrozen(proposal), true);
  for (const forbidden of [
    "toolId",
    "actionId",
    "effect",
    "resourceRef",
    "grantRef",
    "approvalId",
    "toolArtifactSha256",
    "decision",
  ]) {
    assert.equal(forbidden in proposal, false);
  }
});

test("action proposal validates resource through catalog without exposing canonical ref", () => {
  const catalog = createPersonalActionCatalog({ registrations: [registration()] });

  assert.throws(
    () => catalog.propose(
      "personal-work-1",
      "native-file.ensure-directory",
      {
        resourceValue: "../fora",
        rationale: "Tentar sair do file-space.",
      },
    ),
    /invalid/,
  );
  assert.throws(
    () => catalog.propose(
      "personal-work-1",
      "missing",
      {
        resourceValue: "/Documentos/Novo",
        rationale: "Ação não registrada.",
      },
    ),
    /unavailable/,
  );
});

test("personal action proposal contract rejects hidden authority and execution flags", () => {
  const base = {
    schema: PERSONAL_ACTION_PROPOSAL_SCHEMA,
    workItemId: "personal-work-1",
    entryId: "native-file.ensure-directory",
    resourceValue: "/Documentos/Novo",
    rationale: "Criar somente uma proposta revisável.",
    authority: "none",
    executionAuthorized: false,
    approvalRequested: false,
  };

  assert.throws(
    () => validatePersonalActionProposal({ ...base, toolId: "ordax-native-file-space" }),
    /cannot carry authority field/,
  );
  assert.throws(
    () => validatePersonalActionProposal({ ...base, resourceRef: "file-space:\/Documentos\/Novo" }),
    /cannot carry authority field/,
  );
  assert.throws(
    () => validatePersonalActionProposal({ ...base, authority: "model" }),
    /authority must remain none/,
  );
  assert.throws(
    () => validatePersonalActionProposal({ ...base, executionAuthorized: true }),
    /cannot authorize execution/,
  );
  assert.throws(
    () => validatePersonalActionProposal({ ...base, approvalRequested: true }),
    /cannot authorize execution/,
  );
});
