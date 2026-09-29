import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA,
  assertApplicationIntelligenceAwarenessPort,
} from "../system/contracts/application-intelligence-awareness.mjs";
import { createApplicationIntelligenceAwareness } from "../system/services/intelligence/application-awareness.mjs";

function firstPartyApp(id = "notes", title = "Notas") {
  return {
    id,
    title,
    component: {
      id,
      title,
      kind: "app",
      version: "0.4.0",
      releaseMode: "git-app",
      criticality: "optional",
      failureDomain: "app",
      restartScope: "component",
      healthMode: "none",
      owner: "system/apps",
      dependencies: [],
    },
  };
}

function installedApp(id = "photoshop", title = "Adobe Photoshop") {
  return {
    schema: "ordax.installed-application/1",
    id,
    title,
    description: "Editor de imagens instalado pelo usuário",
    monogram: "Ps",
    origin: {
      platform: "windows",
      source: "local-file",
      payloadSha256: "a".repeat(64),
      publisher: "Adobe Inc.",
    },
    launch: {
      kind: "compatibility-profile",
      profileId: `${id}-profile`,
      runtimeId: "wine-11-runtime",
      entrypointId: `${id}-entrypoint`,
    },
    lifecycle: {
      installState: "installed",
      uninstallable: true,
      updateMode: "vendor-managed",
    },
    trust: {
      nativeTrust: false,
      runtimeGrantsTrust: false,
    },
  };
}

test("native and Windows apps share Intelligence awareness without sharing trust", () => {
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
    installedApplications: [installedApp()],
  });

  assert.equal(awareness.schema, APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA);
  const [notes, photoshop] = awareness.list();
  assert.deepEqual(
    {
      appId: notes.appId,
      sourceClass: notes.sourceClass,
      platform: notes.platform,
      compatibilityManaged: notes.compatibilityManaged,
      nativeTrust: notes.nativeTrust,
    },
    {
      appId: "notes",
      sourceClass: "first-party",
      platform: "ordax",
      compatibilityManaged: false,
      nativeTrust: true,
    },
  );
  assert.deepEqual(
    {
      appId: photoshop.appId,
      sourceClass: photoshop.sourceClass,
      platform: photoshop.platform,
      compatibilityManaged: photoshop.compatibilityManaged,
      nativeTrust: photoshop.nativeTrust,
    },
    {
      appId: "photoshop",
      sourceClass: "installed",
      platform: "windows",
      compatibilityManaged: true,
      nativeTrust: false,
    },
  );
  assert.deepEqual(notes.knownActionIds, []);
  assert.deepEqual(photoshop.knownActionIds, []);
  assert.equal(photoshop.actionExecutionAuthorized, false);
  assert.equal(photoshop.modelToolExecutionAuthorized, false);
});

test("exact app resolution is deterministic and does not use fuzzy guessing", () => {
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
    installedApplications: [installedApp()],
  });

  assert.equal(awareness.resolveExact("photoshop")?.appId, "photoshop");
  assert.equal(awareness.resolveExact("Adobe Photoshop")?.appId, "photoshop");
  assert.equal(awareness.resolveExact("adobe photo")?.appId, undefined);
});

test("Intelligence context exposes semantic identity without compatibility internals", () => {
  const awareness = createApplicationIntelligenceAwareness({
    firstPartyApplications: [firstPartyApp()],
    installedApplications: [installedApp()],
  });
  const context = awareness.contextItem();
  const payload = JSON.parse(context.text);

  assert.equal(context.scope, "system");
  assert.equal(payload.authority, "none");
  assert.equal(payload.toolExecution, false);
  assert.equal(payload.applications.length, 2);
  assert.equal(payload.applications[1].appId, "photoshop");
  assert.equal(payload.applications[1].platform, "windows");
  assert.equal(payload.applications[1].compatibilityManaged, true);
  assert.equal(payload.applications[1].actionExecutionAuthorized, false);
  assert.equal(payload.applications[1].modelToolExecutionAuthorized, false);
  assert.equal(context.text.includes("wine-11-runtime"), false);
  assert.equal(context.text.includes("photoshop-profile"), false);
  assert.equal(context.text.includes("photoshop-entrypoint"), false);
  assert.equal(context.text.includes("a".repeat(64)), false);
});

test("awareness catalog fails closed on first-party/installed identity collision", () => {
  assert.throws(
    () => createApplicationIntelligenceAwareness({
      firstPartyApplications: [firstPartyApp("photoshop", "Photoshop OrdaX")],
      installedApplications: [installedApp("photoshop", "Adobe Photoshop")],
    }),
    /app id collision/,
  );
});

test("awareness port cannot expose application execution authority", () => {
  assert.throws(
    () => assertApplicationIntelligenceAwarenessPort({
      schema: APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA,
      list() { return []; },
      get() { return null; },
      resolveExact() { return null; },
      contextItem() { return null; },
      execute() {},
    }),
    /must not expose execute/,
  );
});

test("foreign runtime never converts a Windows app into native trust", () => {
  const value = installedApp();
  value.trust.nativeTrust = true;
  assert.throws(
    () => createApplicationIntelligenceAwareness({ installedApplications: [value] }),
    /cannot grant native trust/,
  );
});
