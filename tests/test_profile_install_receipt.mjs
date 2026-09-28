import assert from "node:assert/strict";
import test from "node:test";

import {
  inventoryEntryFromVerifiedReceipt,
  validateProfileInstallReceipt,
} from "../system/contracts/profile-install-receipt.mjs";

function receipt() {
  return {
    schema: "ordax.profile-install-receipt/1",
    artifact: {
      id: "knowledge.example",
      kind: "knowledge-pack",
      version: "1.2.3",
      sha256: "a".repeat(64),
      sizeBytes: 4096,
    },
    verification: {
      signatureAlgorithm: "ed25519",
      keyId: "ordax-profile-release-1",
      manifestSha256: "b".repeat(64),
      verifiedAt: 1000,
    },
    health: {
      state: "healthy",
      checkedAt: 1100,
    },
    installedAt: 1200,
  };
}

test("verified Profile install receipt binds version, bytes, signature and health", () => {
  const value = validateProfileInstallReceipt(receipt());
  assert.equal(value.artifact.id, "knowledge.example");
  assert.equal(value.artifact.version, "1.2.3");
  assert.equal(value.artifact.sha256, "a".repeat(64));
  assert.equal(value.verification.signatureAlgorithm, "ed25519");
  assert.equal(value.health.state, "healthy");
});

test("inventory entry is derived only from a valid healthy receipt", () => {
  const entry = inventoryEntryFromVerifiedReceipt(receipt(), "c".repeat(64));
  assert.deepEqual(entry, {
    id: "knowledge.example",
    kind: "knowledge-pack",
    version: "1.2.3",
    sha256: "a".repeat(64),
    installedAt: 1200,
    receiptSha256: "c".repeat(64),
  });
});

test("receipt fails closed on unhealthy activation, unknown fields or invalid signature metadata", () => {
  const unhealthy = receipt();
  unhealthy.health.state = "failed";
  assert.throws(() => validateProfileInstallReceipt(unhealthy), /healthy activation proof/);

  const unknown = receipt();
  unknown.surprise = true;
  assert.throws(() => validateProfileInstallReceipt(unknown), /fields are incompatible/);

  const wrongAlgorithm = receipt();
  wrongAlgorithm.verification.signatureAlgorithm = "rsa";
  assert.throws(() => validateProfileInstallReceipt(wrongAlgorithm), /unsupported/);

  const badManifest = receipt();
  badManifest.verification.manifestSha256 = "bad";
  assert.throws(() => validateProfileInstallReceipt(badManifest), /manifest sha256 is invalid/);
});
