import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_ARTIFACT_SCHEMA,
  defineIntelligenceArtifact,
  isArtifactCompatible,
} from "../system/contracts/intelligence-artifact.mjs";

function model(overrides = {}) {
  return {
    id: "qwen3.5-0.8b-q4_0",
    kind: "model",
    version: "0.1.0",
    architecture: "x86_64",
    activationMode: "component-slot",
    sha256: "a".repeat(64),
    sizeBytes: 563036064,
    source: {
      uri: "https://example.invalid/model.gguf",
      revision: "9447f74",
      license: "Apache-2.0",
    },
    compatibility: {
      intelligenceContractMajor: 1,
      localAiContractMajor: 1,
      runtimeApis: ["openai-compatible-loopback"],
      requires: ["local-inference"],
      conflicts: [],
    },
    resources: {
      minRamMiB: 2048,
      minDiskMiB: 768,
      acceleratorOptional: true,
    },
    security: {
      signatureRequired: true,
      provenanceRequired: true,
      runtimeNetworkAllowed: false,
      mutableHostAccessAllowed: false,
    },
    ...overrides,
  };
}

test("artifact manifest freezes canonical supply-chain identity", () => {
  const artifact = defineIntelligenceArtifact(model());
  assert.equal(artifact.schema, INTELLIGENCE_ARTIFACT_SCHEMA);
  assert.equal(artifact.kind, "model");
  assert.equal(artifact.security.signatureRequired, true);
  assert.equal(artifact.security.provenanceRequired, true);
  assert.equal(artifact.security.runtimeNetworkAllowed, false);
  assert.equal(Object.isFrozen(artifact), true);
});

test("compatibility requires contracts, resources, runtime APIs and capabilities", () => {
  const environment = {
    architecture: "x86_64",
    ramMiB: 4096,
    diskMiB: 2048,
    intelligenceContractMajor: 1,
    localAiContractMajor: 1,
    runtimeApis: ["openai-compatible-loopback"],
    capabilities: ["local-inference"],
  };
  assert.equal(isArtifactCompatible(model(), environment), true);
  assert.equal(isArtifactCompatible(model(), { ...environment, ramMiB: 1024 }), false);
  assert.equal(isArtifactCompatible(model(), { ...environment, intelligenceContractMajor: 2 }), false);
  assert.equal(isArtifactCompatible(model(), { ...environment, runtimeApis: [] }), false);
});

test("prompt-visible metadata cannot weaken signed artifact policy", () => {
  assert.throws(
    () => defineIntelligenceArtifact(model({
      sha256: "not-a-hash",
    })),
    /sha256/,
  );
  assert.throws(
    () => defineIntelligenceArtifact(model({
      architecture: "unknown-cpu",
    })),
    /architecture/,
  );
});

test("conflicting host capability blocks activation", () => {
  const artifact = model({
    compatibility: {
      intelligenceContractMajor: 1,
      localAiContractMajor: 1,
      runtimeApis: ["openai-compatible-loopback"],
      requires: ["local-inference"],
      conflicts: ["legacy-ai-runtime"],
    },
  });
  assert.equal(isArtifactCompatible(artifact, {
    architecture: "x86_64",
    ramMiB: 4096,
    diskMiB: 2048,
    intelligenceContractMajor: 1,
    localAiContractMajor: 1,
    runtimeApis: ["openai-compatible-loopback"],
    capabilities: ["local-inference", "legacy-ai-runtime"],
  }), false);
});
