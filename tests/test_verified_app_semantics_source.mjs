import assert from "node:assert/strict";
import test from "node:test";
import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import { createNativeStoreCatalogComposition } from "../system/composition/native/store-catalog.mjs";
import { createCapabilityDiscovery } from "../system/services/system-foundation/capability-discovery.mjs";
import { createSystemFoundationRuntime } from "../system/services/system-foundation/runtime.mjs";
import { createApplicationContextIntelligence } from "../system/services/intelligence/application-context.mjs";
import { INTELLIGENCE_PORT_SCHEMA, INTELLIGENCE_RESPONSE_SCHEMA } from "../system/contracts/intelligence.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import {
  createLiveVerifiedApplicationSemantics,
  createVerifiedSemanticsRefresh,
} from "../system/services/intelligence/live-verified-app-semantics.mjs";

import { createNativeVerifiedComponentPackageSource } from "../system/adapters/native/verified-component-package-source.mjs";
import {
  loadVerifiedFirstPartyApplicationSemantics,
  loadVerifiedFirstPartyApplicationActionManifests,
  loadVerifiedFirstPartyApplicationActionProviderManifests,
  loadVerifiedFirstPartyIntelligenceManifests,
  overlayVerifiedFirstPartyApplications,
} from "../system/services/intelligence/verified-app-semantics.mjs";

const SHA = "7".repeat(40);

function windowRef() {
  return { location: { href: "http://127.0.0.1:43121/" } };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function slotMetadata(appId = "notes", version = "0.4.1") {
  return {
    componentId: appId,
    state: "current",
    source: "slot",
    revision: 5,
    version,
    sourceCommit: SHA,
    entrypoint: `system/apps/${appId}/src/runtime.mjs`,
    pendingHealth: null,
  };
}

function appManifest(appId = "notes", version = "0.4.1", overrides = {}) {
  return {
    schema: "ordax.component-manifest/1",
    id: appId,
    title: appId === "notes" ? "Notas" : "ORDAX Studio",
    kind: "app",
    version,
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner: "ordaxsystems/ordax-apps",
    dependencies: [],
    ...overrides,
  };
}

function semantics(appId = "notes", version = "0.4.1") {
  return {
    schema: "ordax.app-intelligence-manifest/1",
    appId,
    appVersion: version,
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use somente as capacidades declaradas pelo app verificado."],
    intents: [
      {
        id: `${appId}.create-note`,
        description: "Criar uma nota.",
        effect: "write",
        confirmation: "policy",
        parameters: [],
        examples: ["Crie uma nota."],
      },
    ],
  };
}


function actions(appId = "notes", version = "0.4.1", overrides = {}) {
  return {
    schema: "ordax.application-action-manifest/1",
    appId,
    appVersion: version,
    authority: "none",
    execution: "proposal-only",
    capabilities: [
      {
        schema: "ordax.application-action-capability/1",
        appId,
        actionId: `${appId}.create-note`,
        title: "Criar nota",
        description: "Criar uma nota.",
        sourceClass: "first-party",
        platform: "ordax",
        provider: {
          kind: "first-party-native",
          adapterId: `${appId}-native`,
          revision: "1",
        },
        binding: { payloadSha256: null },
        parameters: [],
        riskClass: "local-change",
        confirmation: "policy-gated",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
        provenance: `ordax-apps:${appId}/actions/manifest.json`,
      },
    ],
    ...overrides,
  };
}

function providers(appId = "notes", version = "0.4.1", overrides = {}) {
  return {
    schema: "ordax.application-action-provider-manifest/1",
    appId,
    appVersion: version,
    authority: "none",
    execution: "unavailable",
    providers: [{
      kind: "first-party-native",
      adapterId: `${appId}-native`,
      revision: "1",
      module: `actions/providers/${appId}-native.mjs`,
      sha256: "a".repeat(64),
    }],
    ...overrides,
  };
}

function verifiedEntry(appId = "notes", version = "0.4.1") {
  const component = appManifest(appId, version);
  return {
    application: {
      id: component.id,
      title: component.title,
      component,
    },
    intelligenceManifest: semantics(appId, version),
    actionManifest: actions(appId, version),
    providerManifest: providers(appId, version),
    sourceCommit: SHA,
    revision: 5,
  };
}

function verifiedFetch({
  appId = "notes",
  version = "0.4.1",
  app = null,
  ai = null,
  actionManifest = null,
  actionStatus = 200,
  providerManifest = null,
  providerStatus = 200,
} = {}) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      const parsed = new URL(url);
      if (parsed.pathname === "/__ordax/native/component-runtime") {
        return jsonResponse(slotMetadata(appId, version));
      }
      const prefix =
        `/__ordax/native/component-module/${appId}/current/${version}/`
        + SHA
        + `/system/apps/${appId}/`;
      assert.equal(parsed.pathname.startsWith(prefix), true);
      if (parsed.pathname.endsWith("/app.json")) {
        return jsonResponse(app ?? appManifest(appId, version));
      }
      if (parsed.pathname.endsWith("/ai/manifest.json")) {
        return jsonResponse(ai ?? semantics(appId, version));
      }
      if (parsed.pathname.endsWith("/actions/manifest.json")) {
        if (actionStatus === 404) return jsonResponse({}, 404);
        return jsonResponse(actionManifest ?? actions(appId, version));
      }
      if (parsed.pathname.endsWith("/actions/providers/manifest.json")) {
        if (providerStatus === 404) return jsonResponse({}, 404);
        return jsonResponse(providerManifest ?? providers(appId, version));
      }
      throw new Error(`unexpected verified package path: ${parsed.pathname}`);
    },
  };
}

test("verified app semantics binds identity, AI and Actions to the exact current slot", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].application.id, "notes");
  assert.equal(entries[0].application.title, "Notas");
  assert.equal(entries[0].application.component.version, "0.4.1");
  assert.equal(entries[0].application.component.releaseMode, "component-slot");
  assert.equal(entries[0].application.component.owner, "ordaxsystems/ordax-apps");
  assert.equal(entries[0].intelligenceManifest.appId, "notes");
  assert.equal(entries[0].intelligenceManifest.appVersion, "0.4.1");
  assert.equal(entries[0].intelligenceManifest.authority, "none");
  assert.equal(entries[0].intelligenceManifest.execution, "declarative-only");
  assert.equal(entries[0].actionManifest.appId, "notes");
  assert.equal(entries[0].actionManifest.appVersion, "0.4.1");
  assert.equal(entries[0].actionManifest.authority, "none");
  assert.equal(entries[0].actionManifest.execution, "proposal-only");
  assert.equal(entries[0].actionManifest.capabilities[0].actionId, "notes.create-note");
  assert.equal(entries[0].providerManifest.appId, "notes");
  assert.equal(entries[0].providerManifest.execution, "unavailable");
  assert.equal(entries[0].providerManifest.providers[0].adapterId, "notes-native");
  assert.equal(entries[0].providerManifest.providers[0].artifactSha256, "a".repeat(64));
  assert.equal(entries[0].sourceCommit, SHA);
  assert.equal(entries[0].revision, 5);
  assert.equal(fixture.calls.length, 5);
  assert.equal(
    new URL(fixture.calls[1].url).pathname.endsWith("/system/apps/notes/app.json"),
    true,
  );
  assert.equal(
    new URL(fixture.calls[2].url).pathname.endsWith("/system/apps/notes/ai/manifest.json"),
    true,
  );
  assert.equal(
    new URL(fixture.calls[3].url).pathname.endsWith("/system/apps/notes/actions/manifest.json"),
    true,
  );
  assert.equal(
    new URL(fixture.calls[4].url).pathname.endsWith(
      "/system/apps/notes/actions/providers/manifest.json"
    ),
    true,
  );
  for (const call of fixture.calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
  }
});

