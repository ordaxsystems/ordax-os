import assert from "node:assert/strict";
import test from "node:test";

import {
  SPACE_CAPABILITY_PROVIDER_SCHEMA,
  SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
} from "../system/contracts/space-experience.mjs";
import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import { createSelectedSpaceAuraCapabilityProvider } from "../system/services/spaces/aura-provider.mjs";
import { createSpaceExperienceSource } from "../system/services/spaces/composition.mjs";

function space(overrides = {}) {
  return {
    id: "pizza-1",
    ownerId: "owner-1",
    name: "Pizzaria",
    kind: "professional",
    state: "active",
    profilePack: "pizzaria-br",
    ...overrides,
  };
}

function selected(spaceValue, subjectId = "subject-1") {
  return {
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId,
    selectedSpace: spaceValue,
  };
}

function createSelectionFake(initial) {
  let current = initial;
  const listeners = new Set();
  const port = {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    select() {
      return current;
    },
    clear() {
      return current;
    },
  };
  return {
    port,
    set(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function intelligenceSnapshot(state = "ready") {
  const inferenceAvailable = state === "ready" || state === "busy";
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    state,
    inferenceAvailable,
    engineId: inferenceAvailable ? "local" : null,
    modelId: inferenceAvailable ? "ordax-test" : null,
    authority: "none",
    toolExecution: false,
  };
}

function createIntelligenceFake(initial = intelligenceSnapshot()) {
  let current = initial;
  const listeners = new Set();
  const port = {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async respond() {
      throw new Error("not used by capability provider tests");
    },
  };
  return {
    port,
    set(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

test("Aura provider is ready only for the exact currently selected Space", () => {
  const current = space();
  const selection = createSelectionFake(selected(current));
  const intelligence = createIntelligenceFake();
  const provider = createSelectedSpaceAuraCapabilityProvider({
    spaceSelectionPort: selection.port,
    intelligencePort: intelligence.port,
  });

  assert.equal(provider.schema, SPACE_CAPABILITY_PROVIDER_SCHEMA);
  assert.equal(provider.capability, "aura");
  assert.deepEqual(provider.getSnapshot(current), {
    schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
    state: "ready",
    spaceId: "pizza-1",
    metrics: {},
    auraContext: null,
  });
  assert.equal(provider.getSnapshot(space({ id: "pizza-2" })).state, "unavailable");
  assert.equal(provider.getSnapshot(space({ ownerId: "foreign-owner" })).state, "unavailable");
});

test("Aura provider follows real Intelligence availability without inventing a summary metric", () => {
  const current = space();
  const selection = createSelectionFake(selected(current));
  const intelligence = createIntelligenceFake(intelligenceSnapshot("degraded"));
  const provider = createSelectedSpaceAuraCapabilityProvider({
    spaceSelectionPort: selection.port,
    intelligencePort: intelligence.port,
  });

  assert.deepEqual(provider.getSnapshot(current).metrics, {});
  assert.equal(provider.getSnapshot(current).state, "unavailable");
  intelligence.set(intelligenceSnapshot("busy"));
  assert.equal(provider.getSnapshot(current).state, "ready");
  assert.deepEqual(provider.getSnapshot(current).metrics, {});
  intelligence.set(intelligenceSnapshot("error"));
  assert.equal(provider.getSnapshot(current).state, "unavailable");
});

test("Space experience exposes Aura only for current Space and cleans upstream subscriptions", () => {
  const current = space();
  const selection = createSelectionFake(selected(current));
  const intelligence = createIntelligenceFake();
  const aura = createSelectedSpaceAuraCapabilityProvider({
    spaceSelectionPort: selection.port,
    intelligencePort: intelligence.port,
  });
  const source = createSpaceExperienceSource({ providers: [aura] });

  const active = source.get(current);
  assert.deepEqual(active.capabilities, ["aura"]);
  assert.deepEqual(active.widgets, []);
  assert.deepEqual(active.spaceCardMetrics, []);
  assert.deepEqual(active.auraContext, {
    spaceId: "pizza-1",
    domain: "food",
    subtype: "pizzeria",
    capabilities: ["aura"],
    fragments: [],
  });

  let notifications = 0;
  source.subscribe(() => { notifications += 1; });
  selection.set({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId: "subject-1",
    selectedSpace: null,
  });
  assert.ok(notifications >= 1);
  assert.deepEqual(source.get(current).capabilities, []);
  assert.equal(source.get(current).auraContext, null);

  source.dispose();
  assert.equal(selection.listenerCount(), 0);
  assert.equal(intelligence.listenerCount(), 0);
});
