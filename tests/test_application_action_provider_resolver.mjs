import assert from "node:assert/strict";
import test from "node:test";

import {
  createNativeVerifiedComponentPackageSource,
} from "../system/adapters/native/verified-component-package-source.mjs";
import {
  createApplicationActionProviderResolver,
} from "../system/services/personal-ordax/application-action-provider-resolver.mjs";

const SOURCE_COMMIT = "7".repeat(40);
const PROVIDER_SHA = "a".repeat(64);
const OWNER = "washingtonmsdj/ordax-apps";

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

function verifiedEntry({ provider = providerManifest(), owner = OWNER } = {}) {
  const app = component({ owner });
  return {
    application: { id: app.id, title: app.title, component: app },
    intelligenceManifest: null,
    actionManifest: actionManifest(),
    providerManifest: provider,
    sourceCommit: SOURCE_COMMIT,
    revision: 12,
  };
}

function preparation() {
  return {
    schema: "ordax.application-action-preparation/1",
    preparationId: "prep-1",
    resourceRef: "application-action:prep-1",
    workItemId: "personal-work-1",
    proposal: {
      schema: "ordax.application-action-proposal/1",
      appId: "notes",
      actionId: "notes.create-note",
      arguments: { title: "Ideias" },
      riskClass: "local-change",
      confirmation: "policy-gated",
      capabilitySha256: "c".repeat(64),
      capabilityProvenance: "test:notes-actions",
      executionAuthorized: false,
      modelDirectExecutionAuthorized: false,
    },
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
    },
    effect: "write",
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  };
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

test("provider resolver binds preparation to exact current verified artifact without authority", async () => {
  const artifactUrls = [];
  const resolver = createApplicationActionProviderResolver({
    verifiedEntries: [verifiedEntry()],
    expectedOwner: OWNER,
    source: packageSource(),
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

  const prepared = preparation();
  const resolved = await resolver.resolve(prepared);

  assert.equal(resolved.preparationId, "prep-1");
  assert.equal(resolved.resourceRef, "application-action:prep-1");
  assert.equal(resolved.appId, "notes");
  assert.equal(resolved.appVersion, "0.4.2");
  assert.equal(resolved.sourceCommit, SOURCE_COMMIT);
  assert.equal(resolved.slotRevision, 12);
  assert.equal(resolved.provider.adapterId, "notes-native");
  assert.equal(resolved.provider.revision, "1");
  assert.equal(resolved.provider.module, "actions/providers/notes-native.mjs");
  assert.equal(resolved.provider.artifactSha256, PROVIDER_SHA);
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
    "execute", "invoke", "run", "launch", "import", "loadAdapter",
    "grant", "authorize", "confirm",
  ]) {
    assert.equal(resolver[method], undefined);
  }
});

test("provider resolver rejects slot identity drift before reading artifact bytes", async () => {
  let artifactReads = 0;
  const resolver = createApplicationActionProviderResolver({
    verifiedEntries: [verifiedEntry()],
    expectedOwner: OWNER,
    source: packageSource(),
    async fetchImpl() {
      return jsonResponse(metadata({ revision: 13 }));
    },
    async artifactIdentity() {
      artifactReads += 1;
      return PROVIDER_SHA;
    },
  });

  await assert.rejects(
    () => resolver.resolve(preparation()),
    /verified slot changed after semantics load/,
  );
  assert.equal(artifactReads, 0);
});

test("provider resolver rejects provider artifact hash drift", async () => {
  const resolver = createApplicationActionProviderResolver({
    verifiedEntries: [verifiedEntry()],
    expectedOwner: OWNER,
    source: packageSource(),
    async fetchImpl() {
      return jsonResponse(metadata());
    },
    async artifactIdentity() {
      return "b".repeat(64);
    },
  });

  await assert.rejects(
    () => resolver.resolve(preparation()),
    /artifact identity mismatch/,
  );
});

test("legacy verified Actions without provider artifact remain non-resolvable", async () => {
  const resolver = createApplicationActionProviderResolver({
    verifiedEntries: [verifiedEntry({ provider: null })],
    expectedOwner: OWNER,
    source: packageSource(),
    async fetchImpl() {
      throw new Error("metadata must not be read without a provider artifact");
    },
    async artifactIdentity() {
      throw new Error("artifact must not be read without a provider artifact");
    },
  });

  await assert.rejects(
    () => resolver.resolve(preparation()),
    /provider artifact is unavailable/,
  );
});

test("resolver rejects a preparation whose provider revision is no longer declared", async () => {
  const changed = preparation();
  changed.provider.revision = "2";
  const resolver = createApplicationActionProviderResolver({
    verifiedEntries: [verifiedEntry()],
    expectedOwner: OWNER,
    source: packageSource(),
    async fetchImpl() {
      throw new Error("metadata must not be read after provider mismatch");
    },
    async artifactIdentity() {
      throw new Error("artifact must not be read after provider mismatch");
    },
  });

  await assert.rejects(
    () => resolver.resolve(changed),
    /artifact no longer matches preparation/,
  );
});

test("provider resolver requires an injected canonical owner", () => {
  assert.throws(
    () => createApplicationActionProviderResolver({
      verifiedEntries: [verifiedEntry()],
      source: packageSource(),
      fetchImpl: async () => jsonResponse(metadata()),
      artifactIdentity: async () => PROVIDER_SHA,
    }),
    /expected owner is invalid/,
  );
});

test("provider resolver rejects owner drift before metadata or artifact reads", () => {
  let metadataReads = 0;
  let artifactReads = 0;
  assert.throws(
    () => createApplicationActionProviderResolver({
      verifiedEntries: [verifiedEntry({ owner: "foreign/apps" })],
      expectedOwner: OWNER,
      source: packageSource(),
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