test("verified external Files, Studio and Notes use a single slot-backed source", () => {
  const overlaid = overlayVerifiedFirstPartyApplications([], [
    verifiedEntry("files", "0.4.3"), verifiedEntry("studio", "0.4.3"), verifiedEntry("notes", "0.4.1")
  ]);
  assert.deepEqual(overlaid.map(app=>app.id), ["files", "studio", "notes"]);
  for (const entry of overlaid) assert.equal(entry.component.owner, "ordaxsystems/ordax-apps");
});
test("verified application overlay rejects arbitrary or incompletely verified replacements", () => {
  const foreignId = verifiedEntry("notes");
  foreignId.application.id = "untrusted";
  foreignId.application.component = appManifest("untrusted", "0.4.1");
  foreignId.intelligenceManifest = semantics("untrusted", "0.4.1");
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [foreignId]),
    /not an available external first-party app/,
  );

  const ownerDrift = verifiedEntry("notes");
  ownerDrift.application.component = appManifest("notes", "0.4.1", {
    owner: "system/apps/notes",
  });
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [ownerDrift]),
    /overlay identity drifted/,
  );

  const versionDrift = verifiedEntry("notes");
  versionDrift.intelligenceManifest = semantics("notes", "9.9.9");
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [versionDrift]),
    /appVersion mismatch/,
  );

  const badSource = verifiedEntry("notes");
  badSource.sourceCommit = "deadbeef";
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [badSource]),
    /sourceCommit/,
  );
});

test("verified application overlay rejects duplicate identities instead of choosing implicitly", () => {
  assert.throws(
    () => overlayVerifiedFirstPartyApplications(
      [{ id: "studio" }, { id: "studio" }],
      [],
    ),
    /base catalog duplicates app/,
  );
  assert.throws(
    () => overlayVerifiedFirstPartyApplications(
      [],
      [verifiedEntry("notes"), verifiedEntry("notes")],
    ),
    /overlay duplicates app/,
  );
});

test("manifest-only compatibility helper is derived from verified application semantics", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const manifests = await loadVerifiedFirstPartyIntelligenceManifests({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].appId, "notes");
  assert.equal(manifests[0].appVersion, "0.4.1");
});

test("legacy verified package without Action manifest keeps Intelligence semantics but exposes no capabilities", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch({ actionStatus: 404 });
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].application.id, "notes");
  assert.equal(entries[0].intelligenceManifest.appId, "notes");
  assert.equal(entries[0].actionManifest, null);
  assert.equal(fixture.calls.length, 4);

  const actionFixture = verifiedFetch({ actionStatus: 404 });
  const actionManifests = await loadVerifiedFirstPartyApplicationActionManifests({
    appIds: ["notes"],
    source,
    fetchImpl: actionFixture.fetchImpl,
  });
  assert.deepEqual(actionManifests, []);
});

test("provider-manifest compatibility helper is derived from the same verified application semantics", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const manifests = await loadVerifiedFirstPartyApplicationActionProviderManifests({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].appId, "notes");
  assert.equal(manifests[0].providers[0].adapterId, "notes-native");
  assert.equal(manifests[0].execution, "unavailable");
});

test("action-manifest compatibility helper is derived from the same verified application semantics", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const actionManifests = await loadVerifiedFirstPartyApplicationActionManifests({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(actionManifests.length, 1);
  assert.equal(actionManifests[0].appId, "notes");
  assert.equal(actionManifests[0].appVersion, "0.4.1");
  assert.equal(actionManifests[0].capabilities[0].actionId, "notes.create-note");
});

test("absent external app is skipped without reading app identity, AI or Actions", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  let calls = 0;
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    async fetchImpl(url) {
      calls += 1;
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/__ordax/native/component-runtime");
      return jsonResponse({
        componentId: "notes",
        state: "current",
        source: "absent",
        revision: 7,
        version: null,
        sourceCommit: null,
        entrypoint: null,
        pendingHealth: null,
      });
    },
  });
  assert.deepEqual(entries, []);
  assert.equal(calls, 1);
});

test("app.json identity must match exact verified slot and external first-party policy", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  for (const [label, app, expected] of [
    ["schema", appManifest("notes", "0.4.1", { schema: "other/9" }), /schema drifted/],
    ["version", appManifest("notes", "0.4.2"), /identity drifted/],
    ["release mode", appManifest("notes", "0.4.1", { releaseMode: "git-app" }), /identity drifted/],
    ["owner", appManifest("notes", "0.4.1", { owner: "system/apps/notes" }), /identity drifted/],
  ]) {
    await assert.rejects(
      () => {
        const fixture = verifiedFetch({ app });
        return loadVerifiedFirstPartyApplicationSemantics({
          appIds: ["notes"],
          source,
          fetchImpl: fixture.fetchImpl,
        });
      },
      expected,
      label,
    );
  }
});

test("AI manifest version must match component identity from the same verified slot", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch({ ai: semantics("notes", "0.4.2") });
  await assert.rejects(
    () => loadVerifiedFirstPartyApplicationSemantics({
      appIds: ["notes"],
      source,
      fetchImpl: fixture.fetchImpl,
    }),
    /appVersion mismatch/,
  );
});

test("Application Action manifest version and semantic binding must match the same verified slot", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());

  await assert.rejects(
    () => {
      const fixture = verifiedFetch({
        actionManifest: actions("notes", "0.4.2"),
      });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /appVersion mismatch/,
  );

  const missingIntent = actions("notes", "0.4.1");
  missingIntent.capabilities[0].actionId = "notes.unknown";
  await assert.rejects(
    () => {
      const fixture = verifiedFetch({ actionManifest: missingIntent });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /no matching Intelligence intent/,
  );

  const weakConfirmation = actions("notes", "0.4.1");
  weakConfirmation.capabilities[0].confirmation = "none";
  await assert.rejects(
    () => {
      const fixture = verifiedFetch({ actionManifest: weakConfirmation });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /confirmation is weaker/,
  );
});

test("Application Action provider manifest must match the same verified app and declared providers", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());

  await assert.rejects(
    () => {
      const fixture = verifiedFetch({
        providerManifest: providers("notes", "0.4.2"),
      });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /appVersion mismatch/,
  );

  const wrongProvider = providers();
  wrongProvider.providers[0] = {
    ...wrongProvider.providers[0],
    adapterId: "other-native",
    module: "actions/providers/other-native.mjs",
  };
  await assert.rejects(
    () => {
      const fixture = verifiedFetch({ providerManifest: wrongProvider });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /exactly cover declared capabilities/,
  );

  const legacyProvider = verifiedFetch({ providerStatus: 404 });
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    fetchImpl: legacyProvider.fetchImpl,
  });
  assert.equal(entries[0].actionManifest.appId, "notes");
  assert.equal(entries[0].providerManifest, null);
});

test("verified package source never exposes mutation or execution methods", () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  for (const method of [
    "execute",
    "invoke",
    "run",
    "install",
    "uninstall",
    "promote",
    "rollback",
    "writeFile",
  ]) {
    assert.equal(source[method], undefined);
  }
});

