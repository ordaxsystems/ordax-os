import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_AGENT_REGISTRY_SCHEMA,
  INTELLIGENCE_AGENT_SCHEMA,
  validateIntelligenceAgentDescriptor,
} from "../system/contracts/intelligence-agent.mjs";
import {
  createIntelligenceAgentRegistry,
  listDefaultIntelligenceAgents,
} from "../system/services/intelligence/agent-registry.mjs";

const expectedIds = ["system", "search", "file", "workspace", "developer"];

function descriptor(overrides = {}) {
  return {
    schema: INTELLIGENCE_AGENT_SCHEMA,
    id: "reviewer",
    title: "Reviewer",
    description: "Interpreta evidência explicitamente fornecida sem executar mudanças.",
    domain: "review",
    readOnly: true,
    authority: "none",
    executable: false,
    toolExecution: false,
    ...overrides,
  };
}

test("default Agent Registry exposes only named read-only identities", () => {
  const registry = createIntelligenceAgentRegistry();
  const agents = registry.list();

  assert.equal(registry.schema, INTELLIGENCE_AGENT_REGISTRY_SCHEMA);
  assert.deepEqual(agents.map((agent) => agent.id), expectedIds);
  assert.ok(Object.isFrozen(agents));
  for (const agent of agents) {
    assert.ok(Object.isFrozen(agent));
    assert.equal(agent.readOnly, true);
    assert.equal(agent.authority, "none");
    assert.equal(agent.executable, false);
    assert.equal(agent.toolExecution, false);
    assert.equal("toolIds" in agent, false);
    assert.equal("capabilityIds" in agent, false);
    assert.equal("shellAccess" in agent, false);
    assert.equal("networkAccess" in agent, false);
  }
  assert.equal(registry.get("developer")?.domain, "developer");
  assert.equal(registry.has("search"), true);
  assert.equal(registry.get("unknown"), null);
});

test("Agent Registry rejects authority or hidden tool and capability fields", () => {
  assert.throws(
    () => validateIntelligenceAgentDescriptor(descriptor({ executable: true })),
    /read-only and non-executable/,
  );
  assert.throws(
    () => validateIntelligenceAgentDescriptor(descriptor({ authority: "system" })),
    /read-only and non-executable/,
  );
  assert.throws(
    () => validateIntelligenceAgentDescriptor({ ...descriptor(), toolIds: ["read-file"] }),
    /field toolIds is not allowed/,
  );
  assert.throws(
    () => validateIntelligenceAgentDescriptor({ ...descriptor(), capabilityIds: ["fs.read"] }),
    /field capabilityIds is not allowed/,
  );
  assert.throws(
    () => validateIntelligenceAgentDescriptor({ ...descriptor(), shellAccess: false }),
    /field shellAccess is not allowed/,
  );
});

test("Agent Registry is extensible without hardcoding new identities into the contract", () => {
  const custom = descriptor();
  const registry = createIntelligenceAgentRegistry({ agents: [custom] });

  assert.equal(registry.has("reviewer"), true);
  assert.equal(registry.get("reviewer")?.title, "Reviewer");
  assert.deepEqual(registry.list().map((agent) => agent.id), ["reviewer"]);
});

test("Agent Registry rejects duplicate identities and invalid ids", () => {
  assert.throws(
    () => createIntelligenceAgentRegistry({ agents: [descriptor(), descriptor()] }),
    /ids must be unique/,
  );
  assert.throws(
    () => createIntelligenceAgentRegistry({ agents: [descriptor({ id: "Developer Agent" })] }),
    /id is invalid/,
  );
});

test("default agent list remains detached from mutable caller state", () => {
  const first = listDefaultIntelligenceAgents();
  const second = listDefaultIntelligenceAgents();
  assert.deepEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(second));
});
