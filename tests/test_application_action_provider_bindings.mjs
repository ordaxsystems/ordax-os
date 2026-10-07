import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ACTION_CAPABILITY_SCHEMA,
} from "../system/contracts/application-action-capability.mjs";
import {
  APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
  assertApplicationActionProviderResolver,
  validateApplicationActionProviderBinding,
} from "../system/contracts/application-action-provider-binding.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "../system/services/intelligence/application-action-capabilities.mjs";
import {
  createApplicationActionPreparationRegistry,
} from "../system/services/personal-ordax/application-action-preparations.mjs";
import {
  createApplicationActionProviderResolver,
} from "../system/services/personal-ordax/application-action-provider-bindings.mjs";

const OWNER = "ordaxsystems/ordax-apps";

function awareness() {
  const descriptor = Object.freeze({
    schema: "ordax.application-intelligence-awareness/1",
    appId: "notes",
    title: "Notas",
    sourceClass: "first-party",
    platform: "ordax",
    publisher: "OrdaX",
    payloadSha256: null,
    compatibilityManaged: false,
    nativeTrust: true,
    knownActionIds: ["notes.create-note"],
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
    provenance: "test:first-party",
  });
  return Object.freeze({
    schema: "ordax.application-intelligence-awareness-port/1",
    list() { return Object.freeze([descriptor]); },
    get(appId) { return appId === "notes" ? descriptor : null; },
    resolveExact(appId) { return appId === "notes" ? descriptor : null; },
    contextItem() {
      return Object.freeze({
        id: "ordax-application-catalog",
        scope: "system",
        text: "{}",
        provenance: "test",
      });
    },
  });
}

function capability(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId: "notes",
    actionId: "notes.create-note",
    title: "Criar nota",
    description: "Criar uma nova nota.",
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
    provenance: "ordax-apps:notes",
    ...overrides,
  };
}

function capabilityRegistry(capabilities = [capability()]) {
  return createApplicationActionCapabilityRegistry({
    awareness: awareness(),
    capabilities,
  });
}

function component(overrides = {}) {
  return {
    id: "notes",
    title: "Notas",
    kind: "app",
    version: "0.4.2",
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner: OWNER,
    dependencies: [],
    ...overrides,
  };
}

function semantics(capabilityValue = capability(), overrides = {}) {
  const appComponent = component(overrides.component ?? {});
  return {
    application: {
      id: appComponent.id,
      title: appComponent.title,
      component: appComponent,
    },
    actionManifest: {
      schema: "ordax.application-action-manifest/1",
      appId: appComponent.id,
      appVersion: appComponent.version,
      authority: "none",
      execution: "proposal-only",
      capabilities: [capabilityValue],
    },
    sourceCommit: overrides.sourceCommit ?? "a".repeat(40),
    revision: overrides.revision ?? 12,
  };
}

function prepared(registry = capabilityRegistry()) {
  const proposal = registry.propose(
    "notes",
    "notes.create-note",
    { title: "Ideias" },
  );
  const preparations = createApplicationActionPreparationRegistry({
    capabilityRegistry: registry,
    createPreparationId: () => "prep-provider-1",
  });
  const preparation = preparations.prepare("work-1", proposal);
  return { preparation, preparations };
}

function providerResolver({
  registry,
  preparations,
  resolveVerifiedSemantics = async (appId) => appId === "notes" ? semantics() : null,
  expectedOwner = OWNER,
} = {}) {
  return createApplicationActionProviderResolver({
    preparationRegistry: preparations,
    capabilityRegistry: registry,
    resolveVerifiedSemantics,
    expectedOwner,
  });
}

test("provider resolver binds retained preparation to exact current verified component slot", async () => {
  const registry = capabilityRegistry();
  const { preparation, preparations } = prepared(registry);
  const resolver = providerResolver({ registry, preparations });

  const binding = await resolver.resolve(preparation.resourceRef);

  assert.equal(binding.schema, APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA);
  assert.equal(binding.resourceRef, preparation.resourceRef);
  assert.equal(binding.workItemId, "work-1");
  assert.equal(binding.appId, "notes");
  assert.equal(binding.actionId, "notes.create-note");
  assert.equal(binding.appVersion, "0.4.2");
  assert.equal(binding.sourceCommit, "a".repeat(40));
  assert.equal(binding.componentRevision, 12);
  assert.deepEqual(binding.provider, {
    kind: "first-party-native",
    adapterId: "notes-native",
    revision: "1",
  });
  assert.equal(binding.capabilitySha256, preparation.proposal.capabilitySha256);
  assert.equal(binding.capabilityProvenance, preparation.proposal.capabilityProvenance);
  assert.equal(binding.authority, "none");
  assert.equal(binding.executionAuthorized, false);
  assert.equal(binding.modelDirectExecutionAuthorized, false);
  assert.equal(resolver.schema, APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA);
  for (const method of ["execute", "invoke", "run", "grant", "authorize", "confirm"]) {
    assert.equal(typeof resolver[method], "undefined");
  }
});