test("Store CURRENT installs a verified app into the same live Aura, Personal and Fabric ports without restart", async t => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  let observed = [];
  let published = 0;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => observed,
  });
  const awareness = live.awarenessPort;
  const actionsPort = live.actionRegistryPort;
  const router = live.semanticRouterPort;
  const waitForPublish = () => new Promise(resolve => { notify = resolve; });
  let notify = null;
  const errors = [];
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    source, fetchImpl: fixture.fetchImpl,
    onPublished() { published++; notify?.(); notify = null; },
    onError(error) { errors.push(error); notify?.(); notify = null; },
  });
  t.after(() => { coordinator.dispose(); live.dispose(); });

  assert.equal(awareness.get("notes"), null);
  assert.deepEqual(actionsPort.list(), []);
  coordinator.refresh();
  assert.equal(published, 1);
  const firstStableAwareness = awareness;
  const firstStableRegistry = actionsPort;
  const firstStableRouter = router;

  observed = [slotMetadata()];
  const ready = waitForPublish();
  coordinator.refresh();
  await ready;
  assert.deepEqual(errors, []);
  assert.equal(awareness, firstStableAwareness);
  assert.equal(actionsPort, firstStableRegistry);
  assert.equal(router, firstStableRouter);
  assert.equal(awareness.get("notes")?.appId, "notes");
  assert.equal(actionsPort.get("notes", "notes.create-note")?.title, "Criar nota");
  assert.equal(actionsPort.propose("notes", "notes.create-note", {}).executionAuthorized, false);
  assert.equal(actionsPort.propose("notes", "notes.create-note", {}).modelDirectExecutionAuthorized, false);
  assert.equal(router.select("Crie uma nota para mim")[0]?.appId, "notes");
  assert.equal(fixture.calls.length, 5, "the canonical signed package loader ran exactly once");
  coordinator.refresh();
  assert.equal(fixture.calls.length, 5, "unchanged CURRENT never refetches signed packages");

  observed = [];
  coordinator.refresh();
  assert.equal(actionsPort.list().length, 0);
  assert.equal(awareness.get("notes"), null);
  assert.deepEqual(router.select("Crie uma nota"), []);
  assert.throws(() => actionsPort.propose("notes", "notes.create-note", {}), /not current/);

  observed = [slotMetadata()];
  const reinstalled = waitForPublish();
  coordinator.refresh();
  await reinstalled;
  assert.deepEqual(errors, []);
  assert.equal(actionsPort.list().length, 1);
  assert.equal(router.select("Crie uma nota")[0]?.appId, "notes");
  assert.equal(published, 4, "the same live owner published removal and reinstallation");
});

test("Store CURRENT never promotes stale, superseded or unverified app semantic generations", async t => {
  let observed = [];
  let resolveLoad;
  let loads = 0;
  let errorNotification = null;
  const waitForError = () => new Promise(resolve => { errorNotification = resolve; });
  const errors = [];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => observed,
  });
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    source: {},
    fetchImpl() { throw new Error("fixture does not fetch without a verified loader"); },
    load() {
      loads++;
      return new Promise(resolve => { resolveLoad = resolve; });
    },
    onError(error) { errors.push(error); errorNotification?.(); errorNotification = null; }
  });
  t.after(() => { coordinator.dispose(); live.dispose(); });

  observed = [slotMetadata()];
  coordinator.refresh();
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.deepEqual(live.actionRegistryPort.list(), [],
    "the app is not offered while a signed package is still being verified");
  observed = [];
  coordinator.refresh();
  resolveLoad([verifiedEntry()]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(live.actionRegistryPort.list(), [],
    "a completed superseded package load cannot resurrect the removed provider");
  assert.equal(live.awarenessPort.get("notes"), null);
  assert.deepEqual(errors, []);

  observed = [slotMetadata("notes", "0.4.2")];
  const staleRejected = waitForError();
  coordinator.refresh();
  await Promise.resolve();
  resolveLoad([verifiedEntry("notes", "0.4.1")]);
  await Promise.resolve();
  await Promise.resolve();
  await staleRejected;
  assert.equal(errors.length, 1,
    "signed metadata for an earlier version must not become current");
  await staleRejected;
  assert.match(errors[0].message, /identity drifted/);
  assert.deepEqual(live.actionRegistryPort.list(), []);
  assert.equal(live.awarenessPort.get("notes"), null);

  observed = [slotMetadata("notes", "0.4.1"), slotMetadata("notes", "0.4.1")];
  coordinator.refresh();
  assert.equal(errors.length, 2);
  assert.match(errors[1].message, /Duplicate/);
  assert.equal(loads, 2, "duplicate observations may not start another package load");
});

test("Store signed refresh reaches mounted Aura and Personal without a second registry or Surface reboot", async t => {
  let observed = [];
  let request = null;
  const fixture = verifiedFetch();
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => observed,
  });
  const discovery = createCapabilityDiscovery({
    getFoundation: () => createSystemFoundationRuntime(),
    getApplicationActions: () => live.actionRegistryPort,
  });
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => ({ state: "signed-in", subjectId: "notes-owner", displayName: "Owner" }),
    subscribe: () => () => {},
  };
  const personal = createNativePersonalOrdaxComposition({
    windowRef: {
      localStorage: {
        getItem: () => null,
        setItem() {},
      },
    },
    identitySession: identity,
    intelligence: null,
    applicationActionCapabilityRegistry: live.actionRegistryPort,
    applicationSemanticRouter: live.semanticRouterPort,
    getCapabilityDiscovery: () => discovery,
  });
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot() {
        return {
          schema: INTELLIGENCE_PORT_SCHEMA,
          state: "ready", inferenceAvailable: true,
          engineId: "local", modelId: "test",
          authority: "none", toolExecution: false,
        };
      },
      subscribe: () => () => {},
      async respond(value) {
        request = value;
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "ok", engineId: "local", modelId: "test",
          authority: "none",
        };
      },
    },
    awarenessPort: live.awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getCapabilityDiscovery: () => discovery,
  });
  let onPublished = null;
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    source: createNativeVerifiedComponentPackageSource(windowRef()),
    fetchImpl: fixture.fetchImpl,
    onPublished() {
      discovery.refresh();
      personal.reconcileApprovedAuthority();
      onPublished?.();
      onPublished = null;
    },
    onError(error) { throw error; },
  });
  t.after(() => {
    coordinator.dispose();
    personal.dispose();
    live.dispose();
  });
  const awaitPublish = () => new Promise(resolve => { onPublished = resolve; });
  assert.deepEqual(personal.listAvailableApplicationActions("notes"), []);
  await aura.respond({ prompt: "Crie uma nota" });
  assert.equal(discovery.snapshot().entries.filter(entry => entry.kind === "application-action").length, 0);

  observed = [slotMetadata()];
  const ready = awaitPublish();
  coordinator.refresh();
  await ready;
  assert.equal(personal.listAvailableApplicationActions("notes").length, 1);
  assert.equal(discovery.snapshot().entries.filter(entry => entry.kind === "application-action").length, 1);
  await aura.respond({ prompt: "Crie uma nota" });
  const capabilityItem = request.context.find(entry =>
    entry.id === "ordax-application-action-capabilities");
  assert.ok(capabilityItem);
  assert.equal(JSON.parse(capabilityItem.text).actions[0].appId, "notes");
  assert.equal(personal.proposeApplicationAction("notes", "notes.create-note", {})
    .executionAuthorized, false, "Personal must not inherit model execution authority");

  observed = [];
  coordinator.refresh();
  assert.deepEqual(personal.listAvailableApplicationActions("notes"), []);
  assert.equal(discovery.snapshot().entries.filter(entry => entry.kind === "application-action").length, 0);
  await aura.respond({ prompt: "Crie uma nota" });
  assert.equal(
    request.context.some(entry =>
      entry.id === "ordax-application-action-capabilities"),
    false,
    "Aura must omit removed app actions instead of reusing them",
  );
});

