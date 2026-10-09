import assert from "node:assert/strict";
import test from "node:test";

import { getFirstPartyApp, listFirstPartyApps } from "../system/apps/catalog.mjs";
import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import { studioApp } from "../system/apps/studio/app.mjs";
import { STUDIO_VERSION } from "../system/apps/studio/version.mjs";
import { probeStudioDeviceAgent } from "../system/apps/studio/device-agent-status.mjs";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  DEVICE_AGENT_PORT_SCHEMA,
} from "../system/contracts/device-agent.mjs";
import { translateSurfaceMessage } from "../system/services/i18n/surface.mjs";
import { STUDIO_WORKSPACE_SOURCE_MESSAGES, STUDIO_WORKSPACE_ENGLISH_MESSAGES } from "../system/services/i18n/catalog/studio-workspace.mjs";

function reader(capabilities) {
  return Object.freeze({
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    capabilities: async ({ client }) => {
      assert.equal(client, "ordax-local");
      return {
        schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
        state: "ready",
        capabilities,
      };
    },
  });
}

test("Studio is a registered platform-neutral first-party app", () => {
  assert.equal(studioApp.id, "studio");
  assert.equal(studioApp.title, "ORDAX Studio");
  assert.equal(studioApp.component.version, STUDIO_VERSION);
  assert.equal(studioApp.component.releaseMode, "git-app");
  assert.equal(studioApp.component.failureDomain, "app");
  assert.equal(studioApp.component.restartScope, "component");
  assert.deepEqual(studioApp.requiredCapabilities, []);
  assert.equal(studioApp.panels[0].extensionId, "studio-workspace");

  assert.equal(getFirstPartyApp("studio"), studioApp);
  assert.equal(listFirstPartyApps().filter((app) => app.id === "studio").length, 1);

  const component = listSystemComponents().find((candidate) => candidate.id === "studio");
  assert.ok(component, "Studio component must be in the canonical component catalog");
  assert.equal(component.version, STUDIO_VERSION);
  assert.equal(component.owner, "system/apps/studio");
});

test("Studio Surface copy is complete in supported locales", () => {
  const messageIds = [
    "app.studio.title",
    "app.studio.description",
    "app.studio.panel.0.label",
    "app.studio.panel.0.title",
    "app.studio.panel.0.body",
  ];

  for (const locale of ["pt-BR", "en-US"]) {
    for (const messageId of messageIds) {
      const copy = translateSurfaceMessage(locale, messageId);
      assert.equal(typeof copy, "string");
      assert.ok(copy.length > 0, `${locale} must define ${messageId}`);
    }
  }
});

test("Studio availability copy separates the OS host panel from the portable product", () => {
  assert.deepEqual(Object.keys(STUDIO_WORKSPACE_SOURCE_MESSAGES).sort(), Object.keys(STUDIO_WORKSPACE_ENGLISH_MESSAGES).sort());
  assert.match(STUDIO_WORKSPACE_SOURCE_MESSAGES['studio.workspace.availability'], /ainda não está integrado/);
  assert.match(STUDIO_WORKSPACE_ENGLISH_MESSAGES['studio.workspace.availability'], /not yet integrated/);
  for (const catalog of [STUDIO_WORKSPACE_SOURCE_MESSAGES, STUDIO_WORKSPACE_ENGLISH_MESSAGES]) {
    assert.match(catalog['studio.workspace.web'], /Work\/Codex/);
    assert.ok(catalog['studio.workspace.noReader'].length > 30);
  }
});

test("Studio degrades honestly when no Device Agent reader is available", async () => {
  const status = await probeStudioDeviceAgent(null);
  assert.equal(status.state, "unavailable");
  assert.equal(status.capabilityCount, 0);
  assert.equal(status.mutationAuthority, "none");
});

test("Studio reads typed capabilities without receiving mutation authority", async () => {
  const status = await probeStudioDeviceAgent(reader([
    { id: "projects.list", modes: ["read"] },
    { id: "project.text_write", modes: ["write"] },
    { id: "blender.live_status", modes: ["read"] },
  ]));

  assert.equal(status.state, "ready");
  assert.equal(status.capabilityCount, 3);
  assert.equal(status.readCount, 2);
  assert.equal(status.writeCount, 1);
  assert.equal(status.mutationAuthority, "none");
  assert.deepEqual(status.capabilityIds, [
    "projects.list",
    "project.text_write",
    "blender.live_status",
  ]);
});

test("Studio rejects a mutable Device Agent port at its discovery boundary", async () => {
  const mutablePort = Object.freeze({
    schema: DEVICE_AGENT_PORT_SCHEMA,
    capabilities: async () => ({
      schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
      state: "ready",
      capabilities: [],
    }),
    execute() {
      throw new Error("must not be callable by Studio discovery");
    },
  });

  const status = await probeStudioDeviceAgent(mutablePort);
  assert.equal(status.state, "degraded");
  assert.equal(status.mutationAuthority, "none");
});

test("Studio capability discovery is bounded", async () => {
  const started = Date.now();
  const hung = Object.freeze({
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    capabilities: () => new Promise(() => {}),
  });
  const status = await probeStudioDeviceAgent(hung, { timeoutMs: 10 });
  assert.equal(status.state, "degraded");
  assert.ok(Date.now() - started < 1000);
});
