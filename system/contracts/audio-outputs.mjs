export const AUDIO_OUTPUTS_SCHEMA = "ordax.audio-outputs/1";
export const MAX_AUDIO_OUTPUTS = 16;
const OUTPUT_ID_RE = /^[A-Za-z0-9_.:@-]{1,192}$/;

export function validateAudioOutputsSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema !== AUDIO_OUTPUTS_SCHEMA) {
    throw new TypeError("Audio outputs snapshot schema is invalid");
  }
  if (typeof value.available !== "boolean") {
    throw new TypeError("Audio outputs availability is invalid");
  }
  if (!Array.isArray(value.outputs) || value.outputs.length > MAX_AUDIO_OUTPUTS) {
    throw new TypeError("Audio outputs must be a bounded array");
  }
  if (value.available && value.reason !== null) {
    throw new TypeError("Available audio outputs cannot include an unavailable reason");
  }
  if (!value.available && (typeof value.reason !== "string" || !value.reason)) {
    throw new TypeError("Unavailable audio outputs require a reason");
  }
  const seen = new Set();
  const outputs = value.outputs.map((output) => {
    if (!output || typeof output !== "object" || Array.isArray(output)
        || typeof output.id !== "string" || !OUTPUT_ID_RE.test(output.id)
        || typeof output.name !== "string" || !output.name.trim() || output.name.length > 160
        || typeof output.muted !== "boolean"
        || !Number.isInteger(output.volumePercent) || output.volumePercent < 0 || output.volumePercent > 100) {
      throw new TypeError("Audio output entry is invalid");
    }
    if (seen.has(output.id)) throw new TypeError("Audio output ids must be unique");
    seen.add(output.id);
    return Object.freeze({
      id: output.id,
      name: output.name,
      muted: output.muted,
      volumePercent: output.volumePercent,
    });
  });
  if (value.available && outputs.length === 0) {
    throw new TypeError("Available audio output snapshot cannot be empty");
  }
  if (!value.available && outputs.length > 0) {
    throw new TypeError("Unavailable audio output snapshot cannot contain outputs");
  }
  if (value.defaultOutputId !== null
      && (typeof value.defaultOutputId !== "string" || !seen.has(value.defaultOutputId))) {
    throw new TypeError("Default audio output must identify an available output");
  }
  if (value.available && value.defaultOutputId === null) {
    throw new TypeError("Available audio outputs require a default output");
  }
  return Object.freeze({
    schema: AUDIO_OUTPUTS_SCHEMA,
    available: value.available,
    reason: value.available ? null : value.reason,
    defaultOutputId: value.defaultOutputId,
    outputs: Object.freeze(outputs),
  });
}

export function assertAudioOutputsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== AUDIO_OUTPUTS_SCHEMA) {
    throw new TypeError("A compatible audio outputs port is required");
  }
  for (const method of ["read", "setDefaultOutput", "setVolume", "setMuted"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Audio outputs port must implement ${method}()`);
    }
  }
  return port;
}
