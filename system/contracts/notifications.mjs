import { validateAppActivation } from "./app-activation.mjs";
import { assertLocalizationMessageValue } from "./localization.mjs";

export const NOTIFICATIONS_SCHEMA = "ordax.notifications/3";
export const MAX_NOTIFICATIONS = 64;
export const MAX_DISABLED_NOTIFICATION_SOURCES = 32;

const LEVELS = new Set(["info", "success", "warning", "error"]);
const PERSISTENCE_SCOPES = new Set(["device", "session"]);
const SOURCE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

const PRESENTATION_ID_RE = /^[a-z][a-z0-9.-]{0,95}$/;
const PRESENTATION_VALUE_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const MAX_PRESENTATION_VALUES = 12;
const MAX_PRESENTATION_VALUE_TEXT = 160;

function boundedText(value, label, maximum) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || CONTROL_RE.test(value)
  ) {
    throw new TypeError(`${label} must be bounded printable text`);
  }
  return value;
}

export function validateNotificationId(value) {
  return boundedText(value, "Notification id", 128);
}

export function validateNotificationSourceId(value) {
  if (typeof value !== "string" || !SOURCE_ID_RE.test(value)) {
    throw new TypeError("Notification sourceId is invalid");
  }
  return value;
}

export function validateNotificationPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notification policy must be an object");
  }
  if (typeof value.doNotDisturb !== "boolean") {
    throw new TypeError("Notification doNotDisturb policy must be boolean");
  }
  const disabledSources = value.disabledSources ?? [];
  if (
    !Array.isArray(disabledSources)
    || disabledSources.length > MAX_DISABLED_NOTIFICATION_SOURCES
  ) {
    throw new TypeError(
      `Notification disabledSources must contain at most ${MAX_DISABLED_NOTIFICATION_SOURCES} items`,
    );
  }
  const normalizedSources = disabledSources.map(validateNotificationSourceId).sort();
  if (new Set(normalizedSources).size !== normalizedSources.length) {
    throw new TypeError("Notification disabledSources must contain unique source ids");
  }
  return Object.freeze({
    doNotDisturb: value.doNotDisturb,
    disabledSources: Object.freeze(normalizedSources),
  });
}

export function validateNotificationPresentation(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notification presentation must be an object");
  }
  if (typeof value.id !== "string" || !PRESENTATION_ID_RE.test(value.id)) {
    throw new TypeError("Notification presentation id is invalid");
  }
  const sourceValues = value.values ?? {};
  if (!sourceValues || typeof sourceValues !== "object" || Array.isArray(sourceValues)) {
    throw new TypeError("Notification presentation values must be an object");
  }
  const entries = Object.entries(sourceValues).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > MAX_PRESENTATION_VALUES) {
    throw new TypeError("Notification presentation has too many values");
  }
  const values = {};
  for (const [key, rawValue] of entries) {
    if (!PRESENTATION_VALUE_KEY_RE.test(key)) {
      throw new TypeError("Notification presentation value key is invalid");
    }
    const semanticValue = assertLocalizationMessageValue(
      rawValue,
      `Notification presentation value ${key}`,
    );
    if (typeof semanticValue === "string") {
      values[key] = boundedText(
        semanticValue,
        `Notification presentation value ${key}`,
        MAX_PRESENTATION_VALUE_TEXT,
      );
      continue;
    }
    values[key] = semanticValue;
  }
  return Object.freeze({
    id: value.id,
    values: Object.freeze(values),
  });
}

export function validateNotificationDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notification draft must be an object");
  }
  const sourceId = validateNotificationSourceId(value.sourceId);
  if (!LEVELS.has(value.level)) {
    throw new TypeError("Notification level is invalid");
  }
  const destination = value.destination == null
    ? null
    : validateAppActivation(value.destination);
  const presentation = validateNotificationPresentation(value.presentation);
  const draft = {
    sourceId,
    level: value.level,
    title: boundedText(value.title, "Notification title", 96),
    message: boundedText(value.message, "Notification message", 360),
    destination,
  };
  if (presentation !== null) draft.presentation = presentation;
  return Object.freeze(draft);
}

export function validateNotificationEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notification entry must be an object");
  }
  const draft = validateNotificationDraft(value);
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    throw new TypeError("Notification createdAt must be a non-negative epoch millisecond");
  }
  if (typeof value.read !== "boolean") {
    throw new TypeError("Notification read state must be boolean");
  }
  return Object.freeze({
    id: validateNotificationId(value.id),
    ...draft,
    createdAt: value.createdAt,
    read: value.read,
  });
}

export function validateNotificationEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_NOTIFICATIONS) {
    throw new TypeError(`Notification entries must contain at most ${MAX_NOTIFICATIONS} items`);
  }
  const entries = value.map(validateNotificationEntry);
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new TypeError("Notification entries must have unique ids");
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].createdAt < entries[index].createdAt) {
      throw new TypeError("Notification entries must be ordered newest first");
    }
  }
  return Object.freeze(entries);
}

export function validateNotificationsSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Notifications snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Notifications persistence must be device or session");
  }
  if (!PERSISTENCE_SCOPES.has(value.policyPersistence)) {
    throw new TypeError("Notification policy persistence must be device or session");
  }
  const policy = validateNotificationPolicy({
    doNotDisturb: value.doNotDisturb,
    disabledSources: value.disabledSources,
  });
  const entries = validateNotificationEntries(value.entries);
  return Object.freeze({
    persistence: value.persistence,
    policyPersistence: value.policyPersistence,
    doNotDisturb: policy.doNotDisturb,
    disabledSources: policy.disabledSources,
    unreadCount: entries.reduce((count, entry) => count + (entry.read ? 0 : 1), 0),
    entries,
  });
}

export function assertNotificationsPort(port) {
  if (!port || typeof port !== "object" || port.schema !== NOTIFICATIONS_SCHEMA) {
    throw new TypeError("A compatible notifications port is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "publish",
    "setDoNotDisturb",
    "setSourceEnabled",
    "markRead",
    "markAllRead",
    "dismiss",
    "clearRead",
  ]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Notifications port must implement ${method}()`);
    }
  }
  validateNotificationsSnapshot(port.getSnapshot());
  return port;
}
