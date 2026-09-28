import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";

export const PROFILE_CONTENT_MANIFEST_SCHEMA = "prototype-ordax.profile-content-manifest/1";
export const PROFILE_CONTENT_ENVELOPE_SCHEMA = "prototype-ordax.profile-content-envelope/1";
export const PROFILE_CONTENT_TEST_TRUST_SCHEMA = "prototype-ordax.profile-content-test-trust/1";
export const PROFILE_CONTENT_SIGNATURE_ALGORITHM = "ed25519";

const ID_PATTERN = /^[a-z][a-z0-9._-]{1,127}$/;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const KINDS = new Set(["knowledge-pack", "skill-pack"]);
const CONTENT_FORMAT = "ordax.profile-content-pack/1";
const MAX_CONTENT_BYTES = 256 * 1024 * 1024;

const MANIFEST_KEYS = Object.freeze([
  "$schema",
  "id",
  "kind",
  "version",
  "publisher",
  "content_hash",
  "content_size",
  "content_format",
  "source",
  "requested_capabilities",
  "runtime_network_allowed",
  "mutable_host_access_allowed",
]);
const SOURCE_KEYS = Object.freeze([
  "uri",
  "revision",
  "license",
  "jurisdiction",
]);
const ENVELOPE_KEYS = Object.freeze([
  "$schema",
  "algorithm",
  "key_id",
  "signature_base64",
]);
const TRUST_KEYS = Object.freeze([
  "$schema",
  "algorithm",
  "key_id",
  "public_key_pem",
]);

