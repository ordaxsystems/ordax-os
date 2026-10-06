import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA as PROVIDER_BINDING_RESOLVER_SCHEMA,
  assertApplicationActionProviderResolver as assertProviderBindingResolver,
} from "../system/contracts/application-action-provider-binding.mjs";
import {
  APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
  assertApplicationActionProviderArtifactResolver,
} from "../system/contracts/application-action-provider-resolution.mjs";
import {
  createNativeVerifiedComponentPackageSource,
} from "../system/adapters/native/verified-component-package-source.mjs";
import {
  createApplicationActionProviderArtifactResolver,
} from "../system/services/personal-ordax/application-action-provider-artifact-resolver.mjs";

const SOURCE_COMMIT = "7".repeat(40);
const PROVIDER_SHA = "a".repeat(64);
const CAPABILITY_SHA = "c".repeat(64);
const OWNER = "washingtonmsdj/ordax-apps";
const RESOURCE_REF = "application-action:prep-1";

function component({ owner = OWNER } = {}) {
  return {
    schema: "ordax.component-manifest/1",
    id: "notes",
    title: "Notas",
    kind: "app",
    version: "0.4.2",
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner,
    dependencies: [],
  };
}

function actionManifest() {
  return {
    schema: "ordax.application-action-manifest/1",
    appId: "notes",
    appVersion: "0.4.2",
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
        revision: "1",
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
      provenance: "test:notes-actions",
    }],
  };
}

function providerManifest() {
  return {
    schema: "ordax.application-action-provider-manifest/1",
    appId: "notes",
    appVersion: "0.4.2",
    authority: "none",
    execution: "unavailable",
    providers: [{
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
      module: "actions/providers/notes-native.mjs",
      sha256: PROVIDER_SHA,
    }],
  };
}

function verifiedEntry({ provider = providerManifest(), owner = OWNER, revision = 12 } = {}) {
  const app = component({ owner });
  return {
    application: { id: app.id, title: app.title, component: app },
    intelligenceManifest: null,
    actionManifest: actionManifest(),
    providerManifest: provider,
    sourceCommit: SOURCE_COMMIT,
    revision,
  };
}

function providerBinding(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
    resourceRef: RESOURCE_REF,
    workItemId: "personal-work-1",
    appId: "notes",
    actionId: "notes.create-note",
    appVersion: "0.4.2",
    sourceCommit: SOURCE_COMMIT,
    componentRevision: 12,
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
    },
    capabilitySha256: CAPABILITY_SHA,
    capabilityProvenance: "test:notes-actions",
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    ...overrides,
  };
}

function bindingResolver({ first = providerBinding(), second = first } = {}) {
  let calls = 0;
  const port = {
    schema: PROVIDER_BINDING_RESOLVER_SCHEMA,
    async resolve(resourceRef) {
      calls += 1;
      if (resourceRef !== RESOURCE_REF) return null;
      return calls === 1 ? first : second;
    },
    get calls() {
      return calls;
    },
  };
  return port;
}

