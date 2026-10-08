import assert from "node:assert/strict";
import test from "node:test";

import {
  SCOPED_SEMANTIC_RETRIEVAL_SCHEMA,
  rankScopedSemanticRecords,
} from "../system/services/intelligence/semantic-retrieval.mjs";

const scope = Object.freeze({
  ownerKind: "account", ownerId: "account-1",
  spaceId: "space-pizzaria", projectId: null,
});
const sha = (char) => char.repeat(64);

function descriptor(overrides = {}) {
  return {
    id: "professional-knowledge-v1", version: "1.0.0",
    embeddingModelId: "local-embed-v1",
    embeddingArtifactSha256: sha("a"), dimensions: 3, distance: "cosine",
    rebuildable: true, sourceOfTruth: false,
    ...scope, ...overrides,
  };
}

function source(id, char = "b", overrides = {}) {
  return {
    sourceKind: "profile-knowledge", sourceId: id,
    contentSha256: sha(char), ...scope, ...overrides,
  };
}

function record(id, vector, char = "b", overrides = {}) {
  return {
    indexId: "professional-knowledge-v1",
    sourceKind: "profile-knowledge", sourceId: id,
    contentSha256: sha(char), sourceTimestamp: "2026-10-08T12:00:00Z",
    vector, ...overrides,
  };
}

function run(overrides = {}) {
  return rankScopedSemanticRecords({
    index: descriptor(),
    runtime: {
      embeddingModelId: "local-embed-v1",
      embeddingArtifactSha256: sha("a"), dimensions: 3, distance: "cosine",
    },
    authorizationScope: scope,
    authorizedSources: [source("a"), source("b"), source("c")],
    records: [
      record("a", [0, 1, 0]),
      record("b", [1, 0, 0]),
      record("c", [1, 1, 0]),
    ],
    queryVector: [1, 0, 0],
    ...overrides,
  });
}

test("semantic ranking is deterministic and returns identities without source text", () => {
  const ranked = run();
  assert.equal(ranked.schema, SCOPED_SEMANTIC_RETRIEVAL_SCHEMA);
  assert.equal(ranked.state, "ready");
  assert.deepEqual(ranked.matches.map((item) => item.sourceId), ["b", "c", "a"]);
  assert.deepEqual(ranked.matches[0], {
    sourceKind: "profile-knowledge", sourceId: "b",
    contentSha256: sha("b"), score: 1,
  });
  assert.ok(Object.isFrozen(ranked.matches));
  assert.equal("text" in ranked.matches[0], false);
  assert.deepEqual(run(), ranked);
});

test("owner, Space and project are exact access boundaries, not ranking preferences", () => {
  for (const override of [
    { ownerId: "account-2" },
    { spaceId: "space-outro" },
    { projectId: "project-outro" },
    { ownerKind: "device" },
  ]) {
    assert.throws(
      () => run({ authorizationScope: { ...scope, ...override } }),
      /does not belong to the authorized scope/,
    );
    assert.throws(
      () => run({
        authorizedSources: [source("a", "b", override)],
      }),
      /crosses owner or Space/,
    );
  }
});

test("unauthorized records do not enter scoring or vector materialization", () => {
  const poisoned = {
    ...record("private-account-2", null, "f"),
    sourceKind: "private-memory",
    vector: new Proxy([], {
      get() { throw new Error("Unauthorized vector was accessed"); },
    }),
  };
  const result = run({
    authorizedSources: [source("b")],
    records: [poisoned, record("b", [1, 0, 0])],
  });
  assert.deepEqual(result.matches.map((entry) => entry.sourceId), ["b"]);
});

test("a stale content hash or foreign index is never ranked", () => {
  const result = run({
    authorizedSources: [source("a", "b"), source("b", "c")],
    records: [
      record("a", [1, 0, 0], "f"), // stale source content
      record("b", [1, 0, 0], "c", { indexId: "foreign-index" }),
    ],
  });
  assert.deepEqual(result.matches, []);
});

