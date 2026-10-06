import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA,
  APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA,
  APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE,
  assertApplicationActionProviderActivationBroker,
  validateApplicationActionProviderActivation,
} from "../system/contracts/application-action-provider-activation.mjs";
import {
  APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
} from "../system/contracts/application-action-provider-resolution.mjs";
import {
  createApplicationActionProviderActivationBroker,
} from "../system/services/personal-ordax/application-action-provider-activation-broker.mjs";

const OWNER = "washingtonmsdj/ordax-apps";
const SOURCE_COMMIT = "7".repeat(40);
const PROVIDER_SHA = "a".repeat(64);
const CAPABILITY_SHA = "c".repeat(64);
const RESOURCE_REF = "application-action:prep-activation-1";

function resolution(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_PROVIDER_RESOLUTION_SCHEMA,
    resourceRef: RESOURCE_REF,
    workItemId: "personal-work-activation-1",
    appId: "notes",
    actionId: "notes.create-note",
    appVersion: "0.4.3",
    sourceCommit: SOURCE_COMMIT,
    componentRevision: 12,
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
      module: "actions/providers/notes-native.mjs",
      artifactSha256: PROVIDER_SHA,
    },
    capabilitySha256: CAPABILITY_SHA,
    capabilityProvenance: "ordax-apps:notes",
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    ...overrides,
  };
}

function component({ owner = OWNER } = {}) {
  return {
    schema: "ordax.component-manifest/1",
    id: "notes",
    title: "Notas",
    kind: "app",
    version: "0.4.3",
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner,
    dependencies: [],
  };
}

function actionManifest({ providerRevision = "2" } = {}) {
  return {
    schema: "ordax.application-action-manifest/1",
    appId: "notes",
    appVersion: "0.4.3",
    authority: "none",
    execution: "proposal-only",
    capabilities: [{
      schema: "ordax.application-action-capability/1",
      appId: "notes",
      actionId: "notes.create-note",
      title: "Criar nota",
      description: "Criar uma nota.",
      sourceClass: "first-party",
      platform: "ordax",
      provider: {
        kind: "first-party-native",
        adapterId: "notes-native",
        revision: providerRevision,
      },
      binding: { payloadSha256: null },
      parameters: [{
        id: "title",
        type: "string",
        required: false,
        maxLength: 240,
      }],
      riskClass: "local-change",
      confirmation: "policy-gated",
      executionAuthorized: false,
      modelDirectExecutionAuthorized: false,
      provenance: "ordax-apps:notes",
    }],
  };
}

function providerManifest({
  execution = "unavailable",
  artifactSha256 = PROVIDER_SHA,
} = {}) {
  return {
    schema: "ordax.application-action-provider-manifest/1",
    appId: "notes",
    appVersion: "0.4.3",
    authority: "none",
    execution,
    providers: [{
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
      module: "actions/providers/notes-native.mjs",
      sha256: artifactSha256,
    }],
  };
}

function semantics({
  owner = OWNER,
  execution = "unavailable",
  artifactSha256 = PROVIDER_SHA,
  providerRevision = "2",
  revision = 12,
} = {}) {
  const app = component({ owner });
  return {
    application: {
      id: app.id,
      title: app.title,
      component: app,
    },
    intelligenceManifest: null,
    actionManifest: actionManifest({ providerRevision }),
    providerManifest: providerManifest({ execution, artifactSha256 }),
    sourceCommit: SOURCE_COMMIT,
    revision,
  };
}

function artifactResolver(values = [resolution(), resolution()]) {
  let calls = 0;
  return {
    schema: APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
    async resolve(resourceRef) {
      calls += 1;
      if (resourceRef !== RESOURCE_REF) return null;
      return values[Math.min(calls - 1, values.length - 1)] ?? null;
    },
    get calls() {
      return calls;
    },
  };
}

function semanticsResolver(value = semantics()) {
  let calls = 0;
  return {
    async resolve(appId) {
      calls += 1;
      return appId === "notes" ? value : null;
    },
    get calls() {
      return calls;
    },
  };
}

function broker({
  artifacts = artifactResolver(),
  verified = semanticsResolver(),
  expectedOwner = OWNER,
} = {}) {
  return createApplicationActionProviderActivationBroker({
    providerArtifactResolver: artifacts,
    resolveVerifiedSemantics: (appId) => verified.resolve(appId),
    expectedOwner,
  });
}

