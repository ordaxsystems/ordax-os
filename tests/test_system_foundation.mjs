import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_CAPABILITY_STATE_SCHEMA,
  SYSTEM_POLICY_DECISION_SCHEMA,
  SYSTEM_SERVICE_DESCRIPTOR_SCHEMA,
} from "../system/contracts/system-foundation.mjs";
import { createSystemFoundationRuntime } from "../system/services/system-foundation/runtime.mjs";

const capability = (id, available = true) => ({
  schema: SYSTEM_CAPABILITY_STATE_SCHEMA,
  id,
  available,
  source: "test.runtime",
});

const service = (id, dependencies = [], optionalDependencies = []) => ({
  schema: SYSTEM_SERVICE_DESCRIPTOR_SCHEMA,
  id,
  dependencies,
  optionalDependencies,
  capabilities: [],
  critical: false,
});

const decision = (effect, source) => ({
  schema: SYSTEM_POLICY_DECISION_SCHEMA,
  effect,
  reasonCode: `test.${effect}`,
  source,
});

test("system foundation resolves lifecycle dependencies deterministically", () => {
  const runtime = createSystemFoundationRuntime({
    services: [
      service("personal.ordax", ["intelligence.system", "memory.system"]),
      service("memory.system", ["identity.system"]),
      service("identity.system"),
      service("intelligence.system", ["memory.system"]),
    ],
  });
  assert.deepEqual(runtime.lifecycle.order(), [
    "identity.system",
    "memory.system",
    "intelligence.system",
    "personal.ordax",
  ]);
});

test("system foundation fails closed on missing dependencies and cycles", () => {
  assert.throws(
    () => createSystemFoundationRuntime({ services: [service("personal.ordax", ["memory.system"])] }),
    /missing dependency/,
  );
  assert.throws(
    () => createSystemFoundationRuntime({
      services: [service("a.system", ["b.system"]), service("b.system", ["a.system"])],
    }),
    /dependency cycle/,
  );
});

test("capability registry records availability but never creates authority", () => {
  let tick = 0;
  const runtime = createSystemFoundationRuntime({
    capabilities: [capability("intelligence.system")],
    clock: () => `2026-10-03T00:00:0${tick++}.000Z`,
  });
  assert.equal(runtime.capabilities.isAvailable("intelligence.system"), true);
  const state = runtime.capabilities.set({
    id: "studio.runtime",
    available: false,
    source: "device.agent",
    reason: "runtime-not-ready",
  });
  assert.equal(state.authority, "none");
  assert.equal(runtime.capabilities.isAvailable("studio.runtime"), false);
  assert.equal(runtime.events.list()[0].subjectId, "studio.runtime");
  assert.equal(runtime.events.list()[0].authority, "none");
});

test("policy aggregation can only preserve or reduce operational freedom", () => {
  const runtime = createSystemFoundationRuntime();
  assert.equal(runtime.policy.evaluate([]).effect, "pass");
  assert.equal(runtime.policy.evaluate([]).authority, "none");
  assert.equal(runtime.policy.evaluate([
    decision("pass", "user.policy"),
    decision("require-approval", "device.policy"),
    decision("deny", "system.policy"),
  ]).effect, "deny");
});

test("event journal is bounded and cursor based", () => {
  let tick = 0;
  const runtime = createSystemFoundationRuntime({
    eventLimit: 32,
    clock: () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString(),
  });
  for (let index = 0; index < 40; index += 1) {
    runtime.events.append({ type: "test.event", source: "test.runtime", subjectId: `subject-${index}` });
  }
  const events = runtime.events.list();
  assert.equal(events.length, 32);
  assert.equal(events[0].sequence, 9);
  assert.equal(runtime.events.list({ afterSequence: 39 }).length, 1);
});
