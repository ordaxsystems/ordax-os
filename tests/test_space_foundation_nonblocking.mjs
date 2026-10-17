import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
  assertSpacesPort,
} from "../system/contracts/spaces.mjs";
import {
  SPACE_CAPABILITY_PROVIDER_SCHEMA,
} from "../system/contracts/space-experience.mjs";
import {
  composeSpaceExperience,
} from "../system/services/spaces/composition.mjs";

const sampleSpace = Object.freeze({
  id: "space-foundation-test",
  name: "Foundation test",
  kind: "professional",
  state: "active",
  ownerId: "owner-foundation-test",
  domain: "food",
  subtype: "pizzeria",
  profilePack: "pizzaria-br@1",
});

test("Spaces surface port stays read-only and update-safe", () => {
  const snapshot = Object.freeze({
    schema: SPACES_SNAPSHOT_SCHEMA,
    state: "ready",
    spaces: Object.freeze([sampleSpace]),
  });

  const port = Object.freeze({
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    reset: () => {},
  });

  assert.equal(assertSpacesPort(port), port);

  for (const forbidden of [
    "archive",
    "create",
    "delete",
    "execute",
    "mutate",
    "remove",
    "restore",
    "update",
  ]) {
    assert.equal(forbidden in port, false, `${forbidden} must not move into the read port`);
  }
});

test("declared Space capabilities degrade locally when providers are unavailable", () => {
  const experience = composeSpaceExperience(sampleSpace, []);

  assert.equal(experience.state, "ready");
  assert.equal(experience.spaceId, sampleSpace.id);
  assert.equal(experience.type?.key, "food.pizzeria");
  assert.deepEqual(experience.capabilities, []);
  assert.deepEqual(experience.widgets, []);
  assert.deepEqual(experience.spaceCardMetrics, []);
  assert.equal(experience.auraContext, null);

  assert.ok(
    experience.navigation.some((item) => item.id === "overview"),
    "capability-independent navigation remains available",
  );
  assert.ok(
    experience.navigation.some((item) => item.id === "settings"),
    "Space shell remains usable without vertical providers",
  );
  assert.equal(
    experience.navigation.some((item) => item.id === "orders"),
    false,
    "declared but unavailable capability must not be exposed as functional UI",
  );
});

test("a failing capability provider does not invalidate the Space experience shell", () => {
  const badProvider = Object.freeze({
    schema: SPACE_CAPABILITY_PROVIDER_SCHEMA,
    capability: "orders",
    spaceTypes: Object.freeze(["food.pizzeria"]),
    getSnapshot() {
      throw new Error("provider unavailable");
    },
    subscribe() {
      return () => {};
    },
  });

  const experience = composeSpaceExperience(sampleSpace, [badProvider]);

  assert.equal(experience.state, "ready");
  assert.deepEqual(experience.capabilities, []);
  assert.equal(experience.navigation.some((item) => item.id === "orders"), false);
});