function metadata(overrides = {}) {
  return {
    componentId: "notes",
    state: "current",
    source: "slot",
    revision: 12,
    version: "0.4.2",
    sourceCommit: SOURCE_COMMIT,
    entrypoint: "system/apps/notes/src/runtime.mjs",
    pendingHealth: null,
    ...overrides,
  };
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

function packageSource() {
  return createNativeVerifiedComponentPackageSource({
    location: { href: "http://127.0.0.1:43121/" },
  });
}

function artifactResolver({
  bindings = bindingResolver(),
  entries = [verifiedEntry()],
  fetchImpl = async () => jsonResponse(metadata()),
  artifactIdentity = async () => PROVIDER_SHA,
  expectedOwner = OWNER,
} = {}) {
  return createApplicationActionProviderArtifactResolver({
    providerBindingResolver: bindings,
    verifiedEntries: entries,
    expectedOwner,
    source: packageSource(),
    fetchImpl,
    artifactIdentity,
  });
}

test("provider binding and provider artifact resolver schemas cannot be confused", () => {
  assert.notEqual(
    PROVIDER_BINDING_RESOLVER_SCHEMA,
    APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
  );

  const bindingPort = Object.freeze({
    schema: PROVIDER_BINDING_RESOLVER_SCHEMA,
    resolve() { return null; },
  });
  const artifactPort = Object.freeze({
    schema: APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA,
    resolve() { return null; },
  });

  assert.equal(assertProviderBindingResolver(bindingPort), bindingPort);
  assert.equal(assertApplicationActionProviderArtifactResolver(artifactPort), artifactPort);
  assert.throws(
    () => assertProviderBindingResolver(artifactPort),
    /Compatible Application action provider resolver is required/,
  );
  assert.throws(
    () => assertApplicationActionProviderArtifactResolver(bindingPort),
    /provider artifact resolver is required/,
  );
  assert.throws(
    () => assertProviderBindingResolver({
      ...bindingPort,
      load() {},
    }),
    /must not expose load/,
  );
  assert.throws(
    () => assertApplicationActionProviderArtifactResolver({
      ...artifactPort,
      load() {},
    }),
    /must not expose load/,
  );
});

test("artifact resolver extends the exact provider binding without creating authority", async () => {
  const artifactUrls = [];
  const bindings = bindingResolver();
  const resolver = artifactResolver({
    bindings,
    async fetchImpl(url, options) {
      assert.equal(new URL(url).pathname, "/__ordax/native/component-runtime");
      assert.equal(options.method, "GET");
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "same-origin");
      assert.equal(options.redirect, "error");
      return jsonResponse(metadata());
    },
    async artifactIdentity(url) {
      artifactUrls.push(url);
      return PROVIDER_SHA;
    },
  });

  const resolved = await resolver.resolve(RESOURCE_REF);

  assert.equal(resolver.schema, APPLICATION_ACTION_PROVIDER_ARTIFACT_RESOLVER_SCHEMA);
  assert.equal(bindings.calls, 2);
  assert.equal(resolved.resourceRef, RESOURCE_REF);
  assert.equal(resolved.workItemId, "personal-work-1");
  assert.equal(resolved.appId, "notes");
  assert.equal(resolved.actionId, "notes.create-note");
  assert.equal(resolved.appVersion, "0.4.2");
  assert.equal(resolved.sourceCommit, SOURCE_COMMIT);
  assert.equal(resolved.componentRevision, 12);
  assert.equal(resolved.provider.adapterId, "notes-native");
  assert.equal(resolved.provider.revision, "1");
  assert.equal(resolved.provider.module, "actions/providers/notes-native.mjs");
  assert.equal(resolved.provider.artifactSha256, PROVIDER_SHA);
  assert.equal(resolved.capabilitySha256, CAPABILITY_SHA);
  assert.equal(resolved.capabilityProvenance, "test:notes-actions");
  assert.equal(resolved.authority, "none");
  assert.equal(resolved.executionAuthorized, false);
  assert.equal(resolved.modelDirectExecutionAuthorized, false);
  assert.equal(artifactUrls.length, 1);
  assert.equal(
    new URL(artifactUrls[0]).pathname,
    "/__ordax/native/component-module/notes/current/0.4.2/"
      + SOURCE_COMMIT
      + "/system/apps/notes/actions/providers/notes-native.mjs",
  );
  for (const method of [
    "execute", "invoke", "run", "launch", "import", "load", "loadAdapter",
    "grant", "authorize", "confirm",
  ]) {
    assert.equal(resolver[method], undefined);
  }
});

