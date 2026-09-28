import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_PORT_SCHEMA,
  INTELLIGENCE_RESPONSE_SCHEMA,
} from "../system/contracts/intelligence.mjs";
import { NETWORK_STATUS_SCHEMA } from "../system/contracts/network-status.mjs";
import { POWER_STATUS_SCHEMA } from "../system/contracts/power-status.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { SYSTEM_METRICS_SCHEMA } from "../system/contracts/system-metrics.mjs";
import { createNativeIntelligenceSystemAnalysis } from "../system/composition/native/intelligence-system-analysis.mjs";

function host(capabilityIds) {
  const snapshot = Object.freeze({
    capabilityIds: Object.freeze([...capabilityIds]),
    connectivity: "online",
  });
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  });
}

function intelligenceFixture() {
  const requests = [];
  const snapshot = Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    state: "ready",
    inferenceAvailable: true,
    engineId: "test-engine",
    modelId: "test-model",
    authority: "none",
    toolExecution: false,
  });
  const port = Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async respond(request) {
      requests.push(request);
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: "observed",
        engineId: "test-engine",
        modelId: "test-model",
        authority: "none",
      };
    },
  });
  return { port, requests };
}

function metricsPort() {
  return Object.freeze({
    schema: SYSTEM_METRICS_SCHEMA,
    async read() {
      return {
        uptimeSeconds: 123,
        memoryTotalBytes: 16_000,
        memoryAvailableBytes: 6_000,
        userStorageTotalBytes: 100_000,
        userStorageFreeBytes: 40_000,
      };
    },
  });
}

function networkPort() {
  return Object.freeze({
    schema: NETWORK_STATUS_SCHEMA,
    async read() {
      return {
        interfaces: [
          { name: "wlan0", kind: "wifi", state: "connected", signalDbm: -51 },
          { name: "eth0", kind: "ethernet", state: "disconnected", signalDbm: null },
        ],
      };
    },
  });
}

function powerPort() {
  return Object.freeze({
    schema: POWER_STATUS_SCHEMA,
    async read() {
      return {
        battery: { percent: 73, state: "discharging" },
        externalPower: false,
      };
    },
  });
}

const ALL_CAPABILITIES = Object.freeze([
  "system.metrics",
  "network.status",
  "power.status",
]);

test("Native System diagnose gathers governed observations before inference", async () => {
  const inference = intelligenceFixture();
  const runtime = createNativeIntelligenceSystemAnalysis({
    host: host(ALL_CAPABILITIES),
    intelligence: inference.port,
    systemMetrics: metricsPort(),
    networkStatus: networkPort(),
    powerStatus: powerPort(),
  });

  const response = await runtime.intelligence.respond({
    intent: "diagnose",
    prompt: "Explique o estado observado.",
    context: [{
      id: "legacy-system-snapshot",
      scope: "system",
      text: "must be replaced by governed observations",
      provenance: "legacy",
    }],
    maxTokens: 384,
  });

  assert.equal(response.text, "observed");
  assert.equal(inference.requests.length, 1);
  const [request] = inference.requests;
  assert.equal(request.intent, "diagnose");
  assert.deepEqual(
    request.context.map((entry) => entry.id),
    [
      "tool-system-metrics-local",
      "tool-network-status-local",
      "tool-power-status-local",
    ],
  );
  assert.equal(JSON.stringify(request.context).includes("legacy-system-snapshot"), false);
  assert.equal(JSON.stringify(request.context).includes("wlan0"), false);
  assert.equal(JSON.stringify(request.context).includes("eth0"), false);
  assert.equal(JSON.stringify(request.context).includes("ssid"), false);
  assert.equal(JSON.stringify(request.context).includes("ipAddress"), false);

  const network = JSON.parse(request.context[1].text);
  assert.deepEqual(network.interfaces, [
    { ordinal: 1, kind: "wifi", state: "connected", signalDbm: -51 },
    { ordinal: 2, kind: "ethernet", state: "disconnected", signalDbm: null },
  ]);
  const power = JSON.parse(request.context[2].text);
  assert.deepEqual(power, {
    battery: { percent: 73, state: "discharging" },
    externalPower: false,
  });

  const audit = runtime.auditJournal.list();
  assert.equal(audit.length, 9);
  assert.deepEqual(
    audit.filter((entry) => entry.kind === "execution").map((entry) => entry.event),
    ["succeeded", "succeeded", "succeeded"],
  );
  assert.ok(audit.every((entry) => entry.readOnly === true));
  assert.ok(audit.every((entry) => entry.networkEgress === false));
  assert.ok(audit.every((entry) => entry.mutatedState === false));
  assert.equal(JSON.stringify(audit).includes("device-local"), false);
  assert.equal(JSON.stringify(audit).includes("tool-grant-"), false);
  runtime.dispose();
});

test("non-diagnose requests do not invoke governed observation tools", async () => {
  const inference = intelligenceFixture();
  const runtime = createNativeIntelligenceSystemAnalysis({
    host: host(ALL_CAPABILITIES),
    intelligence: inference.port,
    systemMetrics: metricsPort(),
    networkStatus: networkPort(),
    powerStatus: powerPort(),
  });

  await runtime.intelligence.respond({
    intent: "ask",
    prompt: "Quem é você?",
    context: [],
    maxTokens: 128,
  });

  assert.equal(inference.requests.length, 1);
  assert.equal(inference.requests[0].intent, "ask");
  assert.deepEqual(inference.requests[0].context, []);
  assert.deepEqual(runtime.auditJournal.list(), []);
  runtime.dispose();
});

test("partial Native capability inventory is surfaced as bounded limitation context", async () => {
  const inference = intelligenceFixture();
  const runtime = createNativeIntelligenceSystemAnalysis({
    host: host(["system.metrics"]),
    intelligence: inference.port,
    systemMetrics: metricsPort(),
  });

  await runtime.intelligence.respond({
    intent: "diagnose",
    prompt: "Explique o que foi possível observar.",
    context: [],
  });

  const context = inference.requests[0].context;
  assert.equal(context[0].id, "tool-system-metrics-local");
  assert.equal(context[1].id, "tool-system-observation-limitations");
  assert.deepEqual(JSON.parse(context[1].text), {
    unavailableObservations: ["observe-network-status", "observe-power-status"],
  });
  assert.equal(runtime.auditJournal.list().filter((entry) => entry.kind === "execution").length, 1);
  runtime.dispose();
});
