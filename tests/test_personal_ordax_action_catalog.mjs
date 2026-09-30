import assert from "node:assert/strict";
import test from "node:test";

import { PERSONAL_ORDAX_RUNTIME_SCHEMA } from "../system/contracts/personal-ordax-store.mjs";
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