test("CURRENT switch withdraws published semantics before a pending signed load and prevents A-B-A resurrection", async t => {
  let observed = [slotMetadata()];
  const initial = [verifiedEntry()];
  const pendingLoads = [];
  const errors = [];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observed,
  });
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observed,
    source: {},
    fetchImpl() {},
    load() {
      return new Promise(resolve => { pendingLoads.push(resolve); });
    },
    onPublished() {},
    onError(error) { errors.push(error); },
  });
  t.after(() => { coordinator.dispose(); live.dispose(); });
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
  const before = live.getGeneration();

  // Signed B is CURRENT, but its loader is still pending.
  observed = [slotMetadata("notes", "0.4.2")];
  coordinator.refresh();
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), [],
    "published A must be withdrawn immediately on a different CURRENT slot");
  assert.ok(live.getGeneration() > before,
    "Aura inferences from A must be fenced before asynchronous verification");

  await Promise.resolve();
  assert.equal(pendingLoads.length, 1);
  // The old A slot comes back before B has finished loading and before
  // another Store notification. Its old Actions must not resurrect.
  observed = [slotMetadata()];
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), [],
    "A-B-A cannot silently restore declarations from an older publication");

  coordinator.refresh();
  await Promise.resolve();
  assert.equal(pendingLoads.length, 2);
  pendingLoads[0]([verifiedEntry("notes", "0.4.2")]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(live.actionRegistryPort.list(), [],
    "superseded B verification must not publish into the restored A slot");

  pendingLoads[1]([verifiedEntry()]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1,
    "only a fresh successful signed A verification may restore the action");
  assert.deepEqual(errors, []);
});

test("failed signed package verification never publishes but permits one later Store-triggered retry", async t => {
  const fixture = verifiedFetch();
  const observed = [slotMetadata()];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => observed,
  });
  let requests = 0;
  let notifyError;
  let notifySuccess;
  const failed = new Promise(resolve => { notifyError = resolve; });
  const succeeded = new Promise(resolve => { notifySuccess = resolve; });
  const errors = [];
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    source: createNativeVerifiedComponentPackageSource(windowRef()),
    fetchImpl: fixture.fetchImpl,
    async load(options) {
      requests++;
      if (requests === 1) throw new Error("signed package unavailable");
      return loadVerifiedFirstPartyApplicationSemantics(options);
    },
    onError(error) { errors.push(error); notifyError(); },
    onPublished() { notifySuccess(); },
  });
  t.after(() => { coordinator.dispose(); live.dispose(); });
  coordinator.refresh();
  await failed;
  assert.equal(requests, 1);
  assert.deepEqual(live.actionRegistryPort.list(), []);
  assert.match(errors[0].message, /unavailable/);

  // No uncontrolled retry loop. Exactly one new explicit Store event checks
  // the same signed CURRENT slot again.
  coordinator.refresh();
  await succeeded;
  assert.equal(requests, 2);
  assert.equal(errors.length, 1);
  assert.equal(live.actionRegistryPort.list().length, 1);
  coordinator.refresh();
  assert.equal(requests, 2);
});

test("validated provider normalization retains strict field rejection for untrusted overlays", () => {
  const entry = verifiedEntry();
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [{
      ...entry,
      providerManifest: {
        ...entry.providerManifest,
        providers: [{
          ...entry.providerManifest.providers[0],
          artifactSha256: "a".repeat(64),
          injectedAuthority: "execute",
        }],
      },
    }]),
    /fields are not canonical/,
  );
});

test("boot-verified CURRENT package is reused without redundant Store-time re-fetch", () => {
  const initial = [verifiedEntry()];
  const observations = [slotMetadata()];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observations,
  });
  let loads = 0;
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observations,
    source: {},
    fetchImpl() { throw new Error("boot package already verified"); },
    load() { loads++; throw new Error("should not fetch unchanged signed metadata"); },
    onError(error) { throw error; },
  });
  coordinator.refresh();
  coordinator.refresh();
  assert.equal(loads, 0);
  assert.equal(live.actionRegistryPort.list().length, 1);
  coordinator.dispose();
  live.dispose();
});

test("Native broker scope ignores unsupported CURRENT app slots without blocking signed Notes", async t => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  let observed = [slotMetadata("notes"), slotMetadata("clock")];
  let loads = 0;
  let loadedIds = null;
  let publish;
  let rejectPublish;
  const delivered = new Promise((resolve, reject) => {
    publish = resolve;
    rejectPublish = reject;
  });
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => observed,
  });
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    source,
    fetchImpl: fixture.fetchImpl,
    async load(args) {
      loads++;
      loadedIds = args.appIds;
      return loadVerifiedFirstPartyApplicationSemantics(args);
    },
    onPublished: publish,
    onError: rejectPublish,
  });
  t.after(() => { coordinator.dispose(); live.dispose(); });

  coordinator.refresh();
  await delivered;
  assert.deepEqual(loadedIds, ["notes"],
    "the Native component-module broker only serves policy-approved ids");
  assert.equal(loads, 1);
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
  assert.equal(live.awarenessPort.get("clock"), null);
  assert.equal(fixture.calls.length, 5);

  // Unsupported component changes must not trigger needless reads of the
  // same signed Notes artifact or publish an unverified foreign action.
  observed = [slotMetadata("notes"), slotMetadata("clock", "0.5.0")];
  coordinator.refresh();
  assert.equal(loads, 1);
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);

  observed = [slotMetadata("clock")];
  coordinator.refresh();
  assert.deepEqual(live.actionRegistryPort.list(), []);
  assert.equal(live.awarenessPort.get("notes"), null);
});

test("Native bootstrap only requests external ids supported by the verified module broker", async () => {
  const source = await import("node:fs/promises");
  const main = await source.readFile(
    new URL("../system/composition/native/main.mjs", import.meta.url), "utf8",
  );
  assert.match(main, /appIds: EXTERNAL_FIRST_PARTY_COMPONENT_IDS\.filter\(\s*hasNativeExternalFirstPartyModuleRead/);
});

test("malformed CURRENT publication invalidates pending signed load even if identical slot silently returns", async t => {
  let observed = [slotMetadata()];
  let oldResolve;
  let nextResolve;
  let publications = 0;
  let notifyPublished;
  const publication = new Promise(resolve => {
    notifyPublished = () => { if (++publications === 2) resolve(); };
  });
  let loads = 0;
  const errors = [];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => observed,
  });
  const verified = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    source: {},
    fetchImpl() { throw new Error("fixture uses the existing verified loader contract"); },
    load() {
      loads++;
      return new Promise(resolve => {
        if (loads === 1) oldResolve = resolve;
        else nextResolve = resolve;
      });
    },
    onError(error) { errors.push(error); },
    onPublished() { notifyPublished(); },
  });
  t.after(() => { verified.dispose(); live.dispose(); });

  verified.refresh();
  await Promise.resolve();
  assert.equal(loads, 1);
  assert.deepEqual(live.actionRegistryPort.list(), []);

  observed = [slotMetadata(), slotMetadata()];
  verified.refresh();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Duplicate/);

  // A silently restored CURRENT observation must not rescue a load
  // that was entered before a malformed Store event.
  observed = [slotMetadata()];
  oldResolve([verifiedEntry()]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(live.actionRegistryPort.list(), [],
    "the revoked generation must never publish after an invalid Store event");

  // An explicit subsequent Store event may revalidate the same identity.
  verified.refresh();
  await Promise.resolve();
  assert.equal(loads, 2);
  nextResolve([verifiedEntry()]);
  await publication;
  assert.equal(live.actionRegistryPort.list().length, 1);
});

