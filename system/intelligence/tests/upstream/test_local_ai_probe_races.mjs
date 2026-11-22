// Regression adapted from ordax-os/tests/test_local_ai_probe_races.mjs @ 33aa6a14e1ae968229972be849025a44e0cae8f3
import assert from "node:assert/strict";
import test from "node:test";

import { createLocalAiRuntime } from "./runtime-adapter.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("an older health probe cannot publish ready over an active generation", async () => {
  const staleProbeResponse = deferred();
  const completion = deferred();
  let healthCalls = 0;

  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls === 1) return { ok: true };
        if (healthCalls === 2) return staleProbeResponse.promise;
        throw new Error("unexpected health request");
      }
      if (url.endsWith("/v1/chat/completions")) {
        await completion.promise;
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
          },
        };
      }
      throw new Error("unexpected request");
    },
  });

  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "ready");

  const staleProbe = runtime.probe();
  await Promise.resolve();
  assert.equal(healthCalls, 2);

  const generation = runtime.generate({ prompt: "primeira" });
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().state, "busy");

  staleProbeResponse.resolve({ ok: true });
  await staleProbe;
  assert.equal(runtime.getSnapshot().state, "busy");
  await assert.rejects(
    () => runtime.generate({ prompt: "não deve concorrer" }),
    /not ready/,
  );

  completion.resolve();
  await generation;
  assert.equal(runtime.getSnapshot().state, "ready");
});

test("only the newest concurrent probe may publish health state", async () => {
  const older = deferred();
  const newer = deferred();
  let healthCalls = 0;

  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (!url.endsWith("/health")) throw new Error("unexpected request");
      healthCalls += 1;
      if (healthCalls === 1) return { ok: true };
      if (healthCalls === 2) return older.promise;
      if (healthCalls === 3) return newer.promise;
      throw new Error("unexpected health request");
    },
  });

  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "ready");

  const olderProbe = runtime.probe();
  await Promise.resolve();
  const newerProbe = runtime.probe();
  await Promise.resolve();
  assert.equal(healthCalls, 3);

  newer.resolve({ ok: false });
  await newerProbe;
  assert.equal(runtime.getSnapshot().state, "error");

  older.resolve({ ok: true });
  await olderProbe;
  assert.equal(runtime.getSnapshot().state, "error");
});

test("a dynamic discovery cannot change the model used by concurrent inference before health", async () => {
  const secondHealthStarted = deferred();
  const secondHealth = deferred();
  const requestedModels = [];
  let discovery = 0;
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/v1/models")) {
        discovery += 1;
        const id = discovery === 1 ? "model-a" : "model-b";
        return { ok: true, async json() { return { data: [{ id }] }; } };
      }
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls === 2) {
          secondHealthStarted.resolve();
          return secondHealth.promise;
        }
        return { ok: true };
      }
      if (url.endsWith("/v1/chat/completions")) {
        const body = JSON.parse(options.body);
        requestedModels.push(body.model);
        return {
          ok: true,
          async json() {
            return {
              model: body.model,
              choices: [{
                message: { role: "assistant", content: "local response" },
                finish_reason: "stop",
              }],
            };
          },
        };
      }
      throw new Error("unexpected request");
    },
  });

  try {
    await runtime.probe();
    assert.equal(runtime.getSnapshot().modelId, "model-a");

    const pendingProbe = runtime.probe();
    await secondHealthStarted.promise;
    assert.equal(runtime.getSnapshot().state, "ready");
    assert.equal(runtime.getSnapshot().modelId, "model-a");

    // The previous implementation changed activeModelId to model-b as soon
    // as discovery completed, even though snapshot still advertised model-a.
    const completion = await runtime.generate({ prompt: "Use the approved model" });
    assert.equal(completion.modelId, "model-a");
    assert.equal(completion.text, "local response");
    assert.deepEqual(requestedModels, ["model-a"]);
    assert.equal(runtime.getSnapshot().modelId, "model-a");

    secondHealth.resolve({ ok: true });
    await pendingProbe;
    // Starting inference invalidated the pending health probe: never
    // promote the stale model-b identity over the completed model-a request.
    assert.equal(runtime.getSnapshot().modelId, "model-a");
    assert.equal(runtime.getSnapshot().state, "ready");
  } finally {
    secondHealth.resolve({ ok: true });
    runtime.dispose();
  }
});

test("a new dynamic model becomes authoritative only after its current health response", async () => {
  const secondHealthStarted = deferred();
  const secondHealth = deferred();
  let discovery = 0;
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/models")) {
        discovery += 1;
        const id = discovery === 1 ? "model-a" : "model-b";
        return { ok: true, async json() { return { data: [{ id }] }; } };
      }
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls === 2) {
          secondHealthStarted.resolve();
          return secondHealth.promise;
        }
        return { ok: true };
      }
      throw new Error("unexpected request");
    },
  });

  try {
    await runtime.probe();
    const pendingProbe = runtime.probe();
    await secondHealthStarted.promise;
    assert.equal(runtime.getSnapshot().state, "ready");
    assert.equal(runtime.getSnapshot().modelId, "model-a");
    secondHealth.resolve({ ok: true });
    await pendingProbe;
    assert.equal(runtime.getSnapshot().state, "ready");
    assert.equal(runtime.getSnapshot().modelId, "model-b");
  } finally {
    secondHealth.resolve({ ok: true });
    runtime.dispose();
  }
});
