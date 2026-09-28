import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_CAPABILITY_BRIDGE_SCHEMA,
  INTELLIGENCE_TOOL_SCHEMA,
  validateIntelligenceToolDescriptor,
} from "../system/contracts/intelligence-tool.mjs";
import { createIntelligenceCapabilityBridge } from "../system/services/intelligence/capability-bridge.mjs";
import { createIntelligenceToolRegistry } from "../system/services/intelligence/tool-registry.mjs";

function descriptor(overrides = {}) {
  return {
    schema: INTELLIGENCE_TOOL_SCHEMA,
    id: "observe-system-metrics",
    title: "System metrics",
    description: "Read-only observation.",
    capabilityId: "system.metrics",
    inputScopes: ["system"],
    readOnly: true,
    networkEgress: false,
    mutatesState: false,
    invocationEnabled: false,
    authority: "none",
    ...overrides,
  };
}

test("read-only tool registry exposes only canonical observable capabilities", () => {
  const registry = createIntelligenceToolRegistry();
  const tools = registry.list();

  assert.deepEqual(
    tools.map((tool) => [tool.id, tool.capabilityId]),
    [
      ["observe-system-metrics", "system.metrics"],
      ["observe-network-status", "network.status"],
      ["observe-power-status", "power.status"],
    ],
  );
  for (const tool of tools) {
    assert.equal(tool.readOnly, true);
    assert.equal(tool.networkEgress, false);
    assert.equal(tool.mutatesState, false);
    assert.equal(tool.invocationEnabled, false);
    assert.equal(tool.authority, "none");
  }
  assert.equal(typeof registry.invoke, "undefined");
  assert.equal(typeof registry.register, "undefined");
});

test("tool descriptors reject mutation, network, invocation and hidden execution fields", () => {
  for (const overrides of [
    { readOnly: false },
    { networkEgress: true },
    { mutatesState: true },
    { invocationEnabled: true },
    { authority: "system" },
  ]) {
    assert.throws(
      () => validateIntelligenceToolDescriptor(descriptor(overrides)),
      /read-only, offline and non-invocable/,
    );
  }
  assert.throws(
    () => validateIntelligenceToolDescriptor({ ...descriptor(), command: "cat /etc/passwd" }),
    /field command is not allowed/,
  );
  assert.throws(
    () => validateIntelligenceToolDescriptor({ ...descriptor(), url: "https://example.org" }),
    /field url is not allowed/,
  );
});

test("registry rejects capabilities outside the approved read-only product set", () => {
  assert.throws(
    () => createIntelligenceToolRegistry({
      tools: [descriptor({ capabilityId: "network.management" })],
    }),
    /not approved for the read-only foundation/,
  );
  assert.throws(
    () => createIntelligenceToolRegistry({
      tools: [descriptor({ capabilityId: "system.boot-control" })],
    }),
    /not approved for the read-only foundation/,
  );
});

test("capability bridge only reports availability and never invokes a tool", () => {
  const bridge = createIntelligenceCapabilityBridge();
  assert.equal(bridge.schema, INTELLIGENCE_CAPABILITY_BRIDGE_SCHEMA);
  assert.equal(typeof bridge.invoke, "undefined");
  assert.equal(typeof bridge.execute, "undefined");

  const system = bridge.inspect("observe-system-metrics", ["system.metrics", "network.status"]);
  const power = bridge.inspect("observe-power-status", ["system.metrics", "network.status"]);
  assert.deepEqual(system, {
    toolId: "observe-system-metrics",
    capabilityId: "system.metrics",
    available: true,
    readOnly: true,
    invocationEnabled: false,
    authority: "none",
  });
  assert.equal(power.available, false);
  assert.equal(bridge.inspect("unknown-tool", ["system.metrics"]), null);
});

test("capability bridge rejects malformed or duplicate capability inventories", () => {
  const bridge = createIntelligenceCapabilityBridge();
  assert.throws(
    () => bridge.list(["system.metrics", "system.metrics"]),
    /must be unique/,
  );
  assert.throws(
    () => bridge.list(["SYSTEM.METRICS"]),
    /invalid id/,
  );
});