test("invalid Store CURRENT withdraws previously published app semantics until fresh signed read", async t => {
  let observed = [slotMetadata()];
  const initial = [verifiedEntry()];
  const errors = [];
  let publish;
  let publications = 0;
  const republished = new Promise(resolve => {
    publish = () => { if (++publications === 2) resolve(); };
  });
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observed,
  });
  let loads = 0;
  const refresh = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    initialVerifiedSemantics: initial,
    source: {},
    fetchImpl() {},
    load: async () => { loads++; return initial; },
    onPublished() { publish(); },
    onError(error) { errors.push(error); },
  });
  t.after(() => { refresh.dispose(); live.dispose(); });
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
  refresh.refresh();
  assert.equal(loads, 0, "unchanged signed bootstrap must not reload");

  observed = [slotMetadata(), slotMetadata()];
  refresh.refresh();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Duplicate/);

  // Even when the same signed slot later reappears without a Store event,
  // old declarations and suggestions may not revive automatically.
  observed = [slotMetadata()];
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 0);
  assert.equal(live.awarenessPort.get("notes"), null);
  assert.deepEqual(live.semanticRouterPort.select("Crie uma nota"), []);

  refresh.refresh();
  await republished;
  assert.equal(loads, 1);
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
});

test("invalid Store CURRENT notifies the same live Fabric subscribers after withdrawing stale Actions", t => {
  let observed = [slotMetadata()];
  const initial = [verifiedEntry()];
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  }, { systemMetricsAvailable: true });
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observed,
  });
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => live.actionRegistryPort,
  });
  const delivered = [];
  const errors = [];
  const unsubscribe = fabric.subscribe(snapshot => delivered.push(snapshot));
  const refresh = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => observed,
    initialVerifiedSemantics: initial,
    source: {},
    fetchImpl() {},
    onPublished() {
      // The same callback installed in native/main.mjs, and only the
      // existing Fabric subscription should carry this withdrawal.
      fabric.refresh();
    },
    onError(error) { errors.push(error); },
  });
  t.after(() => {
    unsubscribe();
    refresh.dispose();
    live.dispose();
    host.dispose();
  });
  assert.equal(fabric.snapshot().entries.filter(item => item.kind === "application-action").length, 1);
  assert.equal(delivered.length, 0);

  observed = [{ ...slotMetadata(), version: "invalid-not-semver" }];
  assert.throws(() => fabric.refresh(), /version|invalid|metadata/i,
    "the malformed CURRENT must fail closed before the owner withdraws its old generation");
  refresh.refresh();

  assert.equal(errors.length, 1);
  assert.equal(delivered.length, 1,
    "a withdrawal must deliver one real event to existing Fabric subscribers");
  assert.equal(delivered[0].entries.filter(item => item.kind === "application-action").length, 0);
  assert.equal(live.actionRegistryPort.list().length, 0);
});

test("Native Store HTTP refresh propagates CURRENT install and removal to Fabric through its original event subscription", { timeout: 10000 }, async t => {
  const packageFixture = verifiedFetch();
  const origin = windowRef();
  let notesInstalled = false;
  const httpCalls = [];
  const catalog = {
    schema: "ordax.verified-app-store-catalog/1",
    state: "ready",
    sequence: 1,
    catalogSha256: "f".repeat(64),
    source: { repository: "ordaxsystems/ordax-apps", commit: SHA },
    trust: { domain: "runtime-components", keyId: "ordax-runtime-components-v1" },
    entries: [{
      appId: "notes",
      title: "Notas",
      version: "0.4.1",
      releaseMode: "component-slot",
      sourceCommit: SHA,
      artifacts: {
        package: { name: "notes.zip", sha256: "b".repeat(64), size: 123 },
        release: { name: "notes.release.json", sha256: "c".repeat(64), size: 123 },
        compatibility: { name: "notes.compatibility.json", sha256: "d".repeat(64), size: 123 },
        componentEnvelope: {
          name: "notes.runtime-component-envelope.json",
          sha256: "e".repeat(64), size: 123,
        },
      },
    }],
    reason: null,
    authority: "none",
  };
  const nativeWindow = {
    ...origin,
    async fetch(url, options) {
      httpCalls.push(String(url));
      if (url === "/__ordax/native/store-catalog") return jsonResponse(catalog);
      const parsed = new URL(url, origin.location.href);
      if (parsed.pathname === "/__ordax/native/component-runtime") {
        const appId = parsed.searchParams.get("component");
        return jsonResponse(notesInstalled && appId === "notes"
          ? slotMetadata("notes")
          : {
              componentId: appId, state: "current", source: "absent",
              revision: 1, version: null, sourceCommit: null,
              entrypoint: null, pendingHealth: null,
            });
      }
      return packageFixture.fetchImpl(url, options);
    },
  };
  const store = await createNativeStoreCatalogComposition({
    windowRef: nativeWindow,
    componentSource: createNativeVerifiedComponentPackageSource(nativeWindow),
  });
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => store.getCurrentObservations(),
  });
  const host = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  }, { systemMetricsAvailable: true });
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => host,
    getApplicationActions: () => live.actionRegistryPort,
  });
  const personal = createNativePersonalOrdaxComposition({
    windowRef: {
      localStorage: { getItem: () => null, setItem() {} },
    },
    identitySession: {
      schema: IDENTITY_SESSION_SCHEMA,
      getSnapshot: () => ({
        state: "signed-in", subjectId: "notes-owner", displayName: "Owner",
      }),
      subscribe: () => () => {},
    },
    intelligence: null,
    applicationActionCapabilityRegistry: live.actionRegistryPort,
    applicationSemanticRouter: live.semanticRouterPort,
    getCapabilityDiscovery: () => fabric,
  });
  t.after(() => personal.dispose());
  let auraContext = [];
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready", inferenceAvailable: true,
        engineId: "local", modelId: "test",
        authority: "none", toolExecution: false,
      }),
      subscribe: () => () => {},
      async respond(request) {
        auraContext = request.context;
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "ok", engineId: "local", modelId: "test",
          authority: "none",
        };
      },
    },
    awarenessPort: live.awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getCapabilityDiscovery: () => fabric,
  });
  const notifications = [];
  const failures = [];
  const unsubscribeFabric = fabric.subscribe(value => notifications.push(
    value.entries.filter(item => item.kind === "application-action").length,
  ));
  let resolveInstall;
  const installedEvent = new Promise(resolve => { resolveInstall = resolve; });
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations: () => store.getCurrentObservations(),
    source: createNativeVerifiedComponentPackageSource(nativeWindow),
    fetchImpl: nativeWindow.fetch.bind(nativeWindow),
    onPublished() {
      fabric.refresh();
      personal.reconcileApprovedAuthority();
      if (live.actionRegistryPort.listForApp("notes").length === 1) resolveInstall();
    },
    onError(error) { failures.push(error); },
  });
  const unsubscribeStore = store.port.subscribe(() => {
    personal.reconcileApprovedAuthority();
    fabric.refresh();
    coordinator.refresh();
  });
  t.after(() => {
    unsubscribeStore();
    unsubscribeFabric();
    coordinator.dispose();
    live.dispose();
    host.dispose();
    store.destroy();
  });
  coordinator.refresh();
  assert.deepEqual(failures, []);
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), []);

  // Go accepting staging does not authorize a pending-health candidate.
  // Only the verified CURRENT reader may expose the promoted app.
  const readsBeforePending = packageFixture.calls.length;
  await store.refresh();
  assert.equal(store.getCurrentObservations().find(item =>
    item.componentId === "notes").source, "absent");
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), []);
  assert.equal(fabric.snapshot().entries.filter(item =>
    item.kind === "application-action").length, 0);
  assert.equal(packageFixture.calls.length, readsBeforePending,
    "a pending candidate must not enter the signed semantic catalog");

  notesInstalled = true;
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), [],
    "a later promotion cannot become visible without a Store observation");
  await store.refresh();
  await installedEvent;
  assert.deepEqual(failures, []);
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
  assert.equal(fabric.snapshot().entries.filter(item =>
    item.kind === "application-action").length, 1);
  assert.ok(notifications.includes(1),
    "installation must reach the existing Fabric subscription without a manual catalog refresh");
  assert.equal(personal.listAvailableApplicationActions("notes").length, 1);
  assert.equal(personal.proposeApplicationAction("notes", "notes.create-note", {}).executionAuthorized, false);
  await aura.respond({ prompt: "Crie uma nota" });
  const auraActions = auraContext.find(item => item.id === "ordax-application-action-capabilities");
  assert.ok(auraActions);
  assert.equal(JSON.parse(auraActions.text).actions[0].appId, "notes");
  assert.equal(packageFixture.calls.length, 4,
    "only the verified module package loader reads app-owned manifests");
  assert.ok(httpCalls.includes("/__ordax/native/store-catalog"));

  notesInstalled = false;
  await store.refresh();
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 0);
  assert.equal(fabric.snapshot().entries.filter(item =>
    item.kind === "application-action").length, 0);
  assert.deepEqual(personal.listAvailableApplicationActions("notes"), []);
  await aura.respond({ prompt: "Crie uma nota" });
  assert.equal(auraContext.some(item => item.id === "ordax-application-action-capabilities"), false);
  assert.equal(notifications.at(-1), 0,
    "removal must notify the SAME Fabric subscriber before it can show stale actions");
  assert.deepEqual(failures, []);
});