test("artifact resolver returns null for a resource without a current provider binding and performs no I/O", async () => {
  let metadataReads = 0;
  let artifactReads = 0;
  const bindings = bindingResolver({ first: null, second: null });
  const resolver = artifactResolver({
    bindings,
    async fetchImpl() {
      metadataReads += 1;
      return jsonResponse(metadata());
    },
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  assert.equal(await resolver.resolve(RESOURCE_REF), null);
  assert.equal(bindings.calls, 1);
  assert.equal(metadataReads, 0);
  assert.equal(artifactReads, 0);
});

test("artifact resolver rejects verified semantics drift from provider binding before I/O", async () => {
  let metadataReads = 0;
  let artifactReads = 0;
  const resolver = artifactResolver({
    entries: [verifiedEntry({ revision: 13 })],
    async fetchImpl() {
      metadataReads += 1;
      return jsonResponse(metadata());
    },
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolve(RESOURCE_REF),
    /verified semantics drifted from binding/,
  );
  assert.equal(metadataReads, 0);
  assert.equal(artifactReads, 0);
});

test("artifact resolver rejects slot identity drift before reading artifact bytes", async () => {
  let artifactReads = 0;
  const resolver = artifactResolver({
    async fetchImpl() {
      return jsonResponse(metadata({ revision: 13 }));
    },
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolve(RESOURCE_REF),
    /verified slot changed after binding/,
  );
  assert.equal(artifactReads, 0);
});

test("artifact resolver rejects provider artifact hash drift", async () => {
  const resolver = artifactResolver({
    artifactIdentity: async () => "b".repeat(64),
  });

  await assert.rejects(
    () => resolver.resolve(RESOURCE_REF),
    /artifact identity mismatch/,
  );
});

test("legacy verified Actions without provider artifact remain non-resolvable", async () => {
  let metadataReads = 0;
  let artifactReads = 0;
  const resolver = artifactResolver({
    entries: [verifiedEntry({ provider: null })],
    async fetchImpl() {
      metadataReads += 1;
      return jsonResponse(metadata());
    },
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolve(RESOURCE_REF),
    /provider artifact is unavailable/,
  );
  assert.equal(metadataReads, 0);
  assert.equal(artifactReads, 0);
});

test("artifact resolver rejects a binding whose provider revision is no longer declared", async () => {
  let metadataReads = 0;
  let artifactReads = 0;
  const bindings = bindingResolver({
    first: providerBinding({
      provider: {
        kind: "first-party-native",
        adapterId: "notes-native",
        revision: "2",
      },
    }),
  });
  const resolver = artifactResolver({
    bindings,
    async fetchImpl() {
      metadataReads += 1;
      return jsonResponse(metadata());
    },
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolve(RESOURCE_REF),
    /artifact no longer matches binding/,
  );
  assert.equal(metadataReads, 0);
  assert.equal(artifactReads, 0);
});

test("artifact resolver requires the existing provider binding resolver", () => {
  assert.throws(
    () => createApplicationActionProviderArtifactResolver({
      verifiedEntries: [verifiedEntry()],
      expectedOwner: OWNER,
      source: packageSource(),
      fetchImpl: async () => jsonResponse(metadata()),
      artifactIdentity: async () => PROVIDER_SHA,
    }),
    /Compatible Application action provider resolver is required/,
  );
});

test("artifact resolver requires an injected canonical owner", () => {
  assert.throws(
    () => createApplicationActionProviderArtifactResolver({
      providerBindingResolver: bindingResolver(),
      verifiedEntries: [verifiedEntry()],
      source: packageSource(),
      fetchImpl: async () => jsonResponse(metadata()),
      artifactIdentity: async () => PROVIDER_SHA,
    }),
    /expected owner is invalid/,
  );
});

test("artifact resolver rejects owner drift before provider binding can lead to package I/O", () => {
  let metadataReads = 0;
  let artifactReads = 0;
  assert.throws(
    () => artifactResolver({
      entries: [verifiedEntry({ owner: "foreign/apps" })],
      async fetchImpl() {
        metadataReads += 1;
        return jsonResponse(metadata());
      },
      async artifactIdentity() {
        artifactReads += 1;
        return PROVIDER_SHA;
      },
    }),
    /app identity is not verified first-party/,
  );
  assert.equal(metadataReads, 0);
  assert.equal(artifactReads, 0);
});

test("artifact resolver fails closed if the provider binding changes during artifact I/O", async () => {
  const first = providerBinding();
  const second = providerBinding({ capabilitySha256: "d".repeat(64) });
  const bindings = bindingResolver({ first, second });
  let artifactReads = 0;
  const resolver = artifactResolver({
    bindings,
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolve(RESOURCE_REF),
    /binding changed during artifact resolution/,
  );
  assert.equal(bindings.calls, 2);
  assert.equal(artifactReads, 1);
});
