export const ACCOUNT_LIFECYCLE_SCHEMA = "ordax.account-lifecycle/1";

const CLOSE_ACTION = "close-account";

export function validateAccountLifecycleSnapshot(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Account lifecycle snapshot must be an object");
  }
  const supportedActions = value.supportedActions ?? [];
  if (!Array.isArray(supportedActions)) {
    throw new TypeError("Account lifecycle supportedActions must be an array");
  }
  const seen = new Set();
  const normalized = supportedActions.map((action) => {
    if (action !== CLOSE_ACTION || seen.has(action)) {
      throw new TypeError(`Unsupported or duplicate account lifecycle action: ${String(action)}`);
    }
    seen.add(action);
    return action;
  });
  return Object.freeze({ supportedActions: Object.freeze(normalized) });
}

export function validateAccountCloseRequest(value) {
  if (!value || typeof value !== "object") {
    throw new TypeError("Account close request is required");
  }
  const password = value.password;
  if (
    typeof password !== "string"
    || password.length < 1
    || password.length > 1024
    || password.includes("\0")
  ) {
    throw new TypeError("Current account password is invalid");
  }
  if (value.confirmation !== CLOSE_ACTION) {
    throw new TypeError("Explicit account close confirmation is required");
  }
  return Object.freeze({ password, confirmation: CLOSE_ACTION });
}

export function isAccountLifecycleActionSupported(snapshotValue, action) {
  const snapshot = validateAccountLifecycleSnapshot(snapshotValue);
  return snapshot.supportedActions.includes(action);
}

export function assertAccountLifecyclePort(port) {
  if (!port || typeof port !== "object" || port.schema !== ACCOUNT_LIFECYCLE_SCHEMA) {
    throw new TypeError("A compatible account lifecycle port is required");
  }
  if (
    typeof port.getSnapshot !== "function"
    || typeof port.subscribe !== "function"
    || typeof port.refresh !== "function"
    || typeof port.closeAccount !== "function"
  ) {
    throw new TypeError(
      "Account lifecycle port must implement getSnapshot(), subscribe(), refresh() and closeAccount()",
    );
  }
  validateAccountLifecycleSnapshot(port.getSnapshot());
  return port;
}
