export const NETWORK_DRAFT_SCHEMA = "ordax.network-draft/1";

const STATES = new Set([
  "signed-out",
  "unselected",
  "ready",
  "drafting",
  "sender-mismatch",
  "paused",
]);

function boundedText(value, label, max = 160) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside bounds`);
  }
  return normalized;
}

function validateCurrentSpace(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Network draft current Space is invalid");
  }
  return Object.freeze({
    id: boundedText(value.id, "Current Space id"),
    name: boundedText(value.name, "Current Space name", 120),
  });
}

export function validateNetworkDraftRecord(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Network draft record is invalid");
  }
  if (typeof value.body !== "string" || value.body.length > 4000) {
    throw new TypeError("Network draft body is invalid");
  }
  return Object.freeze({
    subjectId: boundedText(value.subjectId, "Network draft subject id"),
    senderSpaceId: boundedText(value.senderSpaceId, "Network draft sender Space id"),
    senderSpaceName: boundedText(value.senderSpaceName, "Network draft sender Space name", 120),
    conversationId: boundedText(value.conversationId, "Network draft conversation id"),
    body: value.body,
  });
}

export function validateNetworkDraftSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Network draft snapshot must be an object");
  }
  if (value.schema !== NETWORK_DRAFT_SCHEMA || !STATES.has(value.state)) {
    throw new TypeError("Network draft snapshot schema/state is incompatible");
  }

  const subjectId = value.subjectId == null
    ? null
    : boundedText(value.subjectId, "Network draft subject id");
  const currentSpace = validateCurrentSpace(value.currentSpace ?? null);
  const draft = validateNetworkDraftRecord(value.draft ?? null);

  if (value.state === "signed-out") {
    if (subjectId !== null || currentSpace !== null || draft !== null) {
      throw new TypeError("Signed-out Network draft state cannot expose identity or draft");
    }
  } else if (subjectId === null) {
    throw new TypeError("Signed-in Network draft state requires subject identity");
  }

  if (value.state === "unselected" && (currentSpace !== null || draft !== null)) {
    throw new TypeError("Unselected Network draft state cannot expose Space or draft");
  }
  if (value.state === "ready" && (currentSpace === null || draft !== null)) {
    throw new TypeError("Ready Network draft state requires Space and no draft");
  }
  if (value.state === "drafting") {
    if (
      currentSpace === null
      || draft === null
      || draft.subjectId !== subjectId
      || draft.senderSpaceId !== currentSpace.id
    ) {
      throw new TypeError("Drafting Network state must match the active sender Space");
    }
  }
  if (value.state === "sender-mismatch") {
    if (
      currentSpace === null
      || draft === null
      || draft.subjectId !== subjectId
      || draft.senderSpaceId === currentSpace.id
    ) {
      throw new TypeError("Sender mismatch requires an explicitly different active Space");
    }
  }
  if (value.state === "paused") {
    if (currentSpace !== null || draft === null || draft.subjectId !== subjectId) {
      throw new TypeError("Paused Network draft requires retained draft without active Space");
    }
  }

  return Object.freeze({
    schema: NETWORK_DRAFT_SCHEMA,
    state: value.state,
    subjectId,
    currentSpace,
    draft,
  });
}

export function assertNetworkDraftPort(port) {
  if (!port || typeof port !== "object" || port.schema !== NETWORK_DRAFT_SCHEMA) {
    throw new TypeError("Compatible Network draft port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "begin",
    "setBody",
    "retargetToCurrentSpace",
    "bindSend",
    "clear",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Network draft port must implement ${method}()`);
    }
  }
  validateNetworkDraftSnapshot(port.getSnapshot());
  return port;
}