test("provider resolver only accepts an opaque reference retained by the preparation registry", async () => {
  const registry = capabilityRegistry();
  const { preparation, preparations } = prepared(registry);
  const resolver = providerResolver({ registry, preparations });

  assert.equal(await resolver.resolve("application-action:unknown"), null);
  assert.equal(await resolver.resolve(preparation), null);

  preparations.revoke(preparation.resourceRef);
  assert.equal(await resolver.resolve(preparation.resourceRef), null);
});

test("provider resolver requires canonical first-party owner injection", () => {
  const registry = capabilityRegistry();
  const { preparations } = prepared(registry);

  assert.throws(
    () => createApplicationActionProviderResolver({
      preparationRegistry: preparations,
      capabilityRegistry: registry,
      resolveVerifiedSemantics: async () => semantics(),
    }),
    /expected owner is invalid/,
  );
  assert.throws(
    () => providerResolver({ registry, preparations, expectedOwner: "" }),
    /expected owner is invalid/,
  );
});

test("provider resolver rejects stale capability after registry changes", async () => {
  const oldRegistry = capabilityRegistry();
  const { preparation, preparations } = prepared(oldRegistry);
  const currentCapability = capability({
    provenance: "ordax-apps:notes:revision-2",
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
    },
  });
  const currentRegistry = capabilityRegistry([currentCapability]);
  const resolver = providerResolver({
    registry: currentRegistry,
    preparations,
    resolveVerifiedSemantics: async () => semantics(currentCapability),
  });

  await assert.rejects(
    () => resolver.resolve(preparation.resourceRef),
    /proposal is stale|provider revision is stale/,
  );
});

test("provider resolver rejects package capability drift even when registry is unchanged", async () => {
  const registry = capabilityRegistry();
  const { preparation, preparations } = prepared(registry);
  const drifted = capability({
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
    },
    provenance: "ordax-apps:notes:package-drift",
  });
  const resolver = providerResolver({
    registry,
    preparations,
    resolveVerifiedSemantics: async () => semantics(drifted),
  });

  await assert.rejects(
    () => resolver.resolve(preparation.resourceRef),
    /Verified package capability no longer matches|provider no longer matches/,
  );
});

test("provider resolver rejects wrong owner, title drift and invalid slot identity", async () => {
  const registry = capabilityRegistry();
  const { preparation, preparations } = prepared(registry);

  const wrongOwnerResolver = providerResolver({
    registry,
    preparations,
    resolveVerifiedSemantics: async () => semantics(capability(), {
      component: { owner: "someone/other-apps" },
    }),
  });
  await assert.rejects(
    () => wrongOwnerResolver.resolve(preparation.resourceRef),
    /application identity drifted/,
  );

  const titleDriftResolver = providerResolver({
    registry,
    preparations,
    resolveVerifiedSemantics: async () => {
      const value = semantics();
      return {
        ...value,
        application: {
          ...value.application,
          title: "Título forjado",
        },
      };
    },
  });
  await assert.rejects(
    () => titleDriftResolver.resolve(preparation.resourceRef),
    /application identity drifted/,
  );

  const invalidSourceResolver = providerResolver({
    registry,
    preparations,
    resolveVerifiedSemantics: async () => semantics(capability(), {
      sourceCommit: "not-a-commit",
    }),
  });
  await assert.rejects(
    () => invalidSourceResolver.resolve(preparation.resourceRef),
    /sourceCommit/,
  );
});

test("provider binding and resolver contracts reject authority escalation", () => {
  const binding = {
    schema: APPLICATION_ACTION_PROVIDER_BINDING_SCHEMA,
    resourceRef: "application-action:prep-provider-1",
    workItemId: "work-1",
    appId: "notes",
    actionId: "notes.create-note",
    appVersion: "0.4.2",
    sourceCommit: "a".repeat(40),
    componentRevision: 12,
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
    },
    capabilitySha256: "b".repeat(64),
    capabilityProvenance: "ordax-apps:notes",
    authority: "none",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  };
  assert.equal(validateApplicationActionProviderBinding(binding).authority, "none");
  assert.throws(
    () => validateApplicationActionProviderBinding({
      ...binding,
      authority: "execute",
    }),
    /authority must remain none/,
  );
  for (const method of ["execute", "import", "load", "loadAdapter"]) {
    assert.throws(
      () => assertApplicationActionProviderResolver({
        schema: APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
        resolve() {},
        [method]() {},
      }),
      new RegExp(`must not expose ${method}`),
    );
  }
});
