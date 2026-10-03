import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceMemoryCanonicalGeneration,
  createMemoryStorageManifest,
  markMemoryIndexReady,
} from "../system/contracts/memory-evolution.mjs";
import { createMemoryEvolutionRegistry } from "../system/services/memory/evolution.mjs";

function migration(from, mutateState = (state) => state) {
  return {
    id: `memory.format-${from}-to-${from + 1}`,
    from,
    to: from + 1,
    migrate({ manifest, state }) {
      return {
        manifest: { ...manifest, storageFormat: from + 1 },
        state: mutateState(state),
      };
    },
  };
}

test("memory manifest separates canonical memory generation from rebuildable semantic index", () => {
  const initial = createMemoryStorageManifest({ ownerKind: "account", ownerId: "user-1" });
  const changed = advanceMemoryCanonicalGeneration(initial);
  const indexed = markMemoryIndexReady(changed, { modelId: "embedding-model-v1", generation: 1 });
  const changedAgain = advanceMemoryCanonicalGeneration(indexed);

  assert.equal(indexed.index.state, "ready");
  assert.equal(indexed.index.sourceGeneration, 1);
  assert.equal(changedAgain.canonicalGeneration, 2);
  assert.equal(changedAgain.index.state, "stale");
  assert.equal(changedAgain.index.sourceGeneration, 1);
});

test("memory evolution plans explicit sequential upgrades and preserves owner", () => {
  const registry = createMemoryEvolutionRegistry({
    currentFormat: 3,
    migrations: [
      migration(1, (state) => ({ ...state, format2: true })),
      migration(2, (state) => ({ ...state, format3: true })),
    ],
  });
  const manifest = createMemoryStorageManifest({ ownerKind: "device" });
  const result = registry.migrate({ manifest, state: { items: ["one"] } });

  assert.deepEqual(registry.plan(1).map((step) => step.id), [
    "memory.format-1-to-2",
    "memory.format-2-to-3",
  ]);
  assert.equal(result.manifest.storageFormat, 3);
  assert.equal(result.manifest.ownerKind, "device");
  assert.equal(result.manifest.ownerId, null);
  assert.deepEqual(result.state, { items: ["one"], format2: true, format3: true });
});

test("memory evolution refuses downgrade, gaps and owner changes", () => {
  const registry = createMemoryEvolutionRegistry({ currentFormat: 2, migrations: [migration(1)] });
  assert.throws(() => registry.plan(3), /downgrade is refused/);
  assert.throws(
    () => createMemoryEvolutionRegistry({ currentFormat: 3, migrations: [migration(1)] }).plan(1),
    /Missing memory migration 2 -> 3/,
  );

  const malicious = createMemoryEvolutionRegistry({
    currentFormat: 2,
    migrations: [{
      id: "memory.bad-owner",
      from: 1,
      to: 2,
      migrate({ manifest, state }) {
        return {
          manifest: { ...manifest, ownerKind: "account", ownerId: "other", storageFormat: 2 },
          state,
        };
      },
    }],
  });
  assert.throws(
    () => malicious.migrate({ manifest: createMemoryStorageManifest({ ownerKind: "device" }), state: {} }),
    /changed memory owner/,
  );
});
