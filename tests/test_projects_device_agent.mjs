import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_PORT_SCHEMA,
} from "../system/contracts/device-agent.mjs";
import { createDeviceAgentCapabilityReader } from "../system/services/device-agent/capability-reader.mjs";

test("Platform retains a narrow read-only Device Agent capability port for external Projects", async () => {
  let executed = 0;
  const host = Object.freeze({
    schema: DEVICE_AGENT_PORT_SCHEMA,
    capabilities: async () => ({
      schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
      state: "ready",
      capabilities: [{ id: "files.project-read", modes: ["read"] }],
    }),
    execute() { executed += 1; throw new Error("must never be invoked"); },
  });
  const port = createDeviceAgentCapabilityReader(host);
  assert.equal("execute" in port, false);
  const snapshot = await port.capabilities({ client: "ordax-local" });
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.capabilities[0].id, "files.project-read");
  assert.equal(executed, 0);
});