function objectValue(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} fields are incompatible`);
  }
}

function boundedText(value, label, max = 240) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value.includes("\0")
  ) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function nullableText(value, label, max = 120) {
  return value === null ? null : boundedText(value, label, max);
}

function strictBase64(value, label) {
  const text = boundedText(value, label, 256);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new TypeError(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) {
    throw new TypeError(`${label} must be canonical base64`);
  }
  return bytes;
}

export function validateProfileContentManifest(value) {
  const manifest = objectValue(value, "Profile content manifest");
  exactKeys(manifest, MANIFEST_KEYS, "Profile content manifest");
  if (manifest.$schema !== PROFILE_CONTENT_MANIFEST_SCHEMA) {
    throw new TypeError("Profile content manifest schema is incompatible");
  }

  const id = boundedText(manifest.id, "Profile content id", 128);
  if (!ID_PATTERN.test(id)) throw new TypeError("Profile content id is invalid");
  if (!KINDS.has(manifest.kind)) throw new TypeError("Profile content kind is unsupported");

  const version = boundedText(manifest.version, "Profile content version", 64);
  if (!VERSION_PATTERN.test(version)) throw new TypeError("Profile content version is invalid");

  const publisher = boundedText(manifest.publisher, "Profile content publisher", 120);
  const contentHash = boundedText(manifest.content_hash, "Profile content hash", 64);
  if (!SHA256_PATTERN.test(contentHash)) {
    throw new TypeError("Profile content hash must be lowercase SHA-256");
  }
  if (
    !Number.isSafeInteger(manifest.content_size)
    || manifest.content_size <= 0
    || manifest.content_size > MAX_CONTENT_BYTES
  ) {
    throw new TypeError("Profile content size is outside allowed bounds");
  }
  if (manifest.content_format !== CONTENT_FORMAT) {
    throw new TypeError("Profile content format is unsupported");
  }

  const source = objectValue(manifest.source, "Profile content source");
  exactKeys(source, SOURCE_KEYS, "Profile content source");
  const normalizedSource = Object.freeze({
    uri: boundedText(source.uri, "Profile content source uri", 512),
    revision: boundedText(source.revision, "Profile content source revision", 160),
    license: boundedText(source.license, "Profile content source license", 120),
    jurisdiction: nullableText(source.jurisdiction, "Profile content source jurisdiction", 80),
  });

  if (!Array.isArray(manifest.requested_capabilities) || manifest.requested_capabilities.length !== 0) {
    throw new TypeError("Profile content proof must not request capabilities");
  }
  if (manifest.runtime_network_allowed !== false) {
    throw new TypeError("Profile content proof cannot allow runtime network");
  }
  if (manifest.mutable_host_access_allowed !== false) {
    throw new TypeError("Profile content proof cannot allow mutable host access");
  }

  return Object.freeze({
    $schema: PROFILE_CONTENT_MANIFEST_SCHEMA,
    id,
    kind: manifest.kind,
    version,
    publisher,
    content_hash: contentHash,
    content_size: manifest.content_size,
    content_format: CONTENT_FORMAT,
    source: normalizedSource,
    requested_capabilities: Object.freeze([]),
    runtime_network_allowed: false,
    mutable_host_access_allowed: false,
  });
}

export function canonicalProfileContentManifestBytes(value) {
  return Buffer.from(JSON.stringify(validateProfileContentManifest(value)), "utf8");
}

function validateEnvelope(value) {
  const envelope = objectValue(value, "Profile content envelope");
  exactKeys(envelope, ENVELOPE_KEYS, "Profile content envelope");
  if (envelope.$schema !== PROFILE_CONTENT_ENVELOPE_SCHEMA) {
    throw new TypeError("Profile content envelope schema is incompatible");
  }
  if (envelope.algorithm !== PROFILE_CONTENT_SIGNATURE_ALGORITHM) {
    throw new TypeError("Profile content envelope algorithm is unsupported");
  }
  const keyId = boundedText(envelope.key_id, "Profile content envelope key id", 64);
  if (!KEY_ID_PATTERN.test(keyId)) throw new TypeError("Profile content envelope key id is invalid");
  const signature = strictBase64(envelope.signature_base64, "Profile content signature");
  if (signature.length !== 64) {
    throw new TypeError("Profile content Ed25519 signature must be 64 bytes");
  }
  return Object.freeze({ keyId, signature });
}

function validateTrust(value) {
  const trust = objectValue(value, "Profile content test trust");
  exactKeys(trust, TRUST_KEYS, "Profile content test trust");
  if (trust.$schema !== PROFILE_CONTENT_TEST_TRUST_SCHEMA) {
    throw new TypeError("Profile content test trust schema is incompatible");
  }
  if (trust.algorithm !== PROFILE_CONTENT_SIGNATURE_ALGORITHM) {
    throw new TypeError("Profile content test trust algorithm is unsupported");
  }
  const keyId = boundedText(trust.key_id, "Profile content test trust key id", 64);
  if (!KEY_ID_PATTERN.test(keyId)) throw new TypeError("Profile content test trust key id is invalid");
  const publicKeyPem = boundedText(trust.public_key_pem, "Profile content test public key", 2048);
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("Profile content test trust must contain an Ed25519 public key");
  }
  return Object.freeze({ keyId, publicKey });
}

export function verifyProfileContentProof({ manifest, envelope, trust, contentBytes } = {}) {
  const normalizedManifest = validateProfileContentManifest(manifest);
  const normalizedEnvelope = validateEnvelope(envelope);
  const normalizedTrust = validateTrust(trust);

  if (normalizedEnvelope.keyId !== normalizedTrust.keyId) {
    throw new Error("Profile content signature key does not match test trust");
  }
  if (
    !(contentBytes instanceof Uint8Array)
    || contentBytes.byteLength < 1
    || contentBytes.byteLength > MAX_CONTENT_BYTES
  ) {
    throw new TypeError("Profile content proof bytes are outside allowed bounds");
  }
  if (contentBytes.byteLength !== normalizedManifest.content_size) {
    throw new Error("Profile content size mismatch");
  }
  const actualHash = createHash("sha256").update(contentBytes).digest("hex");
  if (actualHash !== normalizedManifest.content_hash) {
    throw new Error("Profile content hash mismatch");
  }

  const payload = canonicalProfileContentManifestBytes(normalizedManifest);
  if (!verifySignature(null, payload, normalizedTrust.publicKey, normalizedEnvelope.signature)) {
    throw new Error("Profile content manifest signature verification failed");
  }

  return normalizedManifest;
}