test("Aura rejects a stale verified semantic generation even when the public Fabric action projection is unchanged", async t => {
  const initial = [verifiedEntry()];
  const current = [slotMetadata()];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => current,
  });
  const fabric = createCapabilityDiscovery({
    getFoundation: () => createSystemFoundationRuntime(),
    getApplicationActions: () => live.actionRegistryPort,
  });
  t.after(() => live.dispose());
  let begin;
  const started = new Promise(resolve => { begin = resolve; });
  let release;
  const pendingResult = new Promise(resolve => { release = resolve; });
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA, state: "ready",
        inferenceAvailable: true, engineId: "local",
        modelId: "test", authority: "none", toolExecution: false,
      }),
      subscribe: () => () => {},
      async respond() {
        begin();
        await pendingResult;
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "stale app guidance", engineId: "local",
          modelId: "test", authority: "none",
        };
      },
    },
    awarenessPort: live.awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getCapabilityDiscovery: () => fabric,
    getApplicationSemanticsGeneration: () => live.getGeneration(),
  });
  const publicRevisionBefore = fabric.snapshot().revision;
  const reply = aura.respond({ prompt: "Crie uma nota" });
  await started;
  // A -> B -> A manifest generation changed while no consumer queried the
  // public discovery; its action identity and revision look unchanged.
  live.replaceVerifiedSemantics([], { attestCurrent: false });
  live.replaceVerifiedSemantics([verifiedEntry()]);
  assert.equal(fabric.snapshot().revision, publicRevisionBefore,
    "the same public actions must not mask a prior semantic generation change");
  release();
  await assert.rejects(reply, /semantic generation changed|semantics changed/i);
});

test("nonempty semantic publication cannot bypass CURRENT attestation through withdrawal mode", () => {
  let reads = 0;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations() { reads++; return []; },
  });
  try {
    const before = live.getGeneration();
    assert.throws(
      () => live.replaceVerifiedSemantics([verifiedEntry()], { attestCurrent: false }),
      /CURRENT attestation.*nonempty|nonempty.*CURRENT attestation/i,
      "withdrawal-only mode must never publish unverified actions or Aura manifests",
    );
    assert.equal(live.getGeneration(), before, "rejected publication must not change Aura generation");
    assert.equal(live.awarenessPort.get("notes"), null);
    assert.deepEqual(live.actionRegistryPort.list(), []);
    assert.equal(reads, 0, "reject invalid mode before any Native observation read");
    live.replaceVerifiedSemantics([], { attestCurrent: false });
    assert.equal(live.getGeneration(), before + 1, "empty fail-closed withdrawal remains permitted");
  } finally {
    live.dispose();
  }
});

test("verified App owner advances a single monotonic semantic generation and invalidates consumers on disposal", () => {
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations: () => [slotMetadata()],
  });
  const before = live.getGeneration();
  live.replaceVerifiedSemantics([verifiedEntry()]);
  assert.ok(live.getGeneration() > before);
  const next = live.getGeneration();
  live.replaceVerifiedSemantics([], { attestCurrent: false });
  assert.ok(live.getGeneration() > next);
  live.dispose();
  assert.throws(() => live.getGeneration(), /disposed/);
});

test("Aura streaming withdraws stale chunks after a semantic-only App manifest generation change", async t => {
  const initial = [verifiedEntry()];
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => [slotMetadata()],
  });
  t.after(() => live.dispose());
  const fabric = createCapabilityDiscovery({
    getFoundation: () => createSystemFoundationRuntime(),
    getApplicationActions: () => live.actionRegistryPort,
  });
  const before = fabric.snapshot().revision;
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const chunks = [];
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA, state: "ready",
        inferenceAvailable: true, engineId: "local",
        modelId: "test", authority: "none", toolExecution: false,
      }),
      subscribe: () => () => {},
      async respond(_request, { onDelta } = {}) {
        onDelta?.("old first chunk");
        entered();
        await pending;
        onDelta?.("invalid after generation change");
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA, text: "old answer",
          engineId: "local", modelId: "test", authority: "none",
        };
      },
    },
    awarenessPort: live.awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getCapabilityDiscovery: () => fabric,
    getApplicationSemanticsGeneration: () => live.getGeneration(),
  });
  const result = aura.respond({ prompt: "Crie uma nota" }, {
    onDelta: value => chunks.push(value),
  });
  await began;
  live.replaceVerifiedSemantics([verifiedEntry()]);
  assert.equal(fabric.snapshot().revision, before,
    "a semantic-only generation must not rely on public action revision");
  release();
  await assert.rejects(result, /semantic generation changed/);
  assert.deepEqual(chunks, ["old first chunk"]);
});

test("Aura semantic generation fence preserves a stable verified App response", async t => {
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [verifiedEntry()],
    getCurrentObservations: () => [slotMetadata()],
  });
  t.after(() => live.dispose());
  const fabric = createCapabilityDiscovery({
    getFoundation: () => createSystemFoundationRuntime(),
    getApplicationActions: () => live.actionRegistryPort,
  });
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA, state: "ready",
        inferenceAvailable: true, engineId: "local",
        modelId: "test", authority: "none", toolExecution: false,
      }),
      subscribe: () => () => {},
      async respond() {
        return {
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "fresh verified guidance",
          engineId: "local", modelId: "test", authority: "none",
        };
      },
    },
    awarenessPort: live.awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getCapabilityDiscovery: () => fabric,
    getApplicationSemanticsGeneration: () => live.getGeneration(),
  });
  const response = await aura.respond({ prompt: "Crie uma nota" });
  assert.equal(response.text, "fresh verified guidance");
});

