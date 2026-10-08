import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_LOCAL_AI_MODEL_CANDIDATE } from "../system/services/local-ai/model-candidate.generated.mjs";
import { assessBundledLocalAiModel } from "../system/services/local-ai/model-compatibility.mjs";
import { appendStoreLocalAiModels } from "../system/surface/ui/store-model-catalog.mjs";

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

test("Store Model UI offers compatibility check only, not fabricated lifecycle buttons", () => {
  class FakeNode {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.textContent = "";
    }
    append(...children) { this.children.push(...children); }
    setAttribute(k, v) { this.attributes[k] = v; }
  }
  const doc = { createElement(tag) { return new FakeNode(tag); } };
  const root = new FakeNode("main");
  appendStoreLocalAiModels(doc, root, {
    t: (key) => key,
    hardware: hardware("x86_64"),
    metrics: metrics(),
    systemUpdatesAvailable: true,
  });
  const all = (value) => [value, ...value.children.flatMap(all)];
  const nodes = all(root);
  const buttons = nodes.filter((x) => x.tag === "button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].dataset.storeModelsRefresh, "true");
  assert.equal(buttons[1].dataset.storeModelSystemUpdates, "true");
  assert.equal(nodes.some((x) => x.dataset.storeOperation || x.dataset.storeAppId), false);
  assert.equal(nodes.find((x) => x.dataset.storeModelsView === "true").dataset.storeModelAuthority, "none");
});
