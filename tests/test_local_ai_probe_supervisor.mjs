import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_AI_PORT_SCHEMA } from "../system/contracts/local-ai.mjs";
import { createLocalAiProbeSupervisor } from "../system/services/local-ai/probe-supervisor.mjs";

function fakePort() {
  let state = "unavailable";
  let reachable = false;
  let calls = 0;
  const listeners = new Set();
  const publish = (value) => {
    state = value;
    for (const listener of listeners) listener(snapshot());
  };
  const snapshot = () => ({
    schema: LOCAL_AI_PORT_SCHEMA,
    state,
    engineId: state === "ready" || state === "busy" ? "llama.cpp" : null,
    modelId: state === "ready" || state === "busy" ? "model-a" : null,
    offline: true,
    migratable: true,
  });
  return {
    schema: LOCAL_AI_PORT_SCHEMA,
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async probe() {
      calls += 1;
      publish(reachable ? "ready" : "unavailable");
      return snapshot();
    },
    async generate() { throw new Error("not used"); },
    setReachable(value) { reachable = value; },
    publish,
    get calls() { return calls; },
    get listenerCount() { return listeners.size; },
  };
}

function clock() {
  let serial = 0;
  const pending = new Map();
  const history = [];
  return {
    schedule(callback, delay) {
      const id = ++serial;
      history.push(delay);
      pending.set(id, callback);
      return id;
    },
    cancel(id) { pending.delete(id); },
    fire() {
      const first = pending.entries().next();
      if (first.done) throw new Error("no timer scheduled");
      const [id, callback] = first.value;
      pending.delete(id);
      callback();
    },
    get size() { return pending.size; },
    history,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Native Local AI recovers when engine becomes ready after Surface boot", async () => {
  const port = fakePort();
  const timer = clock();
  const supervisor = createLocalAiProbeSupervisor({
    localPort: port, schedule: timer.schedule, cancel: timer.cancel,
  });
  supervisor.start();
  await settle();
  assert.equal(port.calls, 1);
  assert.equal(timer.size, 1);
  assert.deepEqual(timer.history, [2000]);
  port.setReachable(true);
  timer.fire();
  await settle();
  assert.equal(port.calls, 2);
  assert.equal(port.getSnapshot().state, "ready");
  assert.equal(timer.size, 0);
  supervisor.dispose();
  assert.equal(port.listenerCount, 0);
});

test("Native Local AI re-probes after an unexpected backend loss", async () => {
  const port = fakePort();
  port.setReachable(true);
  const timer = clock();
  const supervisor = createLocalAiProbeSupervisor({
    localPort: port, schedule: timer.schedule, cancel: timer.cancel,
  });
  supervisor.start();
  await settle();
  assert.equal(timer.size, 0);
  port.setReachable(false);
  port.publish("unavailable");
  assert.equal(timer.size, 1);
  timer.fire();
  await settle();
  assert.equal(timer.size, 1);
  port.setReachable(true);
  timer.fire();
  await settle();
  assert.equal(timer.size, 0);
  assert.equal(port.getSnapshot().state, "ready");
  supervisor.dispose();
});

test("Native Local AI retry is bounded and never invokes model generation", async () => {
  const port = fakePort();
  const timer = clock();
  const supervisor = createLocalAiProbeSupervisor({
    localPort: port, schedule: timer.schedule, cancel: timer.cancel,
  });
  supervisor.start();
  await settle();
  for (let index = 0; index < 9; index += 1) {
    assert.equal(timer.size, 1);
    timer.fire();
    await settle();
  }
  assert.equal(Math.max(...timer.history), 60000);
  assert.equal(timer.history[0], 2000);
  assert.equal(timer.history[1], 4000);
  assert.equal(timer.history[2], 8000);
  supervisor.dispose();
  assert.equal(timer.size, 0);
  supervisor.dispose();
});

test("Native Local AI pending retries are revoked at composition disposal", async () => {
  const port = fakePort();
  const timer = clock();
  const supervisor = createLocalAiProbeSupervisor({
    localPort: port, schedule: timer.schedule, cancel: timer.cancel,
  });
  supervisor.start();
  supervisor.start();
  await settle();
  assert.equal(port.calls, 1);
  assert.equal(timer.size, 1);
  supervisor.dispose();
  assert.equal(timer.size, 0);
  assert.equal(port.listenerCount, 0);
  assert.throws(() => supervisor.start(), /disposed/);
});