test("malformed unsupported CURRENT metadata cannot silently preserve verified Notes capabilities", async t => {
  const initial = [verifiedEntry()];
  let observed = [slotMetadata("notes")];
  const errors = [];
  let loads = 0;
  let published = null;
  const recovered = new Promise(resolve => { published = resolve; });
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observed,
  });
  const coordinator = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    initialVerifiedSemantics: initial,
    getCurrentObservations: () => observed,
    source: {},
    fetchImpl: () => { throw new Error("fixture must use the injected verified loader"); },
    load: async () => { loads++; return initial; },
    onError: error => errors.push(error),
    onPublished: () => {
      if (loads > 0 && live.actionRegistryPort.listForApp("notes").length === 1) {
        published();
      }
    },
  });
  t.after(() => { coordinator.dispose(); live.dispose(); });
  coordinator.refresh();
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);

  // Clock has no Native module-read authority, but a malformed CURRENT
  // observation for it still makes the Store publication untrustworthy.
  observed = [slotMetadata("notes"), { ...slotMetadata("clock"), version: "not-semver" }];
  coordinator.refresh();
  assert.equal(errors.length, 1, "malformed unsupported metadata must not be silently ignored");
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), [],
    "all live app capabilities must be withdrawn on malformed Store CURRENT");
  assert.equal(live.awarenessPort.contextItem().text.includes('"appId":"notes"'), false);
  assert.equal(loads, 0, "validation failure must not start any module read");

  // A later, explicit valid Store event is required for the same Notes
  // identity to be re-attested, even if it never changed its signed commit.
  observed = [slotMetadata("notes"), slotMetadata("clock")];
  coordinator.refresh();
  await recovered;
  assert.equal(loads, 1);
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
  assert.equal(errors.length, 1);
  // A duplicate record for an unsupported component also makes CURRENT
  // invalid; it cannot be skipped before rejecting the entire publication.
  observed = [slotMetadata("notes"), slotMetadata("clock"), slotMetadata("clock")];
  coordinator.refresh();
  assert.equal(errors.length, 2);
  assert.match(errors[1].message, /Duplicate verified CURRENT/);
  assert.deepEqual(live.actionRegistryPort.listForApp("notes"), []);
  assert.equal(loads, 1, "duplicated unsupported metadata cannot trigger module reads");
});

test("verified semantic replacement cannot commit when final CURRENT silently withdraws its actions", () => {
  let reads = 0;
  let changeOnFinalRead = true;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations() {
      reads += 1;
      return changeOnFinalRead && reads === 2 ? [] : [slotMetadata()];
    },
  });
  try {
    const oldGeneration = live.getGeneration();
    assert.throws(
      () => live.replaceVerifiedSemantics([verifiedEntry()]),
      /CURRENT.*(changed|drift|lost)|lost.*CURRENT/i,
      "a vanished CURRENT app must prevent publishing its verified Aura and Personal owner",
    );
    assert.equal(reads, 2, "the final action projection must detect the disappearing slot");
    assert.equal(live.getGeneration(), oldGeneration,
      "silent loss must not advance the semantic generation");
    assert.equal(live.awarenessPort.get("notes"), null);
    assert.deepEqual(live.actionRegistryPort.list(), []);
    changeOnFinalRead = false;
    assert.equal(live.replaceVerifiedSemantics([verifiedEntry()]).length, 1);
    assert.equal(live.getGeneration(), oldGeneration + 1);
  } finally {
    live.dispose();
  }
});

test("semantic-only apps also require a final CURRENT check before publication", () => {
  let reads = 0;
  const semanticOnly = {
    ...verifiedEntry(),
    actionManifest: null,
    providerManifest: null,
  };
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations() {
      reads++;
      return reads === 2 ? [] : [slotMetadata()];
    },
  });
  try {
    const original = live.getGeneration();
    assert.throws(() => live.replaceVerifiedSemantics([semanticOnly]),
      /CURRENT.*(changed|drift|lost)|lost.*CURRENT/i);
    assert.equal(reads, 2,
      "even a signed app without Action manifest needs final CURRENT attestation");
    assert.equal(live.getGeneration(), original);
    assert.equal(live.awarenessPort.get("notes"), null);
  } finally {
    live.dispose();
  }
});

test("mixed Action and semantic-only apps cannot pass mutually exclusive final CURRENT reads", () => {
  const semanticOnly = {
    ...verifiedEntry("studio"),
    actionManifest: null,
    providerManifest: null,
  };
  const entries = [verifiedEntry("notes"), semanticOnly];
  let reads = 0;
  let drift = true;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations() {
      reads += 1;
      if (!drift || reads === 1) {
        return [slotMetadata("notes"), slotMetadata("studio")];
      }
      if (reads === 2) return [slotMetadata("notes")];
      return [slotMetadata("studio")];
    },
  });
  try {
    const generation = live.getGeneration();
    assert.throws(() => live.replaceVerifiedSemantics(entries),
      /CURRENT.*(changed|drift|lost)|lost.*CURRENT/i,
      "two different CURRENT generations must not jointly attest the same publication");
    assert.equal(reads, 3, "prove the Store changed between final action and semantic reads");
    assert.equal(live.getGeneration(), generation);
    assert.equal(live.awarenessPort.get("studio"), null);
    assert.deepEqual(live.actionRegistryPort.list(), []);
    drift = false;
    const published = live.replaceVerifiedSemantics(entries);
    assert.equal(published.length, 1);
    assert.equal(live.getGeneration(), generation + 1);
  } finally {
    live.dispose();
  }
});

test("Aura context and router use one CURRENT observation for competing verified apps", () => {
  const verified = [verifiedEntry("notes"), verifiedEntry("studio")];
  let reads = 0;
  let alternating = false;
  let tick = 0;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: verified,
    getCurrentObservations() {
      reads++;
      if (alternating) {
        return ++tick % 2 ? [slotMetadata("notes")] : [slotMetadata("studio")];
      }
      return [slotMetadata("notes"), slotMetadata("studio")];
    },
  });
  try {
    const initial = JSON.parse(live.awarenessPort.contextItem().text);
    assert.deepEqual(initial.applications.filter(x =>
      ["notes", "studio"].includes(x.appId)).map(x => x.appId),
    ["notes", "studio"], "both signed apps are initially CURRENT");
    alternating = true;
    const beforeContext = reads;
    const context = JSON.parse(live.awarenessPort.contextItem().text);
    assert.equal(reads - beforeContext, 1,
      "Aura context should not mix two incompatible Store generations");
    assert.equal(context.applications.filter(x =>
      ["notes", "studio"].includes(x.appId)).length, 1);
    const beforeRoute = reads;
    const selection = live.semanticRouterPort.select("Crie uma nota");
    assert.equal(reads - beforeRoute, 1,
      "Aura routing must check competing manifests from the same CURRENT publication");
    assert.equal(selection.filter(x =>
      ["notes", "studio"].includes(x.appId)).length, 1);
  } finally {
    live.dispose();
  }
});