test("activation contract can only represent broker-only unavailable state", () => {
  const value = validateApplicationActionProviderActivation({
    schema: APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA,
    resolution: resolution(),
    providerExecution: "unavailable",
    state: APPLICATION_ACTION_PROVIDER_ACTIVATION_STATE,
    brokerOnly: true,
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });

  assert.equal(value.state, "unavailable");
  assert.equal(value.brokerOnly, true);
  assert.equal(value.authority, "none");
  assert.equal(value.executionAuthorized, false);
  assert.equal(value.modelDirectExecutionAuthorized, false);

  assert.throws(
    () => validateApplicationActionProviderActivation({
      ...value,
      state: "active",
    }),
    /broker-only and unavailable/,
  );
  assert.throws(
    () => validateApplicationActionProviderActivation({
      ...value,
      authority: "provider",
      executionAuthorized: true,
    }),
    /cannot grant authority/,
  );
});

test("activation broker returns exact unavailable state without loading or invoking provider code", async () => {
  const artifacts = artifactResolver();
  const verified = semanticsResolver();
  const port = broker({ artifacts, verified });

  const value = await port.resolve(RESOURCE_REF);

  assert.equal(port.schema, APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA);
  assert.equal(artifacts.calls, 2);
  assert.equal(verified.calls, 1);
  assert.equal(value.schema, APPLICATION_ACTION_PROVIDER_ACTIVATION_SCHEMA);
  assert.equal(value.resolution.provider.artifactSha256, PROVIDER_SHA);
  assert.equal(value.providerExecution, "unavailable");
  assert.equal(value.state, "unavailable");
  assert.equal(value.brokerOnly, true);
  assert.equal(value.authority, "none");
  assert.equal(value.executionAuthorized, false);
  assert.equal(value.modelDirectExecutionAuthorized, false);

  for (const method of [
    "activate",
    "deactivate",
    "execute",
    "invoke",
    "run",
    "launch",
    "import",
    "load",
    "loadAdapter",
    "grant",
    "authorize",
    "confirm",
    "mount",
    "registerAdapter",
  ]) {
    assert.equal(port[method], undefined);
  }
});

test("activation broker returns null without semantics I/O when artifact resolution is absent", async () => {
  const artifacts = artifactResolver([null]);
  const verified = semanticsResolver();
  const port = broker({ artifacts, verified });

  assert.equal(await port.resolve(RESOURCE_REF), null);
  assert.equal(artifacts.calls, 1);
  assert.equal(verified.calls, 0);
});

test("activation broker fails closed while provider manifest execution remains unavailable-only", async () => {
  const artifacts = artifactResolver();
  const verified = semanticsResolver(semantics({ execution: "broker-only" }));
  const port = broker({ artifacts, verified });

  await assert.rejects(
    () => port.resolve(RESOURCE_REF),
    /execution must remain unavailable/,
  );
  assert.equal(artifacts.calls, 1);
  assert.equal(verified.calls, 1);
});

test("activation broker rejects verified provider artifact drift", async () => {
  const artifacts = artifactResolver();
  const verified = semanticsResolver(
    semantics({ artifactSha256: "b".repeat(64) }),
  );
  const port = broker({ artifacts, verified });

  await assert.rejects(
    () => port.resolve(RESOURCE_REF),
    /artifact drifted/,
  );
  assert.equal(artifacts.calls, 1);
});

test("activation broker rejects capability provider drift", async () => {
  const artifacts = artifactResolver();
  const verified = semanticsResolver(
    semantics({ providerRevision: "3" }),
  );
  const port = broker({ artifacts, verified });

  await assert.rejects(
    () => port.resolve(RESOURCE_REF),
    /capability drifted/,
  );
  assert.equal(artifacts.calls, 1);
});

test("activation broker rejects artifact resolution drift across activation check", async () => {
  const first = resolution();
  const changed = resolution({
    capabilitySha256: "d".repeat(64),
  });
  const artifacts = artifactResolver([first, changed]);
  const port = broker({ artifacts });

  await assert.rejects(
    () => port.resolve(RESOURCE_REF),
    /resolution changed during activation check/,
  );
  assert.equal(artifacts.calls, 2);
});

test("activation broker requires canonical owner and rejects owner drift", async () => {
  assert.throws(
    () => broker({ expectedOwner: null }),
    /expected owner is invalid/,
  );

  const port = broker({
    verified: semanticsResolver(semantics({ owner: "foreign/apps" })),
  });
  await assert.rejects(
    () => port.resolve(RESOURCE_REF),
    /verified application drifted/,
  );
});

test("activation broker port cannot expose an activation or execution side channel", () => {
  const safe = {
    schema: APPLICATION_ACTION_PROVIDER_ACTIVATION_BROKER_SCHEMA,
    resolve() { return null; },
  };
  assert.equal(assertApplicationActionProviderActivationBroker(safe), safe);
  assert.throws(
    () => assertApplicationActionProviderActivationBroker({
      ...safe,
      activate() {},
    }),
    /must not expose activate/,
  );
  assert.throws(
    () => assertApplicationActionProviderActivationBroker({
      ...safe,
      invoke() {},
    }),
    /must not expose invoke/,
  );
});
