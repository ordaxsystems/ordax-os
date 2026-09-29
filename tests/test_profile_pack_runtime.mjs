import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateProfilePack,
  validateProfilePackCatalog,
} from "../system/contracts/profile-pack.mjs";
import { createProfilePackRuntime } from "../system/services/profile-packs/runtime.mjs";
import { createProfileProvisioningRuntime } from "../system/services/profile-packs/provisioning.mjs";
import { createSessionProfileComponentInventory } from "../system/services/profile-packs/inventory.mjs";
import { createLocalProfileDistributions } from "../system/profile-packs/distributions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function manifest(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), "utf8"));
}

const developer = await manifest("system/profile-packs/developer/v1/manifest.json");
const legalBr = await manifest("system/profile-packs/legal-br/v1/manifest.json");
const localDistributions = createLocalProfileDistributions([
  validateProfilePack(developer),
  validateProfilePack(legalBr),
]);

function localProvisioning() {
  return createProfileProvisioningRuntime({
    distributions: localDistributions,
    inventory: createSessionProfileComponentInventory(),
    readNetworkAvailable: () => false,
  });
}

function provisioningStub(plan) {
  return {
    schema: "ordax.profile-provisioning/1",
    list() {
      return Object.freeze([plan]);
    },
    get(slug, version) {
      return plan.profile.slug === slug && plan.profile.version === version ? plan : null;
    },
    refresh() {
      return this.list();
    },
    dispose() {},
  };
}

test("Developer and Legal-BR manifests share the provider-neutral contract", () => {
  const developerPack = validateProfilePack(developer);
  const legalPack = validateProfilePack(legalBr);

  assert.equal(developerPack.slug, "developer");
  assert.equal(developerPack.state, "draft");
  assert.equal(developerPack.intelligence.preferredPurpose, "code");
  assert.equal(developerPack.security.autoGrantPrivileges, false);
  assert.equal(developerPack.security.allowUnsignedApps, false);
  assert.equal(developerPack.security.genericShellImplied, false);

  assert.equal(legalPack.slug, "legal-br");
  assert.equal(legalPack.knowledge.jurisdiction, "BR");
  assert.equal(legalPack.intelligence.preferredPurpose, null);
  assert.equal(legalPack.activation.publiclyAvailable, false);
  assert.equal(legalPack.security.crossSpaceMemory, false);
});

test("runtime catalog rejects duplicate version identity and privilege broadening", () => {
  assert.throws(
    () => validateProfilePackCatalog([developer, developer]),
    /duplicate developer@1/,
  );

  const privileged = structuredClone(developer);
  privileged.security.auto_grant_privileges = true;
  assert.throws(
    () => validateProfilePack(privileged),
    /cannot broaden privilege, signature, shell or memory isolation policy/,
  );
});

test("Developer stays blocked while its real required component is only planned", () => {
  const provisioning = localProvisioning();
  const plan = provisioning.get("developer", 1);
  assert.equal(plan.state, "blocked");
  assert.equal(
    plan.reason,
    "MVP Developer Profile remains an internal composition proof until persistent provisioning and public package trust are promoted.",
  );
  assert.equal(plan.componentsSatisfied, false);
  assert.equal(plan.missing.length, 1);
  assert.equal(plan.missing[0].id, "knowledge.developer-core");
  assert.equal(plan.missing[0].availability, "planned");
  assert.equal(plan.mayActivate, false);

  const runtime = createProfilePackRuntime({
    packs: [developer, legalBr],
    provisioning,
  });
  assert.throws(
    () => runtime.activate({
      slug: "developer",
      version: 1,
      mode: "internal-proof",
      space: { id: "space-dev-proof", kind: "professional" },
    }),
    /required components are not installed/,
  );
});

