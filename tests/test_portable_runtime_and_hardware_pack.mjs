import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPortableState,
  definePortableRuntimePolicy,
  planPortableRuntimeResources,
} from "../system/contracts/portable-runtime-policy.mjs";
import {
  defineHardwarePack,
  hardwarePackMatches,
} from "../system/contracts/hardware-pack.mjs";

const policy = {
  mediaClass: "removable-flash",
  volatileCacheRatio: 0.10,
  volatileCacheMinBytes: 16 * 1024 * 1024,
  volatileCacheMaxBytes: 256 * 1024 * 1024,
  preserveAvailableMemoryBytes: 512 * 1024 * 1024,
  persistentWriteBatchMs: 250,
  zram: {
    allowed: true,
    backingWritebackAllowed: false,
    maxMemoryRatio: 0.25,
  },
};

test("portable runtime keeps caches memory-first and zram writeback off USB", () => {
  const value = definePortableRuntimePolicy(policy);
  assert.equal(value.mediaClass, "removable-flash");
  assert.equal(value.zram.allowed, true);
  assert.equal(value.zram.backingWritebackAllowed, false);
  assert.equal(value.cachePolicy.durable, "atomic-persistent");
});

test("portable runtime resource plan preserves memory before allocating volatile cache", () => {
  const plan = planPortableRuntimeResources(policy, {
    memoryAvailableBytes: 2 * 1024 * 1024 * 1024,
    userStorageFreeBytes: 16 * 1024 * 1024 * 1024,
  });
  assert.ok(plan.volatileCacheBytes <= 256 * 1024 * 1024);
  assert.equal(plan.zramBackingWritebackAllowed, false);
  assert.equal(plan.semanticIndexPersistence, "derived-batched");
});

test("portable state classification never persists ephemeral cache", () => {
  assert.equal(classifyPortableState("ephemeral").persistent, false);
  assert.equal(classifyPortableState("rebuildable").rebuildable, true);
  assert.equal(classifyPortableState("durable").persistent, true);
});

function pack(overrides = {}) {
  return {
    id: "wifi-intel-pack",
    version: "0.1.0",
    type: "wifi",
    architecture: "x86_64",
    sha256: "a".repeat(64),
    sourceRevision: "linux-6.6.52+firmware-2026-09",
    license: "mixed-reviewed",
    modaliases: ["pci:v00008086d00002723"],
    kernelModules: ["iwlwifi", "iwlmvm"],
    firmwareFiles: ["iwlwifi-example.ucode"],
    activation: {
      bootCritical: false,
      rebootRequired: true,
      componentSlotRequired: true,
      signedManifestRequired: true,
    },
    ...overrides,
  };
}

test("hardware pack requires signed component-slot semantics and exact modalias match", () => {
  const value = defineHardwarePack(pack());
  assert.equal(value.activation.componentSlotRequired, true);
  assert.equal(value.activation.signedManifestRequired, true);
  assert.equal(hardwarePackMatches(value, {
    architecture: "x86_64",
    modalias: "pci:v00008086d00002723",
  }), true);
  assert.equal(hardwarePackMatches(value, {
    architecture: "x86_64",
    modalias: "pci:v00008086d0000ffff",
  }), false);
});

test("hardware pack refuses unsupported architecture", () => {
  assert.throws(() => defineHardwarePack(pack({ architecture: "riscv64" })), /architecture/);
});
