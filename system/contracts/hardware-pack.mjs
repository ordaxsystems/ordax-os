export const HARDWARE_PACK_SCHEMA = "ordax.hardware-pack/1";

const ID_RE = /^[a-z][a-z0-9._-]{0,95}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PACK_TYPES = new Set(["wifi", "graphics", "audio", "input", "firmware", "storage"]);
const ARCHES = new Set(["x86_64", "aarch64"]);

function text(value, label, max = 200) {
  if (typeof value !== "string" || value.includes("\0")) throw new TypeError(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new TypeError(`${label} is outside bounds`);
  return normalized;
}

function stringList(value, label, max = 64) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${label} must be bounded`);
  const normalized = value.map((item) => text(item, label, 160));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must be unique`);
  return Object.freeze(normalized);
}

export function defineHardwarePack(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hardware pack must be an object");
  }
  if (typeof value.id !== "string" || !ID_RE.test(value.id)) throw new TypeError("Hardware pack id is invalid");
  if (!PACK_TYPES.has(value.type)) throw new TypeError("Hardware pack type is unsupported");
  if (!ARCHES.has(value.architecture)) throw new TypeError("Hardware pack architecture is unsupported");
  if (typeof value.sha256 !== "string" || !SHA256_RE.test(value.sha256)) {
    throw new TypeError("Hardware pack sha256 is invalid");
  }
  return Object.freeze({
    schema: HARDWARE_PACK_SCHEMA,
    id: value.id,
    version: text(value.version, "hardware pack version", 64),
    type: value.type,
    architecture: value.architecture,
    sha256: value.sha256,
    sourceRevision: text(value.sourceRevision, "hardware pack source revision", 160),
    license: text(value.license, "hardware pack license", 120),
    kernelAbi: text(value.kernelAbi, "hardware pack kernel ABI", 120),
    modaliases: stringList(value.modaliases ?? [], "hardware pack modaliases", 128),
    kernelModules: stringList(value.kernelModules ?? [], "hardware pack kernel modules"),
    firmwareFiles: stringList(value.firmwareFiles ?? [], "hardware pack firmware files", 256),
    activation: Object.freeze({
      bootCritical: value.activation?.bootCritical === true,
      rebootRequired: value.activation?.rebootRequired !== false,
      componentSlotRequired: value.activation?.componentSlotRequired !== false,
      signedManifestRequired: value.activation?.signedManifestRequired !== false,
    }),
  });
}

export function hardwarePackMatches(packValue, device) {
  const pack = defineHardwarePack(packValue);
  if (!device || typeof device !== "object" || Array.isArray(device)) {
    throw new TypeError("Hardware device descriptor is required");
  }
  if (device.architecture !== pack.architecture) return false;
  if (device.kernelAbi !== pack.kernelAbi) return false;
  if (pack.modaliases.length === 0) return false;
  return pack.modaliases.includes(device.modalias);
}
