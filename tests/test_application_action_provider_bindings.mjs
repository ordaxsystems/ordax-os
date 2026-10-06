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

const OWNER = "washingtonmsdj/ordax-apps";

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
  return preparations.prepare("work-1", proposal);
}

test("provider resolver binds preparation to exact current verified component slot", async () => {
  const registry = capabilityRegistry();
  const preparation = prepared(registry);
  const resolver = createApplicationActionProviderResolver({
    capabilityRegistry: registry,
    resolveVerifiedSemantics: async (appId) => appId === "notes" ? semantics() : null,
    expectedOwner: OWNER,
  });

  const binding = await resolver.resolve(preparation);

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

test("provider resolver rejects stale capability after registry changes", async () => {
  const oldRegistry = capabilityRegistry();
  const preparation = prepared(oldRegistry);
  const currentCapability = capability({
    provenance: "ordax-apps:notes:revision-2",
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
    },
  });
  const currentRegistry = capabilityRegistry([currentCapability]);
  const resolver = createApplicationActionProviderResolver({
    capabilityRegistry: currentRegistry,
    resolveVerifiedSemantics: async () => semantics(currentCapability),
    expectedOwner: OWNER,
  });

  await assert.rejects(
    () => resolver.resolve(preparation),
    /proposal is stale|provider revision is stale/,
  );
});

test("provider resolver rejects package capability drift even when registry is unchanged", async () => {
  const registry = capabilityRegistry();
  const preparation = prepared(registry);
  const drifted = capability({
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "2",
    },
    provenance: "ordax-apps:notes:package-drift",
  });
  const resolver = createApplicationActionProviderResolver({
    capabilityRegistry: registry,
    resolveVerifiedSemantics: async () => semantics(drifted),
    expectedOwner: OWNER,
  });

  await assert.rejects(
    () => resolver.resolve(preparation),
    /Verified package capability no longer matches|provider no longer matches/,
  );
});

test("provider resolver rejects wrong owner and non-current package identity", async () => {
  const registry = capabilityRegistry();
  const preparation = prepared(registry);
  const wrongOwnerResolver = createApplicationActionProviderResolver({
    capabilityRegistry: registry,
    resolveVerifiedSemantics: async () => semantics(capability(), {
      component: { owner: "someone/other-apps" },
    }),
    expectedOwner: OWNER,
  });
  await assert.rejects(
    () => wrongOwnerResolver.resolve(preparation),
    /application identity drifted/,
  );

  const invalidSourceResolver = createApplicationActionProviderResolver({
    capabilityRegistry: registry,
    resolveVerifiedSemantics: async () => semantics(capability(), {
      sourceCommit: "not-a-commit",
    }),
    expectedOwner: OWNER,
  });
  await assert.rejects(
    () => invalidSourceResolver.resolve(preparation),
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
  assert.throws(
    () => assertApplicationActionProviderResolver({
      schema: APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
      resolve() {},
      execute() {},
    }),
    /must not expose execute/,
  );
});
