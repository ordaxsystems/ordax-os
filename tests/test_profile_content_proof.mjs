import assert from "node:assert/strict";
import test from "node:test";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";

import {
  PROFILE_CONTENT_ENVELOPE_SCHEMA,
  PROFILE_CONTENT_SIGNATURE_ALGORITHM,
  PROFILE_CONTENT_TEST_TRUST_SCHEMA,
  canonicalProfileContentManifestBytes,
  validateProfileContentManifest,
  verifyProfileContentProof,
} from "../tools/profile-content-proof/verify.mjs";

const entryContent = "ordax legal knowledge proof fixture";
const contentBytes = Buffer.from(JSON.stringify({
  schema: "ordax.profile-content-pack/1",
  kind: "knowledge-pack",
  entries: [{
    id: "legal.proof",
    mediaType: "text/plain",
    content: entryContent,
    contentSha256: createHash("sha256").update(Buffer.from(entryContent, "utf8")).digest("hex"),
    source: {
      uri: "https://example.invalid/ordax/legal/source",
      revision: "fixture-1",
      license: "test-fixture-only",
      jurisdiction: "BR",
      title: "Fonte jurídica de teste",
    },
  }],
}), "utf8");
const baseManifest = {
  $schema: "prototype-ordax.profile-content-manifest/1",
  id: "knowledge.legal-br-proof",
  kind: "knowledge-pack",
  version: "0.1.0",
  publisher: "ordax",
  content_hash: createHash("sha256").update(contentBytes).digest("hex"),
  content_size: contentBytes.length,
  content_format: "ordax.profile-content-pack/1",
  source: {
    uri: "https://example.invalid/ordax/legal-proof",
    revision: "fixture-1",
    license: "test-fixture-only",
    jurisdiction: "BR",
  },
  requested_capabilities: [],
  runtime_network_allowed: false,
  mutable_host_access_allowed: false,
};

function signedProof(manifest = baseManifest) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "profile-proof-test";
  const signature = sign(null, canonicalProfileContentManifestBytes(manifest), privateKey);
  return {
    trust: {
      $schema: PROFILE_CONTENT_TEST_TRUST_SCHEMA,
      algorithm: PROFILE_CONTENT_SIGNATURE_ALGORITHM,
      key_id: keyId,
      public_key_pem: publicKey.export({ type: "spki", format: "pem" }),
    },
    envelope: {
      $schema: PROFILE_CONTENT_ENVELOPE_SCHEMA,
      algorithm: PROFILE_CONTENT_SIGNATURE_ALGORITHM,
      key_id: keyId,
      signature_base64: signature.toString("base64"),
    },
  };
}

test("signed Profile knowledge proof binds exact bytes and provenance", () => {
  const { trust, envelope } = signedProof();
  const verified = verifyProfileContentProof({
    manifest: baseManifest,
    envelope,
    trust,
    contentBytes,
  });
  assert.equal(verified.id, "knowledge.legal-br-proof");
  assert.equal(verified.kind, "knowledge-pack");
  assert.equal(verified.version, "0.1.0");
  assert.equal(verified.content_format, "ordax.profile-content-pack/1");
  assert.equal(verified.source.jurisdiction, "BR");
  assert.equal(verified.runtime_network_allowed, false);
});

test("tampered content and wrong Ed25519 key fail closed", () => {
  const { envelope } = signedProof();
  const { publicKey } = generateKeyPairSync("ed25519");
  const wrongTrust = {
    $schema: PROFILE_CONTENT_TEST_TRUST_SCHEMA,
    algorithm: PROFILE_CONTENT_SIGNATURE_ALGORITHM,
    key_id: envelope.key_id,
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }),
  };
  assert.throws(
    () => verifyProfileContentProof({
      manifest: baseManifest,
      envelope,
      trust: wrongTrust,
      contentBytes,
    }),
    /signature verification failed/,
  );

  const { trust } = signedProof();
  assert.throws(
    () => verifyProfileContentProof({
      manifest: baseManifest,
      envelope: signedProof().envelope,
      trust,
      contentBytes: Buffer.concat([contentBytes, Buffer.from("tamper")]),
    }),
    /size mismatch/,
  );
});

test("Profile content proof cannot request authority or runtime egress", () => {
  const privileged = structuredClone(baseManifest);
  privileged.requested_capabilities = ["filesystem.user-space"];
  assert.throws(
    () => validateProfileContentManifest(privileged),
    /must not request capabilities/,
  );

  const networked = structuredClone(baseManifest);
  networked.runtime_network_allowed = true;
  assert.throws(
    () => validateProfileContentManifest(networked),
    /cannot allow runtime network/,
  );

  const mutable = structuredClone(baseManifest);
  mutable.mutable_host_access_allowed = true;
  assert.throws(
    () => validateProfileContentManifest(mutable),
    /cannot allow mutable host access/,
  );
});

test("Profile content manifest rejects unknown fields, unsupported kind and format", () => {
  assert.throws(
    () => validateProfileContentManifest({ ...baseManifest, content_format: "unknown/9" }),
    /format is unsupported/,
  );
  assert.throws(
    () => validateProfileContentManifest({ ...baseManifest, surprise: true }),
    /fields are incompatible/,
  );
  assert.throws(
    () => validateProfileContentManifest({ ...baseManifest, kind: "app" }),
    /kind is unsupported/,
  );
});
