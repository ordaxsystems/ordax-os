import assert from "node:assert/strict";
import test from "node:test";
import { createIntelligenceRuntime, createLocalAiRuntime } from "./runtime-adapter.mjs";

function localBackend() {
  const calls = { health: 0, completion: 0 };
  const runtime = createLocalAiRuntime({
    modelId: "qwen-small",
    fetchImpl: async url => {
      if (url.endsWith("/health")) {
        calls.health += 1;
        return { ok: true };
      }
      if (url.endsWith("/v1/chat/completions")) {
        calls.completion += 1;
        return {
          ok: true,
          async json() {
            return {
              model: "qwen-small",
              choices: [{ message: { role: "assistant", content: "safe answer" }, finish_reason: "stop" }],
            };
          },
        };
      }
      throw new Error("unexpected request");
    },
  });
  return { runtime, calls };
}

test("faulty Local AI observers cannot veto probe or leave the backend busy", async () => {
  const { runtime, calls } = localBackend();
  const states = [];
  runtime.subscribe(() => { throw new Error("broken UI observer"); });
  runtime.subscribe(snapshot => states.push(snapshot.state));
  try {
    assert.equal((await runtime.probe()).state, "ready");
    const result = await runtime.generate({ prompt: "safe inference" });
    assert.equal(result.text, "safe answer");
    assert.deepEqual(states, ["ready", "busy", "ready"]);
    assert.equal(runtime.getSnapshot().state, "ready");
    assert.deepEqual(calls, { health: 1, completion: 1 });
  } finally {
    runtime.dispose();
  }
});

test("faulty Intelligence observers cannot interfere with an authorized local response", async () => {
  const { runtime, calls } = localBackend();
  await runtime.probe();
  const intelligence = createIntelligenceRuntime({ inferencePort: runtime });
  const states = [];
  intelligence.subscribe(() => { throw new Error("broken Aura observer"); });
  intelligence.subscribe(snapshot => states.push(snapshot.state));
  try {
    const result = await intelligence.respond({ prompt: "consultative answer" });
    assert.equal(result.text, "safe answer");
    assert.equal(result.authority, "none");
    assert.deepEqual(states, ["busy", "ready"]);
    assert.equal(intelligence.getSnapshot().state, "ready");
    assert.deepEqual(calls, { health: 1, completion: 1 });
  } finally {
    intelligence.dispose();
    runtime.dispose();
  }
});

test("disposing Local AI inside busy notification prevents any inference HTTP request", async () => {
  const { runtime, calls } = localBackend();
  await runtime.probe();
  let busy = 0;
  runtime.subscribe(snapshot => {
    if (snapshot.state === "busy") {
      busy += 1;
      runtime.dispose();
    }
  });
  await assert.rejects(runtime.generate({ prompt: "must never leave the computer" }), /disposed/);
  assert.equal(busy, 1);
  assert.equal(calls.completion, 0, "no HTTP POST after synchronous disposal");
  assert.equal(calls.health, 1, "no hidden revalidation after disposal");
});

test("disposing Local AI inside ready notification refuses a completed response", async () => {
  const { runtime, calls } = localBackend();
  await runtime.probe();
  runtime.subscribe(snapshot => {
    if (snapshot.state === "ready") runtime.dispose();
  });
  await assert.rejects(runtime.generate({ prompt: "do not return after disposal" }), /disposed/);
  assert.equal(calls.completion, 1);
  assert.equal(calls.health, 1);
});

test("observers removed during notification are not called by a later iteration", async () => {
  const { runtime } = localBackend();
  let second = 0;
  let unsubscribeSecond = null;
  runtime.subscribe(() => unsubscribeSecond?.());
  unsubscribeSecond = runtime.subscribe(() => { second += 1; });
  try {
    await runtime.probe();
    assert.equal(second, 0);
  } finally {
    runtime.dispose();
  }
});