test("internal proof fails closed for incompatible spaces, Legal-BR and non-draft states", () => {
  const runtime = createProfilePackRuntime({ packs: [developer, legalBr], provisioning: localProvisioning() });

  assert.throws(
    () => runtime.activate({
      slug: "developer",
      version: 1,
      mode: "internal-proof",
      space: { id: "personal", kind: "personal" },
    }),
    /incompatible with the selected Space kind/,
  );

  assert.throws(
    () => runtime.activate({
      slug: "legal-br",
      version: 1,
      mode: "internal-proof",
      space: { id: "legal-space", kind: "professional" },
    }),
    /explicitly blocks activation/,
  );

  const activeDeveloper = structuredClone(developer);
  activeDeveloper.state = "active";
  const activeRuntime = createProfilePackRuntime({
    packs: [activeDeveloper],
    provisioning: localProvisioning(),
  });
  assert.throws(
    () => activeRuntime.activate({
      slug: "developer",
      version: 1,
      mode: "internal-proof",
      space: { id: "space-dev-proof", kind: "professional" },
    }),
    /only draft Profile Packs/,
  );
});


test("runtime refuses activation when required verified components are missing", () => {
  const plan = {
    schema: "ordax.profile-provisioning/1",
    profile: Object.freeze({ slug: "developer", version: 1 }),
    state: "blocked",
    reason: "required-profile-components-not-published",
    metadataBundled: true,
    deliveryMode: "on-demand",
    offlineAfterInstall: true,
    inventoryPersistence: "device",
    missing: Object.freeze([{
      id: "knowledge.required",
      kind: "knowledge-pack",
      version: "1.0.0",
      required: true,
      availability: "planned",
      sha256: null,
      sizeBytes: null,
      signatureRequired: true,
    }]),
    alreadyInstalled: Object.freeze([]),
    componentsSatisfied: false,
    requiredMissing: Object.freeze([{ id: "knowledge.required" }]),
    requiredDownloadBytes: 0,
    mayDownload: false,
    mayActivate: false,
  };
  const runtime = createProfilePackRuntime({
    packs: [developer],
    provisioning: provisioningStub(plan),
  });

  assert.throws(
    () => runtime.activate({
      slug: "developer",
      version: 1,
      mode: "internal-proof",
      space: { id: "space-missing", kind: "professional" },
    }),
    /required components are not installed/,
  );
});

test("activation snapshot binds exact installed receipt identities from provisioning", () => {
  const availableDeveloper = structuredClone(developer);
  availableDeveloper.components[0].availability = "available";
  availableDeveloper.components[0].sha256 = "a".repeat(64);
  const plan = {
    schema: "ordax.profile-provisioning/1",
    profile: Object.freeze({ slug: "developer", version: 1 }),
    state: "already-provisioned",
    reason: null,
    metadataBundled: true,
    deliveryMode: "on-demand",
    offlineAfterInstall: true,
    inventoryPersistence: "device",
    missing: Object.freeze([]),
    alreadyInstalled: Object.freeze([{
      id: "knowledge.developer-core",
      kind: "knowledge-pack",
      version: "0.1.0",
      required: true,
      availability: "available",
      sha256: "a".repeat(64),
      sizeBytes: 4096,
      signatureRequired: true,
      installedAt: 1234,
      receiptSha256: "b".repeat(64),
    }]),
    componentsSatisfied: true,
    requiredMissing: Object.freeze([]),
    requiredDownloadBytes: 0,
    mayDownload: false,
    mayActivate: true,
  };
  const runtime = createProfilePackRuntime({
    packs: [availableDeveloper],
    provisioning: provisioningStub(plan),
  });
  const activation = runtime.activate({
    slug: "developer",
    version: 1,
    mode: "internal-proof",
    space: { id: "space-receipt", kind: "professional" },
  });

  assert.deepEqual(activation.components, [{
    id: "knowledge.developer-core",
    kind: "knowledge-pack",
    version: "0.1.0",
    sha256: "a".repeat(64),
    receiptSha256: "b".repeat(64),
    installedAt: 1234,
  }]);
});
