import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProfilePackRestore } from "../system/services/profile-packs/restore.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const developer = JSON.parse(
  await readFile(resolve(ROOT, "system/profile-packs/developer/v1/manifest.json"), "utf8"),
);
const legalBr = JSON.parse(
  await readFile(resolve(ROOT, "system/profile-packs/legal-br/v1/manifest.json"), "utf8"),
);

function activationState(rows) {
  const snapshot = {
    schema: "ordax.profile-activation-state/1",
    revision: 3,
    persistence: "device",
    spaces: rows,
  };
  return {
    schema: "ordax.profile-activation-state-port/1",
    getSnapshot() { return snapshot; },
    async refresh() { return snapshot; },
    dispose() {},
  };
}

function current(slug, components = [], activatedAt = 1000) {
  return {
    profile: { slug, version: 1 },
    components,
    activatedAt,
  };
}

function provisioning(plans) {
  return {
    schema: "ordax.profile-provisioning/1",
    list() { return Object.freeze([...plans.values()]); },
    get(slug, version) { return plans.get(`${slug}@${version}`) ?? null; },
    refresh() { return this.list(); },
    dispose() {},
  };
}

function plan({
  slug = "developer",
  components = [],
  inventoryPersistence = "device",
  satisfied = true,
} = {}) {
  return {
    schema: "ordax.profile-provisioning/1",
    profile: { slug, version: 1 },
    state: "already-provisioned",
    reason: null,
    metadataBundled: true,
    deliveryMode: "bundled",
    offlineAfterInstall: true,
    inventoryPersistence,
    missing: [],
    alreadyInstalled: components,
    componentsSatisfied: satisfied,
    requiredMissing: satisfied ? [] : [{ id: "required.missing" }],
    requiredDownloadBytes: 0,
    mayDownload: false,
    mayActivate: satisfied,
  };
}

function component(receipt = "b") {
  return {
    id: "knowledge.example",
    kind: "knowledge-pack",
    version: "1.2.3",
    sha256: "a".repeat(64),
    receiptSha256: receipt.repeat(64),
    installedAt: 1000,
  };
}

test("restore resolves exact persisted Developer metadata without applying capabilities", () => {
  const restore = resolveProfilePackRestore({
    packs: [developer, legalBr],
    provisioning: provisioning(new Map([["developer@1", plan()]])),
    activationState: activationState([{
      spaceId: "space-dev",
      spaceKind: "professional",
      current: current("developer"),
      previous: null,
    }]),
  });
  assert.equal(restore.schema, "ordax.profile-pack-restore/1");
  assert.equal(restore.application, "metadata-only");
  assert.equal(restore.bootCritical, false);
  assert.deepEqual(restore.entries[0], {
    schema: "ordax.profile-pack-restore-entry/1",
    spaceId: "space-dev",
    spaceKind: "professional",
    state: "resolved",
    reason: null,
    profile: { slug: "developer", version: 1 },
    activatedAt: 1000,
  });
});

test("restore keeps manifest-blocked Legal-BR disabled-safe", () => {
  const restore = resolveProfilePackRestore({
    packs: [developer, legalBr],
    provisioning: provisioning(new Map([["legal-br@1", plan({ slug: "legal-br" })]])),
    activationState: activationState([{
      spaceId: "space-legal",
      spaceKind: "professional",
      current: current("legal-br"),
      previous: null,
    }]),
  });
  assert.equal(restore.entries[0].state, "disabled-safe");
  assert.equal(restore.entries[0].reason, "manifest-blocks-activation");
});

test("restore fails safe on receipt drift or missing device inventory", () => {
  const installed = component("b");
  const persisted = component("c");

  let restore = resolveProfilePackRestore({
    packs: [developer],
    provisioning: provisioning(new Map([[
      "developer@1",
      plan({ components: [installed] }),
    ]])),
    activationState: activationState([{
      spaceId: "space-dev",
      spaceKind: "professional",
      current: current("developer", [persisted]),
      previous: null,
    }]),
  });
  assert.equal(restore.entries[0].reason, "component-receipt-drift");

  restore = resolveProfilePackRestore({
    packs: [developer],
    provisioning: provisioning(new Map([[
      "developer@1",
      plan({ components: [installed], inventoryPersistence: "session" }),
    ]])),
    activationState: activationState([{
      spaceId: "space-dev",
      spaceKind: "professional",
      current: current("developer", [installed]),
      previous: null,
    }]),
  });
  assert.equal(restore.entries[0].reason, "device-inventory-unavailable");
});

test("restore refuses retired Profile and Space kind drift", () => {
  const retired = structuredClone(developer);
  retired.state = "retired";

  let restore = resolveProfilePackRestore({
    packs: [retired],
    provisioning: provisioning(new Map([["developer@1", plan()]])),
    activationState: activationState([{
      spaceId: "space-dev",
      spaceKind: "professional",
      current: current("developer"),
      previous: null,
    }]),
  });
  assert.equal(restore.entries[0].reason, "profile-retired");

  restore = resolveProfilePackRestore({
    packs: [developer],
    provisioning: provisioning(new Map([["developer@1", plan()]])),
    activationState: activationState([{
      spaceId: "space-dev",
      spaceKind: "work",
      current: current("developer"),
      previous: null,
    }]),
  });
  assert.equal(restore.entries[0].reason, "space-kind-mismatch");
});

test("inactive persisted row stays inactive and grants no Profile authority", () => {
  const restore = resolveProfilePackRestore({
    packs: [developer],
    provisioning: provisioning(new Map([["developer@1", plan()]])),
    activationState: activationState([{
      spaceId: "space-dev",
      spaceKind: "professional",
      current: null,
      previous: current("developer"),
    }]),
  });
  assert.equal(restore.entries[0].state, "inactive");
  assert.equal(restore.entries[0].profile, null);
  assert.equal(restore.entries[0].activatedAt, null);
});
