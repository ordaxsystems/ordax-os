import assert from "node:assert/strict";
import test from "node:test";

import {
  defineSemanticIndexDescriptor,
  defineSemanticIndexRecord,
  semanticIndexNeedsRebuild,
  semanticRecordIsCurrent,
} from "../system/contracts/semantic-index.mjs";

function descriptor(overrides = {}) {
  return {
    id: "device-memory-v1",
    version: "0.1.0",
    ownerKind: "device",
    ownerId: "device-owner",
    spaceId: "space-dev",
    projectId: "project-ordax",
    embeddingModelId: "ordax-embed-small",
    embeddingArtifactSha256: "a".repeat(64),
    dimensions: 384,
    distance: "cosine",
    rebuildable: true,
    sourceOfTruth: false,
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    indexId: "device-memory-v1",
    sourceKind: "memory",
    sourceId: "memory:fact-1",
    contentSha256: "b".repeat(64),
    sourceTimestamp: "2026-09-28T12:00:00Z",
    vector: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

test("semantic index is explicitly derived and rebuildable", () => {
  const value = defineSemanticIndexDescriptor(descriptor());
  assert.equal(value.rebuildable, true);
  assert.equal(value.sourceOfTruth, false);
});

test("record freshness is bound to source identity and content hash", () => {
  assert.equal(semanticRecordIsCurrent(record(), {
    sourceKind: "memory",
    sourceId: "memory:fact-1",
    contentSha256: "b".repeat(64),
  }), true);
  assert.equal(semanticRecordIsCurrent(record(), {
    sourceKind: "memory",
    sourceId: "memory:fact-1",
    contentSha256: "c".repeat(64),
  }), false);
});

test("embedding identity change requires rebuild instead of memory migration", () => {
  const runtime = {
    embeddingModelId: "ordax-embed-small",
    embeddingArtifactSha256: "a".repeat(64),
    dimensions: 384,
    distance: "cosine",
  };
  assert.equal(semanticIndexNeedsRebuild(descriptor(), runtime), false);
  assert.equal(semanticIndexNeedsRebuild(descriptor(), {
    ...runtime,
    embeddingArtifactSha256: "d".repeat(64),
  }), true);
  assert.equal(semanticIndexNeedsRebuild(descriptor(), {
    ...runtime,
    dimensions: 768,
  }), true);
});

test("vectors are bounded and must contain finite numbers", () => {
  assert.throws(() => defineSemanticIndexRecord(record({ vector: [0.1, Number.NaN] })), /non-finite/);
});
