import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_LIFECYCLE_SCHEMA,
} from "../system/contracts/space-lifecycle.mjs";
import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
} from "../system/contracts/spaces.mjs";
import { createSpaceLifecycleRuntime } from "../system/services/spaces/lifecycle.mjs";

const SPACE = Object.freeze({
  id: "space-lifecycle-runtime-test",
  name: "Runtime test",
  kind: "professional",
  state: "active",
  ownerId: "owner-lifecycle-runtime-test",
  domain: "food",
  subtype: "pizzeria",
  profilePack: "pizzaria-br@1",
});
const IDEMPOTENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createSpacesPort({ state = "ready", spaces = [SPACE] } = {}) {
  let snapshot = Object.freeze({
    schema: SPACES_SNAPSHOT_SCHEMA,
    state,
    spaces: Object.freeze(state === "ready" ? spaces : []),
  });
  let refreshCount = 0;
  return {
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
    async refresh() {
      refreshCount += 1;
      return snapshot;
    },
    reset() {},
    refreshCount: () => refreshCount,
  };
}

function createLifecyclePort({ supportedActions = ["rename", "archive", "restore"] } = {}) {
  const calls = [];
  const snapshot = Object.freeze({ supportedActions: Object.freeze([...supportedActions]) });
  const apply = async (action, request) => {
    calls.push({ action, request });
    return Object.freeze({ applied: true, action, spaceId: request.spaceId });
  };
  return {
    schema: SPACE_LIFECYCLE_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listener(snapshot);
      return () => {};
    },
    async refresh() {
      return snapshot;
    },
    renameSpace: (request) => apply("rename", request),
    archiveSpace: (request) => apply("archive", request),
    restoreSpace: (request) => apply("restore", request),
    calls,
  };
}

test("Space lifecycle runtime builds bounded canonical requests and refreshes the read projection", async () => {
  const spaces = createSpacesPort();
  const lifecycle = createLifecyclePort();
  const runtime = createSpaceLifecycleRuntime({ spaces, lifecycle });

  const result = await runtime.renameSpace(SPACE.id, "  Novo nome  ", IDEMPOTENCY);

  assert.deepEqual(result, {
    applied: true,
    action: "rename",
    spaceId: SPACE.id,
  });
  assert.equal(spaces.refreshCount(), 1);
  assert.equal(lifecycle.calls.length, 1);
  assert.deepEqual(lifecycle.calls[0], {
    action: "rename",
    request: {
      schema: "ordax.space-lifecycle-request/1",
      action: "rename",
      spaceId: SPACE.id,
      idempotencyKey: IDEMPOTENCY,
      name: "Novo nome",
    },
  });
});

test("Space lifecycle runtime fails closed when the action is not advertised", async () => {
  const spaces = createSpacesPort();
  const lifecycle = createLifecyclePort({ supportedActions: [] });
  const runtime = createSpaceLifecycleRuntime({ spaces, lifecycle });

  await assert.rejects(
    runtime.archiveSpace(SPACE.id, IDEMPOTENCY),
    /action is unavailable/,
  );
  assert.equal(lifecycle.calls.length, 0);
  assert.equal(spaces.refreshCount(), 0);
});

test("Space lifecycle runtime refuses stale or cross-account targets before invoking the mutation port", async () => {
  const spaces = createSpacesPort({ spaces: [] });
  const lifecycle = createLifecyclePort();
  const runtime = createSpaceLifecycleRuntime({ spaces, lifecycle });

  await assert.rejects(
    runtime.restoreSpace(SPACE.id, IDEMPOTENCY),
    /target is not available to the current account/,
  );
  assert.equal(lifecycle.calls.length, 0);
});

test("Space lifecycle runtime refuses mutations while the Spaces catalog is unavailable", async () => {
  const spaces = createSpacesPort({ state: "unavailable" });
  const lifecycle = createLifecyclePort();
  const runtime = createSpaceLifecycleRuntime({ spaces, lifecycle });

  await assert.rejects(
    runtime.archiveSpace(SPACE.id, IDEMPOTENCY),
    /catalog is not ready/,
  );
  assert.equal(lifecycle.calls.length, 0);
});
