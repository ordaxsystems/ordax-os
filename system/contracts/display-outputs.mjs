export const DISPLAY_OUTPUTS_SCHEMA = "ordax.display-outputs/1";

const OUTPUT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const MODE_ID = /^\d{1,5}x\d{1,5}@\d{1,4}(?:\.\d{1,3})?$/;
const MAX_OUTPUTS = 8;
const MAX_MODES = 96;

function validateMode(mode) {
  if (!mode || typeof mode !== "object" || !MODE_ID.test(mode.id)) {
    throw new TypeError("Display output mode identity is invalid");
  }
  if (!Number.isInteger(mode.width) || mode.width < 320 || mode.width > 16384) {
    throw new TypeError("Display output mode width is invalid");
  }
  if (!Number.isInteger(mode.height) || mode.height < 200 || mode.height > 16384) {
    throw new TypeError("Display output mode height is invalid");
  }
  if (typeof mode.refreshHz !== "number" || !Number.isFinite(mode.refreshHz)
      || mode.refreshHz < 1 || mode.refreshHz > 1000) {
    throw new TypeError("Display output mode refreshHz is invalid");
  }
  return Object.freeze({
    id: mode.id,
    width: mode.width,
    height: mode.height,
    refreshHz: mode.refreshHz,
    preferred: mode.preferred === true,
    current: mode.current === true,
  });
}

function validateOutput(output) {
  if (!output || typeof output !== "object" || !OUTPUT_ID.test(output.id)) {
    throw new TypeError("Display output identity is invalid");
  }
  if (typeof output.name !== "string" || output.name.length < 1 || output.name.length > 160) {
    throw new TypeError("Display output name is invalid");
  }
  if (typeof output.enabled !== "boolean" || !Array.isArray(output.modes)
      || (output.enabled && output.modes.length < 1) || output.modes.length > MAX_MODES) {
    throw new TypeError("Display output modes are invalid");
  }
  const modes = output.modes.map(validateMode);
  if (new Set(modes.map((mode) => mode.id)).size !== modes.length) {
    throw new TypeError("Display output mode identities must be unique");
  }
  const current = modes.filter((mode) => mode.current);
  if (current.length > 1 || (output.enabled && current.length !== 1)) {
    throw new TypeError("An enabled display output must have exactly one current mode");
  }
  return Object.freeze({
    id: output.id,
    name: output.name,
    enabled: output.enabled,
    currentModeId: current[0]?.id ?? null,
    modes: Object.freeze(modes),
  });
}

export function validateDisplayOutputsSnapshot(value) {
  if (!value || typeof value !== "object" || value.schema !== DISPLAY_OUTPUTS_SCHEMA) {
    throw new TypeError("Display outputs snapshot schema is invalid");
  }
  if (typeof value.available !== "boolean") {
    throw new TypeError("Display outputs availability is invalid");
  }
  const outputs = Array.isArray(value.outputs) ? value.outputs : null;
  if (!outputs || outputs.length > MAX_OUTPUTS) {
    throw new TypeError("Display outputs must be a bounded array");
  }
  const validatedOutputs = outputs.map(validateOutput);
  if (new Set(validatedOutputs.map((output) => output.id)).size !== validatedOutputs.length) {
    throw new TypeError("Display output identities must be unique");
  }
  if (value.available && validatedOutputs.length === 0) {
    throw new TypeError("Available display output capability must report an output");
  }
  if (value.available && !validatedOutputs.some((output) => output.enabled)) {
    throw new TypeError("Available display output capability must report an enabled output");
  }
  if (!value.available && validatedOutputs.length !== 0) {
    throw new TypeError("Unavailable display output capability cannot report modes");
  }
  const reason = value.reason === null ? null : value.reason;
  if (reason !== null && !["provider-missing", "compositor-unsupported", "host-unavailable"].includes(reason)) {
    throw new TypeError("Display outputs unavailable reason is invalid");
  }
  if (value.available && reason !== null) {
    throw new TypeError("Available display outputs cannot include an unavailable reason");
  }
  let preview = null;
  if (value.preview !== null && value.preview !== undefined) {
    const item = value.preview;
    if (!item || typeof item !== "object" || typeof item.id !== "string"
        || item.id.length < 16 || item.id.length > 128
        || !OUTPUT_ID.test(item.outputId) || !MODE_ID.test(item.modeId)
        || !Number.isInteger(item.expiresAt) || item.expiresAt < 0) {
      throw new TypeError("Display output preview state is invalid");
    }
    const output = validatedOutputs.find((candidate) => candidate.id === item.outputId);
    if (!output || !output.modes.some((mode) => mode.id === item.modeId)) {
      throw new TypeError("Display output preview must reference a reported mode");
    }
    preview = Object.freeze({ ...item });
  }
  return Object.freeze({
    schema: DISPLAY_OUTPUTS_SCHEMA,
    available: value.available,
    reason,
    outputs: Object.freeze(validatedOutputs),
    preview,
  });
}

export function assertDisplayOutputsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== DISPLAY_OUTPUTS_SCHEMA) {
    throw new TypeError("A compatible display outputs port is required");
  }
  for (const method of ["read", "preview", "confirm", "revert"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Display outputs port must implement ${method}()`);
    }
  }
  return port;
}
