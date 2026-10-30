import assert from "node:assert/strict";
import test from "node:test";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { SPACES_PORT_SCHEMA, SPACES_SNAPSHOT_SCHEMA } from "../system/contracts/spaces.mjs";
import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  SPACE_CAPABILITY_PROVIDER_SCHEMA,
  SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
} from "../system/contracts/space-experience.mjs";
import { createIdentityBoundSpaceExperienceSource } from "../system/services/spaces/identity-bound-experience.mjs";
import { createSpaceExperienceSource } from "../system/services/spaces/composition.mjs";

const pizza = Object.freeze({
  id: "food-1", ownerId: "owner-a", name: "Pizzaria A", kind: "professional",
  state: "active", profilePack: "pizzaria-br@1", domain: "food", subtype: "pizzeria",
});
const pizzaB = Object.freeze({ ...pizza, id: "food-2", ownerId: "owner-b", name: "Pizzaria B" });
const signed = (user) => ({ state: "signed-in", subjectId: user, displayName: user });
const selected = (user, space) => ({
  schema: SPACE_SELECTION_SCHEMA, state: "selected", subjectId: user, selectedSpace: space,
});
const ready = (items) => ({ schema: SPACES_SNAPSHOT_SCHEMA, state: "ready", spaces: items });
function observable(schema, initial, methods = {}) {
  let value = initial;
  const listeners = new Set();
  return {
    schema,
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      listener(value);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    get listenerCount() { return listeners.size; },
    ...methods,
  };
}
function fixture() {
  const identity = observable(IDENTITY_SESSION_SCHEMA, signed("owner-a"));
  const selection = observable(SPACE_SELECTION_SCHEMA, selected("owner-a", pizza), {
    select() {},
    clear() {},
  });
  const spaces = observable(SPACES_PORT_SCHEMA, ready([pizza]), {
    async refresh() {},
    reset() {},
  });
  const providerListeners = new Set();
  let reads = 0;
  const provider = {
    schema: SPACE_CAPABILITY_PROVIDER_SCHEMA,
    capability: "orders",
    spaceTypes: ["food.pizzeria"],
    getSnapshot(space) {
      reads += 1;
      return {
        schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
        state: "ready",
        spaceId: space.id,
        metrics: { "orders.today": 1 },
      };
    },
    subscribe(listener) {
      providerListeners.add(listener);
      return () => providerListeners.delete(listener);
    },
  };
  const underlying = createSpaceExperienceSource({ providers: [provider] });
  const experience = createIdentityBoundSpaceExperienceSource({
    experienceSource: underlying,
    identitySessionPort: identity,
    spaceSelectionPort: selection,
    spacesPort: spaces,
  });
  return {
    identity, selection, spaces, experience, underlying,
    get reads() { return reads; },
    get providerSubscriptions() { return providerListeners.size; },
  };
}

test("host keeps the existing capability composer but exposes only the selected authorized Space", () => {
  const f = fixture();
  try {
    const current = f.experience.get(pizza);
    assert.equal(current.state, "ready");
    assert.ok(current.navigation.some((item) => item.id === "kitchen"));
    assert.deepEqual(current.widgets.map((item) => item.value), [1]);
    assert.equal(f.reads, 1);
    const foreign = f.experience.get(pizzaB);
    assert.equal(foreign.state, "unavailable");
    assert.deepEqual(foreign.capabilities, []);
    assert.deepEqual(foreign.navigation, []);
    assert.deepEqual(foreign.widgets, []);
    assert.equal(f.reads, 1, "never call provider for a Space outside current authorized selection");
  } finally { f.experience.dispose(); }
});

test("signout and account switch hide all data before touching any provider", () => {
  const f = fixture();
  try {
    assert.equal(f.experience.get(pizza).state, "ready");
    f.identity.set({ state: "signed-out" });
    assert.equal(f.experience.get(pizza).state, "unavailable");
    f.identity.set(signed("owner-b"));
    assert.equal(f.experience.get(pizza).state, "unavailable");
    f.selection.set(selected("owner-b", pizzaB));
    assert.equal(f.experience.get(pizzaB).state, "unavailable");
    f.spaces.set(ready([pizzaB]));
    assert.equal(f.experience.get(pizzaB).state, "ready");
    assert.equal(f.experience.get(pizza).state, "unavailable");
    assert.equal(f.reads, 2, "only the two currently authorized views reach the provider");
  } finally { f.experience.dispose(); }
});

test("catalog outage, revoked membership, archived Space and spoofed owner identity fail closed", () => {
  const f = fixture();
  try {
    const deny = () => {
      const result = f.experience.get(pizza);
      assert.equal(result.state, "unavailable");
      assert.deepEqual(result.capabilities, []);
      assert.equal(result.auraContext, null);
      assert.deepEqual(result.resources, []);
    };
    f.spaces.set({ schema: SPACES_SNAPSHOT_SCHEMA, state: "unavailable", spaces: [] });
    deny();
    f.spaces.set(ready([]));
    deny();
    f.spaces.set(ready([{ ...pizza, state: "archived" }]));
    deny();
    f.spaces.set(ready([{ ...pizza, ownerId: "other-owner" }]));
    deny();
    f.spaces.set(ready([pizza]));
    f.selection.set(selected("owner-a", { ...pizza, profilePack: "unexpected@1" }));
    deny();
    assert.equal(f.reads, 0);
  } finally { f.experience.dispose(); }
});

test("revocation during a provider read suppresses the just-produced projection", () => {
  const f = fixture();
  const originalGet = f.underlying.get;
  try {
    // Simulate a synchronous host selection change while a provider is read.
    const guarded = createIdentityBoundSpaceExperienceSource({
      experienceSource: {
        schema: f.underlying.schema,
        get(space) {
          const result = originalGet(space);
          f.selection.set({ schema: SPACE_SELECTION_SCHEMA, state: "unselected",
            subjectId: "owner-a", selectedSpace: null });
          return result;
        },
        subscribe(listener) { return f.underlying.subscribe(listener); },
      },
      identitySessionPort: f.identity,
      spaceSelectionPort: f.selection,
      spacesPort: f.spaces,
    });
    try {
      const result = guarded.get(pizza);
      assert.equal(result.state, "unavailable");
      assert.deepEqual(result.widgets, []);
    } finally { guarded.dispose(); }
  } finally { f.experience.dispose(); }
});

test("source signals revocation and tears down all host and provider listeners exactly once", () => {
  const f = fixture();
  let notified = 0;
  const unsubscribe = f.experience.subscribe(() => { notified += 1; });
  f.selection.set({ schema: SPACE_SELECTION_SCHEMA, state: "unselected",
    subjectId: "owner-a", selectedSpace: null });
  assert.ok(notified > 0);
  assert.equal(f.experience.get(pizza).state, "unavailable");
  unsubscribe();
  const oldCount = notified;
  f.identity.set({ state: "signed-out" });
  assert.equal(notified, oldCount);
  f.experience.dispose();
  f.experience.dispose();
  assert.equal(f.identity.listenerCount, 0);
  assert.equal(f.selection.listenerCount, 0);
  assert.equal(f.spaces.listenerCount, 0);
  assert.equal(f.providerSubscriptions, 0);
  assert.equal(f.experience.get(pizza).state, "unavailable");
  assert.equal(f.experience.subscribe(() => {} )() , undefined);
});