test("embedding model, artifact, dimension, and distance changes fail closed", () => {
  const current = {
    embeddingModelId: "local-embed-v1",
    embeddingArtifactSha256: sha("a"), dimensions: 3, distance: "cosine",
  };
  for (const change of [
    { embeddingModelId: "local-embed-v2" },
    { embeddingArtifactSha256: sha("c") },
    { dimensions: 768 },
    { distance: "dot" },
  ]) {
    const result = run({ runtime: { ...current, ...change } });
    assert.equal(result.state, "rebuild-required");
    assert.deepEqual(result.matches, []);
  }
});

test("reject invalid input vectors, duplicates and derived-index authority changes", () => {
  assert.throws(() => run({ queryVector: [1, Number.NaN, 0] }), /non-finite/);
  assert.throws(() => run({ queryVector: [1, 0] }), /dimensions/);
  assert.throws(() => run({ queryVector: [0, 0, 0] }), /zero vector/);
  assert.throws(
    () => run({ records: [record("a", [0, 0, 0])] }),
    /zero vector/,
  );
  assert.throws(() => run({ records: [record("a", [1, 0, 0]), record("a", [0, 1, 0])] }),
    /Duplicate current semantic record/);
  assert.throws(() => run({ authorizedSources: [source("a"), source("a")] }),
    /Duplicate semantic authorized source/);
  assert.throws(() => run({ index: descriptor({ sourceOfTruth: true }) }),
    /derived, rebuildable/);
  assert.throws(() => run({ index: descriptor({ rebuildable: false }) }),
    /derived, rebuildable/);
  assert.throws(() => run({ limit: 33 }), /limit is outside bounds/);
});

test("distance metrics are correct and score ties have stable source ordering", () => {
  const pairs = [
    ["dot", [1, 0, 0], [2, 0, 0], [0, 1, 0], ["a", "b"]],
    ["l2", [1, 0, 0], [1, 0, 0], [4, 0, 0], ["a", "b"]],
  ];
  for (const [distance, query, first, second, expected] of pairs) {
    const result = run({
      index: descriptor({ distance }),
      runtime: {
        embeddingModelId: "local-embed-v1", embeddingArtifactSha256: sha("a"),
        dimensions: 3, distance,
      },
      queryVector: query,
      authorizedSources: [source("a"), source("b")],
      records: [record("a", first), record("b", second)],
    });
    assert.deepEqual(result.matches.map((item) => item.sourceId), expected);
  }
  const tied = run({
    records: [record("c", [1, 0, 0]), record("a", [1, 0, 0])],
    limit: 2,
  });
  assert.deepEqual(tied.matches.map((item) => item.sourceId), ["a", "c"]);
});

test("a result limit does not modify or overwrite canonical Memory/Knowledge", () => {
  const entries = [record("a", [1, 0, 0]), record("b", [0, 1, 0])];
  const before = structuredClone(entries);
  const result = run({
    authorizedSources: [source("a"), source("b")],
    records: entries, limit: 1,
  });
  assert.equal(result.matches.length, 1);
  assert.deepEqual(entries, before);
});


test("scoring refuses an excessively large vector workload", () => {
  assert.throws(
    () => run({
      index: descriptor({ dimensions: 4097 }),
      runtime: {
        embeddingModelId: "local-embed-v1",
        embeddingArtifactSha256: sha("a"),
        dimensions: 4097,
        distance: "cosine",
      },
      records: [],
      authorizedSources: [],
    }),
    /scoring budget/,
  );
  assert.throws(
    () => run({
      authorizedSources: [source("a", "b", { sourceId: "../escape" })],
    }),
    /identity is invalid/,
  );
  assert.throws(
    () => run({ authorizedSources: [source("a", "b", { sourceKind: "X".repeat(49) })] }),
    /identity is invalid/,
  );
});
