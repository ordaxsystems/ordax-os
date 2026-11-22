// OS technical compatibility tests @ c950dcec6e8a6b36a104907438ca8347380a8b53; Store presentation stays OS-owned.
import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "../../../../system/services/local-ai/model-candidate.generated.mjs";
import { assessBundledLocalAiModel } from "./runtime-adapter.mjs";

const hardware = (architecture) => ({
  schema: "ordax.hardware-inventory/1",
  architecture,
  kernelAbi: "6.6",
  devices: [],
});
const metrics = (memoryTotalBytes = 8 * 1024 ** 3) => ({
  uptimeSeconds: 200,
  memoryTotalBytes,
  memoryAvailableBytes: Math.min(memoryTotalBytes, 4 * 1024 ** 3),
  userStorageTotalBytes: 40 * 1024 ** 3,
  userStorageFreeBytes: 20 * 1024 ** 3,
});

test("model preview is read-only and cannot impersonate a signed install/update", () => {
  const candidate = BUNDLED_LOCAL_AI_MODEL_CANDIDATE;
  assert.equal(candidate.id, "qwen3.5-0.8b-q4_0");
  assert.equal(candidate.artifactPlatform, "linux-x86_64");
  assert.equal(candidate.license, "Apache-2.0");
  assert.equal(candidate.engineLicense, "MIT");
  assert.equal(candidate.independentInstallAvailable, false);
  assert.equal(candidate.independentUpdateAvailable, false);
  assert.equal(candidate.memoryMinimumBytes, null);
});

test("architecture mismatch is blocked independently of RAM and free storage", () => {
  const result = assessBundledLocalAiModel({
    hardware: hardware("aarch64"),
    metrics: metrics(64 * 1024 ** 3),
  });
  assert.equal(result.status, "blocked-architecture");
  assert.equal(result.architectureMatches, false);
  assert.equal(result.installedOrUpdateVerified, false);
});

test("matching architecture cannot assert qualified performance without evidence", () => {
  for (const mem of [512 * 1024, 8 * 1024 ** 3, 64 * 1024 ** 3]) {
    const result = assessBundledLocalAiModel({
      hardware: hardware("AMD64"),
      metrics: metrics(mem),
    });
    assert.equal(result.status, "architecture-compatible-performance-unverified");
    assert.equal(result.minimumMemoryBytes, null);
    assert.equal(result.minimumInstallStorageBytes, null);
    assert.equal(result.benchmarkQualified, false);
    assert.equal(result.modelAndEngineBytesLowerBound,
      BUNDLED_LOCAL_AI_MODEL_CANDIDATE.modelBytes + BUNDLED_LOCAL_AI_MODEL_CANDIDATE.engineBytes);
  }
});

test("compatibility storage lower bound must remain an exact safe integer", () => {
  const pinned = BUNDLED_LOCAL_AI_MODEL_CANDIDATE;
  // Each source field can be individually safe while their sum is not.
  const overflow = {
    ...pinned,
    modelBytes: Number.MAX_SAFE_INTEGER - 1,
    engineBytes: 2,
  };
  assert.equal(Number.isSafeInteger(overflow.modelBytes), true);
  assert.equal(Number.isSafeInteger(overflow.engineBytes), true);
  assert.throws(
    () => assessBundledLocalAiModel({ candidate: overflow, hardware: hardware("x86_64") }),
    /not a reviewed read-only release preview/,
  );

  // Exactly at the representable boundary the original byte-count
  // semantics remain unchanged (without inventing installation approval).
  const boundary = {
    ...pinned,
    modelBytes: Number.MAX_SAFE_INTEGER - 1,
    engineBytes: 1,
  };
  const result = assessBundledLocalAiModel({ candidate: boundary, hardware: hardware("AMD64") });
  assert.equal(result.modelAndEngineBytesLowerBound, Number.MAX_SAFE_INTEGER);
  assert.equal(result.benchmarkQualified, false);
  assert.equal(result.installedOrUpdateVerified, false);
  assert.equal(result.independentInstallAvailable, false);
});

test("absent device read is unknown even when host RAM and storage are available", () => {
  const result = assessBundledLocalAiModel({ metrics: metrics() });
  assert.equal(result.status, "device-not-assessed");
  assert.equal(result.architectureMatches, null);
  assert.equal(result.installedOrUpdateVerified, false);
});

test("rejects malformed host hardware instead of assuming device compatibility", () => {
  assert.throws(() => assessBundledLocalAiModel({
    hardware: { architecture: "x86_64", devices: "broken" },
  }), TypeError);
});
