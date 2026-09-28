import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyProfileActivationState,
  validateProfileActivationRef,
  validateProfileActivationState,
} from "../system/contracts/profile-activation-state.mjs";

function component(overrides = {}) {
  return {
    id: "knowledge.example",
    kind: "knowledge-pack",
    version: "1.2.3",
    sha256: "a".repeat(64),
    receiptSha256: "b".repeat(64),
    installedAt: 1000,
    ...overrides,
  };
}

function activation(overrides = {}) {
  return {
    profile: { slug: "developer", version: 1 },
    components: [component()],
    activatedAt: 1200,
    ...overrides,
  };
}

test("empty Profile activation state is explicit and persistence-scoped", () => {
  assert.deepEqual(createEmptyProfileActivationState("device"), {
    schema: "ordax.profile-activation-state/1",
    revision: 0,
    persistence: "device",
    spaces: [],
  });
});

test("Profile activation reference stores only profile identity and verified component receipts", () => {
  const value = validateProfileActivationRef(activation());
  assert.deepEqual(value.profile, { slug: "developer", version: 1 });
  assert.equal(value.components[0].receiptSha256, "b".repeat(64));
  assert.equal(value.activatedAt, 1200);

  assert.throws(
    () => validateProfileActivationRef({
      ...activation(),
      memory: { content: "must never be activation state" },
    }),
    /fields are incompatible/,
  );
  assert.throws(
    () => validateProfileActivationRef({
      ...activation(),
      documents: ["client-contract.pdf"],
    }),
    /fields are incompatible/,
  );
});

test("Profile activation state preserves current and previous per Space for rollback", () => {
  const current = activation();
  const previous = activation({
    profile: { slug: "developer", version: 1 },
    components: [],
    activatedAt: 900,
  });
  const state = validateProfileActivationState({
    schema: "ordax.profile-activation-state/1",
    revision: 4,
    persistence: "device",
    spaces: [{
      spaceId: "space-professional-1",
      current,
      previous,
    }],
  });
  assert.equal(state.spaces[0].current.activatedAt, 1200);
  assert.equal(state.spaces[0].previous.activatedAt, 900);
});

test("Profile activation state rejects duplicate Spaces, duplicate components and empty rows", () => {
  const row = {
    spaceId: "space-professional-1",
    current: activation(),
    previous: null,
  };
  assert.throws(
    () => validateProfileActivationState({
      schema: "ordax.profile-activation-state/1",
      revision: 1,
      persistence: "device",
      spaces: [row, { ...row }],
    }),
    /duplicate Space ids/,
  );

  assert.throws(
    () => validateProfileActivationRef(activation({
      components: [component(), component()],
    })),
    /duplicate identities/,
  );

  assert.throws(
    () => validateProfileActivationState({
      schema: "ordax.profile-activation-state/1",
      revision: 1,
      persistence: "device",
      spaces: [{ spaceId: "space-professional-1", current: null, previous: null }],
    }),
    /cannot be empty/,
  );
});


test("Profile activation component order is canonical and current/previous cannot be identical", () => {
  const second = component({
    id: "skill.example",
    kind: "skill-pack",
    version: "1.0.0",
    sha256: "c".repeat(64),
    receiptSha256: "d".repeat(64),
    installedAt: 900,
  });
  const normalized = validateProfileActivationRef(activation({
    components: [second, component()],
  }));
  assert.deepEqual(
    normalized.components.map((entry) => entry.id),
    ["knowledge.example", "skill.example"],
  );

  assert.throws(
    () => validateProfileActivationState({
      schema: "ordax.profile-activation-state/1",
      revision: 1,
      persistence: "device",
      spaces: [{
        spaceId: "space-professional-1",
        current: activation(),
        previous: activation({ activatedAt: 800 }),
      }],
    }),
    /current and previous must differ/,
  );
});
