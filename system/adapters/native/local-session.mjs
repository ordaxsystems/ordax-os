import {
  LOCAL_SESSION_SCHEMA,
  assertLocalSessionPort,
  validateLocalSessionSecret,
  validateLocalSessionSnapshot,
} from "../../contracts/local-session.mjs";

const LOCAL_SESSION_ENDPOINT = "/__ordax/native/local-session";

async function request(windowRef, method, action = null, secret = null, signal = null) {
  const body = action === null
    ? undefined
    : JSON.stringify(secret === null ? { action } : { action, secret });
  const response = await windowRef.fetch(LOCAL_SESSION_ENDPOINT, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const error = new Error(`Native local session request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return validateLocalSessionSnapshot(await response.json());
}

export async function createNativeLocalSession(windowRef = globalThis.window, { signal = null } = {}) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native local session requires window.fetch");
  }

  let snapshot = await request(windowRef, "GET", null, null, signal);
  const listeners = new Set();
  let destroyed = false;

  const publish = (next) => {
    snapshot = validateLocalSessionSnapshot(next);
    for (const listener of [...listeners]) listener(snapshot);
    return snapshot;
  };

  const port = {
    schema: LOCAL_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Local session listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async configureCredential(secret) {
      validateLocalSessionSecret(secret);
      return publish(await request(windowRef, "POST", "configure-credential", secret));
    },
    async removeCredential(secret) {
      validateLocalSessionSecret(secret);
      return publish(await request(windowRef, "POST", "remove-credential", secret));
    },
    async lock() {
      return publish(await request(windowRef, "POST", "lock"));
    },
    async unlock(secret) {
      validateLocalSessionSecret(secret);
      return publish(await request(windowRef, "POST", "unlock", secret));
    },
    dispose() {
      destroyed = true;
      listeners.clear();
    },
  };

  assertLocalSessionPort(port);
  return Object.freeze(port);
}
