import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWindowsLocalAiPackage } from "../system/adapters/desktop/local-ai-package.mjs";

const NAMES = ["ggml-base.dll", "ggml-cpu.dll", "ggml.dll", "llama-common.dll",
  "llama-server-impl.dll", "llama-server.exe", "llama.dll", "mtmd.dll"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ordax-windows-ai-verifier-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, "engine"));
  await mkdir(join(root, "models"));
  const engineFiles = [];
  for (const name of NAMES) {
    const bytes = Buffer.from("unique-exact-fixture:" + name);
    await writeFile(join(root, "engine", name), bytes);
    engineFiles.push({ name, sha256: sha(bytes), size_bytes: bytes.length });
  }
  const modelBytes = Buffer.from("fake-model-only-for-verifier-test");
  const modelFile = "verified-fixture.gguf";
  await writeFile(join(root, "models", modelFile), modelBytes);
  const lock = {
    $schema: "prototype-ordax.local-ai-source-lock/1",
    engine: { id: "llama.cpp", commit: "a".repeat(40), windows_artifact: {
      platform: "windows-x86_64", binary_format: "PE", architecture: "x64",
      source_commit: "a".repeat(40), model_sha256: sha(modelBytes),
      files: engineFiles,
    }},
    model: { id: "test-only-model", format: "GGUF",
      filename: modelFile, sha256: sha(modelBytes), size_bytes: modelBytes.length },
  };
  return { root, lock, readLock: async () => lock };
}

test("Windows model/EXE/DLL package verifies exact OS source lock and independent files", async t => {
  const data = await fixture(t);
  const installed = await verifyWindowsLocalAiPackage(data.root, data);
  assert.equal(installed.modelId, "test-only-model");
  const canonical = await realpath(data.root);
  assert.equal(installed.executable, join(canonical, "engine", "llama-server.exe"));
  assert.equal(installed.modelFile, join(canonical, "models", "verified-fixture.gguf"));
});

test("Windows package rejects absent files, corrupt model, incorrect engine and source pin", async t => {
  const data = await fixture(t);
  await writeFile(join(data.root, "models", "verified-fixture.gguf"), "different model");
  await assert.rejects(verifyWindowsLocalAiPackage(data.root, data), /corrupt|digest mismatch/);
  data.lock.model.size_bytes = "wrong";
  await assert.rejects(verifyWindowsLocalAiPackage(data.root, data), /source lock/);
  data.lock.model.size_bytes = 33;
  data.lock.engine.windows_artifact.source_commit = "b".repeat(40);
  await assert.rejects(verifyWindowsLocalAiPackage(data.root, data), /pin unavailable/);
});

test("Windows package never accepts extra models or omitted DLL pin as successful proof", async t => {
  const data = await fixture(t);
  data.lock.engine.windows_artifact.files.pop();
  await assert.rejects(verifyWindowsLocalAiPackage(data.root, data), /pin unavailable/);
  data.lock.engine.windows_artifact.files.push({ name: "../../unsafe.dll", sha256: "a".repeat(64), size_bytes: 15 });
  await assert.rejects(verifyWindowsLocalAiPackage(data.root, data), /binary pin/);
});