test("Aura assembles all app context from one synchronous CURRENT observation", async () => {
  const verified = [verifiedEntry("notes"), verifiedEntry("studio")];
  let reads = 0;
  let tick = 0;
  let flip = false;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: verified,
    getCurrentObservations() {
      reads++;
      if (!flip) return [slotMetadata("notes"), slotMetadata("studio")];
      return Math.floor(tick++ / 2) % 2 === 0
        ? [slotMetadata("notes")] : [slotMetadata("studio")];
    },
  });
  let observedContext = [];
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA, state: "ready",
        inferenceAvailable: true, engineId: "local", modelId: "test",
        authority: "none", toolExecution: false,
      }),
      subscribe: () => () => {},
      respond(request) {
        observedContext = request.context;
        return Promise.resolve({
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "ok", engineId: "local", modelId: "test",
          authority: "none",
        });
      },
    },
    awarenessPort: live.awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getApplicationSemanticsGeneration: () => live.getGeneration(),
    withCurrentAppSnapshot: callback => live.withCurrentSnapshot(callback),
  });
  try {
    flip = true;
    const before = reads;
    await aura.respond({ prompt: "Crie uma nota" });
    assert.equal(reads - before, 2,
      "Aura must read one pinned CURRENT view and re-attest just before inference");
    const catalog = JSON.parse(observedContext.find(x =>
      x.id === "ordax-application-catalog").text);
    const currentApps = catalog.applications.filter(x =>
      ["notes", "studio"].includes(x.appId)).map(x => x.appId);
    assert.deepEqual(currentApps, ["notes"]);
    const details = observedContext.filter(x =>
      x.id.startsWith("ordax-application-detail:"));
    assert.ok(details.every(x => x.id.endsWith(":notes")));
    const actions = observedContext.find(x =>
      x.id === "ordax-application-action-capabilities");
    assert.ok(actions);
    assert.deepEqual(JSON.parse(actions.text).actions.map(x => x.appId), ["notes"]);
    const next = reads;
    await aura.respond({ prompt: "Crie uma nota" });
    assert.equal(reads - next, 2,
      "the next Aura request must read and re-attest fresh CURRENT");
    const second = JSON.parse(observedContext.find(x =>
      x.id === "ordax-application-catalog").text);
    assert.deepEqual(second.applications.filter(x =>
      ["notes", "studio"].includes(x.appId)).map(x => x.appId), ["studio"]);
    const secondActions = observedContext.find(x =>
      x.id === "ordax-application-action-capabilities");
    assert.ok(secondActions);
    assert.deepEqual(JSON.parse(secondActions.text).actions.map(x => x.appId),
      ["studio"], "the second request cannot carry stale Notes actions");
  } finally {
    live.dispose();
  }
});

test("Aura never sends context withdrawn synchronously during its composition", () => {
  let observations = [slotMetadata("notes")];
  let providerCalls = 0;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [verifiedEntry("notes")],
    getCurrentObservations: () => observations,
  });
  const awarenessPort = Object.freeze({
    ...live.awarenessPort,
    contextItem() {
      // Simulate reentrant signed Store withdrawal between the pinned
      // first CURRENT read and the remaining Aura context construction.
      observations = [];
      return live.awarenessPort.contextItem();
    },
  });
  const aura = createApplicationContextIntelligence({
    intelligencePort: {
      schema: INTELLIGENCE_PORT_SCHEMA,
      getSnapshot: () => ({
        schema: INTELLIGENCE_PORT_SCHEMA, state: "ready",
        inferenceAvailable: true, engineId: "local", modelId: "test",
        authority: "none", toolExecution: false,
      }),
      subscribe: () => () => {},
      respond() {
        providerCalls++;
        return Promise.resolve({
          schema: INTELLIGENCE_RESPONSE_SCHEMA,
          text: "should not execute", engineId: "local", modelId: "test",
          authority: "none",
        });
      },
    },
    awarenessPort,
    actionCapabilityRegistryPort: live.actionRegistryPort,
    semanticRouterPort: live.semanticRouterPort,
    getApplicationSemanticsGeneration: () => live.getGeneration(),
    withCurrentAppSnapshot: callback => live.withCurrentSnapshot(callback),
  });
  try {
    assert.throws(() => aura.respond({ prompt: "Crie uma nota" }),
      /CURRENT.*changed|changed.*CURRENT|Store.*changed/i,
      "a reentrant Store withdrawal must reject before any inference call");
    assert.equal(providerCalls, 0);
  } finally {
    live.dispose();
  }
});

test("verified semantic replacement never commits if CURRENT becomes unreadable during final action projection", () => {
  let reads = 0;
  let failFinalRead = true;
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations() {
      reads++;
      if (failFinalRead && reads === 2) {
        throw new Error("Native CURRENT read unavailable after initial attestation");
      }
      return [slotMetadata()];
    },
  });
  try {
    const beforeGeneration = live.getGeneration();
    assert.throws(() => live.replaceVerifiedSemantics([verifiedEntry()]),
      /CURRENT read unavailable/);
    assert.equal(reads, 2, "reproduce the drift between initial attestation and projected Actions");
    assert.equal(live.getGeneration(), beforeGeneration,
      "a failing publication must not advance the Aura semantic fence");
    assert.equal(live.awarenessPort.get("notes"), null,
      "failed publication must leave the exact previous semantic generation active");
    assert.deepEqual(live.actionRegistryPort.list(), []);
    assert.deepEqual(live.semanticRouterPort.select("Crie uma nota"), []);

    failFinalRead = false;
    const actions = live.replaceVerifiedSemantics([verifiedEntry()]);
    assert.equal(actions.length, 1);
    assert.equal(live.getGeneration(), beforeGeneration + 1);
    assert.equal(live.awarenessPort.get("notes").appId, "notes");
  } finally {
    live.dispose();
  }
});

test("Store coordinator treats a late CURRENT failure as an uncommitted generation and retries only on a later Store event", async t => {
  let reads = 0;
  let failFinalRead = true;
  let loads = 0;
  const errors = [];
  let failSignal;
  const failed = new Promise(resolve => { failSignal = resolve; });
  let successSignal;
  const succeeded = new Promise(resolve => { successSignal = resolve; });
  const getCurrentObservations = () => {
    reads++;
    // One Store coordinator read, then candidate pre-attestation, then
    // the final Action projection. The last read fails only on attempt 1.
    if (failFinalRead && reads === 3) {
      throw new Error("CURRENT temporarily unavailable before publication");
    }
    return [slotMetadata()];
  };
  const live = createLiveVerifiedApplicationSemantics({
    baseApplications: listFirstPartyApps(),
    bundledManifests: [],
    initialVerifiedSemantics: [],
    getCurrentObservations,
  });
  let published = 0;
  const refresh = createVerifiedSemanticsRefresh({
    liveSemantics: live,
    getCurrentObservations,
    source: {},
    fetchImpl() { throw new Error("loader fixture does not read packages"); },
    load: async () => { loads++; return [verifiedEntry()]; },
    onError(error) { errors.push(error); failSignal(); },
    onPublished() { published++; successSignal(); },
  });
  t.after(() => { refresh.dispose(); live.dispose(); });

  const before = live.getGeneration();
  refresh.refresh();
  await failed;
  assert.equal(reads, 3);
  assert.equal(loads, 1);
  assert.match(errors[0].message, /CURRENT temporarily unavailable/);
  assert.equal(published, 0,
    "a failed last read must not be reported to Fabric as an installed action");
  assert.equal(live.getGeneration(), before);
  assert.deepEqual(live.actionRegistryPort.list(), []);
  assert.equal(live.awarenessPort.get("notes"), null);

  failFinalRead = false;
  refresh.refresh(); // An explicit subsequent Store event, never auto-retry.
  await succeeded;
  assert.equal(loads, 2);
  assert.equal(errors.length, 1);
  assert.equal(published, 1);
  assert.equal(live.getGeneration(), before + 1);
  assert.equal(live.actionRegistryPort.listForApp("notes").length, 1);
});
