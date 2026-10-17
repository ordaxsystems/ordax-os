import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_LIFECYCLE_ACTIONS,
  SPACE_LIFECYCLE_REQUEST_SCHEMA,
  SPACE_LIFECYCLE_SCHEMA,
  assertSpaceLifecyclePort,
  isSpaceLifecycleActionSupported,
  validateSpaceLifecycleRequest,
  validateSpaceLifecycleSnapshot,
} from "../system/contracts/space-lifecycle.mjs";

const requestBase = Object.freeze({
  schema: SPACE_LIFECYCLE_REQUEST_SCHEMA,
  spaceId: "space-123",
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
});

test("Space lifecycle actions are intentionally bounded", () => {
  assert.deepEqual(SPACE_LIFECYCLE_ACTIONS, ["rename", "archive", "restore"]);
  assert.deepEqual(
    validateSpaceLifecycleSnapshot({ supportedActions: ["rename", "archive"] }),
    { supportedActions: ["rename", "archive"] },
  );
  assert.throws(
    () => validateSpaceLifecycleSnapshot({ supportedActions: ["rename", "delete"] }),
    /Unsupported or duplicate/,
  );
});

test("Space lifecycle requests never accept client-supplied authority", () => {
  const request = validateSpaceLifecycleRequest({
    ...requestBase,
    action: "rename",
    name: "Operação Centro",
  });
  assert.equal(request.action, "rename");
  assert.equal(request.name, "Operação Centro");
  assert.equal("actorId" in request, false);
  assert.equal("role" in request, false);

  for (const [field, value] of [
    ["actorId", "user-1"],
    ["userId", "user-1"],
    ["ownerId", "user-1"],
    ["role", "owner"],
    ["membership", { role: "owner" }],
    ["authorized", true],
    ["authority", "owner"],
  ]) {
    assert.throws(
      () => validateSpaceLifecycleRequest({
        ...requestBase,
        action: "archive",
        [field]: value,
      }),
      new RegExp(`unsupported field ${field}`),
    );
  }
});

test("rename, archive and restore requests have distinct fail-closed payloads", () => {
  assert.deepEqual(
    validateSpaceLifecycleRequest({ ...requestBase, action: "archive" }),
    { ...requestBase, action: "archive" },
  );
  assert.deepEqual(
    validateSpaceLifecycleRequest({ ...requestBase, action: "restore" }),
    { ...requestBase, action: "restore" },
  );
  assert.throws(
    () => validateSpaceLifecycleRequest({ ...requestBase, action: "archive", name: "not-allowed" }),
    /unsupported field name/,
  );
  assert.throws(
    () => validateSpaceLifecycleRequest({ ...requestBase, action: "archive", extra: true }),
    /unsupported field extra/,
  );
  assert.throws(
    () => validateSpaceLifecycleRequest({ ...requestBase, action: "rename", name: "   " }),
    /must be bounded text/,
  );
  assert.throws(
    () => validateSpaceLifecycleRequest({ ...requestBase, action: "rename", name: "Ok", spaceId: "   " }),
    /must be bounded text/,
  );
  assert.throws(
    () => validateSpaceLifecycleRequest({ ...requestBase, action: "rename", name: "Ok", idempotencyKey: "not-a-uuid" }),
    /must be a UUID/,
  );
});

test("Space lifecycle port advertises server-backed actions explicitly", () => {
  const snapshot = Object.freeze({ supportedActions: Object.freeze(["rename", "archive"]) });
  const port = Object.freeze({
    schema: SPACE_LIFECYCLE_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    renameSpace: async () => {},
    archiveSpace: async () => {},
    restoreSpace: async () => {},
  });

  assert.equal(assertSpaceLifecyclePort(port), port);
  assert.equal(isSpaceLifecycleActionSupported(snapshot, "rename"), true);
  assert.equal(isSpaceLifecycleActionSupported(snapshot, "restore"), false);
});
