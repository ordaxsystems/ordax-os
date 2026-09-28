import assert from "node:assert/strict";
import test from "node:test";

import { createProfilePackRuntime } from "../system/services/profile-packs/runtime.mjs";
import { restoreProfilePackState } from "../system/services/profile-packs/restore.mjs";
import {
  LOCAL_PROFILE_PACK_MANIFESTS,
} from "../system/profile-packs/manifests.mjs";

function component(overrides = {}) {
  return Object.freeze({
    id: "knowledge.example",
    kind: "knowledge-pack",
    version: "1.2.3",
    required: true,
    availability: "available",
    sha256: "a".repeat(64),
    sizeBytes: 4096,
    signatureRequired: true,
    installedAt: 1000,
    receiptSha256: "b".repeat(64),
    ...overrides,
  });
}

function plan({
  slug = "developer",
  version = 1,
  installed = [],
  satisfied = true,
  requiredMissing = [],
} = {}) {
  return Object.freeze({
    schema: "ordax.profile-provisioning/1",
    profile: Object.freeze({ slug, version }),
    state: satisfied ? "already-provisioned" : "blocked",
    reason: satisfied ? null : "required-profile-components-not-published",
    metadataBundled: true,
    deliveryMode: "bundled",
    offlineAfterInstall: true,
    inventoryPersistence: "device",
    missing: Object.freeze([]),
    alreadyInstalled: Object.freeze(installed),
    componentsSatisfied: satisfied,
    requiredMissing: Object.freeze(requiredMissing),
    requiredDownloadBytes: 0,
    mayDownload: false,
    mayActivate: satisfied,
  });
}

function provisioning(plans) {
  const map = new Map(plans.map((entry) => [
    `${entry.profile.slug}@${entry.profile.version}`,
    entry,
  ]));
  return {
    schema: "ordax.profile-provisioning/1",
    list() {
      return Object.freeze([...map.values()]);
    },
    get(slug, version) {
      return map.get(`${slug}@${version}`) ?? null;
    },
    refresh() {
      return this.list();
    },
    dispose() {},
  };
}

function activationState(spaces) {
  const snapshot = Object.freeze({
    schema: "ordax.profile-activation-state/1",
    revision: 7,
    persistence: "device",
    spaces: Object.freeze(spaces),
  });
  return {
    schema: "ordax.profile-activation-state-port/1",
    getSnapshot() {
      return snapshot;
    },
    async refresh() {
      return snapshot;
    },
    dispose() {},
  };
}

function activation({
  slug = "developer",
  version = 1,
  components = [],
  activatedAt = 1200,
} = {}) {
  return Object.freeze({
    profile: Object.freeze({ slug, version }),
    components: Object.freeze(components.map((entry) => Object.freeze({
      id: entry.id,
      kind: entry.kind,
      version: entry.version,
      sha256: entry.sha256,
      receiptSha256: entry.receiptSha256,
      installedAt: entry.installedAt,
    }))),
    activatedAt,
  });
}

test("safe persisted Developer Profile restores from canonical manifest", () => {
  const state = activationState([Object.freeze({
    spaceId: "space-dev",
    spaceKind: "professional",
    current: activation(),
    previous: null,
  })]);
  const provisioningPort = provisioning([plan()]);

  const restored = restoreProfilePackState({
    packs: LOCAL_PROFILE_PACK_MANIFESTS,
    provisioning: provisioningPort,
    activationState: state,
  });

  assert.equal(restored.schema, "ordax.profile-pack-restore/1");
  assert.equal(restored.bootCritical, false);
  assert.equal(restored.persistence, "device");
  assert.equal(restored.entries[0].state, "restored");
  assert.equal(restored.entries[0].activation.persistence, "device-restored");
  assert.equal(restored.entries[0].activation.authority, "native-state-verified");
  assert.equal(restored.entries[0].activation.cloudMutationApplied, false);

  const runtime = createProfilePackRuntime({
    packs: LOCAL_PROFILE_PACK_MANIFESTS,
    provisioning: provisioningPort,
    activationState: state,
  });
  const snapshot = runtime.getSnapshot();
  assert.equal(snapshot.activations.length, 1);
  assert.equal(snapshot.activations[0].profile.slug, "developer");
  assert.equal(snapshot.restoration.entries[0].state, "restored");
  runtime.dispose();
});

test("restore disables safely when Space kind, manifest policy or receipts drift", () => {
  const installed = component();
  const provisioningPort = provisioning([
    plan({ installed: [installed] }),
    plan({ slug: "legal-br", installed: [], satisfied: true }),
  ]);

  const cases = [
    {
      row: {
        spaceId: "wrong-kind",
        spaceKind: "personal",
        current: activation(),
        previous: null,
      },
      reason: "space-kind-mismatch",
    },
    {
      row: {
        spaceId: "blocked-manifest",
        spaceKind: "professional",
        current: activation({ slug: "legal-br" }),
        previous: null,
      },
      reason: "profile-manifest-blocks-activation",
    },
    {
      row: {
        spaceId: "receipt-drift",
        spaceKind: "professional",
        current: activation({
          components: [component({ receiptSha256: "c".repeat(64) })],
        }),
        previous: null,
      },
      reason: "component-receipts-drifted",
    },
    {
      row: {
        spaceId: "missing-manifest",
        spaceKind: "professional",
        current: activation({ slug: "future-profile" }),
        previous: null,
      },
      reason: "profile-manifest-not-found",
    },
  ];

  for (const { row, reason } of cases) {
    const restored = restoreProfilePackState({
      packs: LOCAL_PROFILE_PACK_MANIFESTS,
      provisioning: provisioningPort,
      activationState: activationState([Object.freeze(row)]),
    });
    assert.equal(restored.entries[0].state, "disabled-safe");
    assert.equal(restored.entries[0].reason, reason);
    assert.equal(restored.entries[0].activation, null);
  }
});

test("restore disables safely when required components disappear", () => {
  const restored = restoreProfilePackState({
    packs: LOCAL_PROFILE_PACK_MANIFESTS,
    provisioning: provisioning([
      plan({
        satisfied: false,
        requiredMissing: [{ id: "knowledge.required" }],
      }),
    ]),
    activationState: activationState([Object.freeze({
      spaceId: "space-dev",
      spaceKind: "professional",
      current: activation(),
      previous: null,
    })]),
  });
  assert.equal(restored.entries[0].state, "disabled-safe");
  assert.equal(restored.entries[0].reason, "required-components-not-installed");
});

test("persisted deactivation stays inactive and does not implicitly rollback", () => {
  const restored = restoreProfilePackState({
    packs: LOCAL_PROFILE_PACK_MANIFESTS,
    provisioning: provisioning([plan()]),
    activationState: activationState([Object.freeze({
      spaceId: "space-dev",
      spaceKind: "professional",
      current: null,
      previous: activation(),
    })]),
  });
  assert.equal(restored.entries[0].state, "inactive");
  assert.equal(restored.entries[0].activation, null);

  const runtime = createProfilePackRuntime({
    packs: LOCAL_PROFILE_PACK_MANIFESTS,
    provisioning: provisioning([plan()]),
    activationState: activationState([Object.freeze({
      spaceId: "space-dev",
      spaceKind: "professional",
      current: null,
      previous: activation(),
    })]),
  });
  assert.equal(runtime.getSnapshot().activations.length, 0);
  assert.equal(runtime.getSnapshot().restoration.entries[0].state, "inactive");
  runtime.dispose();
});
