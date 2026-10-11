import {
  IDENTITY_SESSION_SCHEMA,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";

const SESSION_ENDPOINT = "/auth/session";
const SESSION_SCHEMA = "prototype-ordax.public-identity-session/1";

function publicDisplayName(value) {
  if (typeof value !== "string" || !value) return null;
  const at = value.indexOf("@");
  return at > 0 ? value.slice(0, at) : value;
}

export function createWebIdentitySession(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web identity session requires window.fetch");
  }

  let snapshot = validateIdentitySessionSnapshot({ state: "unavailable" });
  const listeners = new Set();
  let disposed = false;
  let refreshSequence = 0;

  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) listener(snapshot);
  };

  const setSnapshot = (next) => {
    const validated = validateIdentitySessionSnapshot(next);
    const changed =
      validated.state !== snapshot.state
      || validated.subjectId !== snapshot.subjectId
      || validated.displayName !== snapshot.displayName;
    snapshot = validated;
    if (changed) emit();
    return snapshot;
  };

  const refresh = async () => {
    if (disposed) return snapshot;
    // Ignore late responses from earlier requests. One session port owns the
    // ordering for every consumer (OOBE, Surface and account actions).
    const sequence = ++refreshSequence;
    const apply = (next) => (
      disposed || sequence !== refreshSequence ? snapshot : setSnapshot(next)
    );
    try {
      const response = await windowRef.fetch(SESSION_ENDPOINT, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return apply({ state: "unavailable" });
      }
      const value = await response.json();
      if (!value || value.$schema !== SESSION_SCHEMA) {
        return apply({ state: "unavailable" });
      }
      if (value.provider === "unconfigured") {
        return apply({ state: "unavailable" });
      }
      if (value.authenticated === true && value.status === "authenticated") {
        const displayName = publicDisplayName(value.email);
        if (typeof value.subject !== "string" || !value.subject || !displayName) {
          return apply({ state: "unavailable" });
        }
        return apply({
          state: "signed-in",
          subjectId: value.subject,
          displayName,
        });
      }
      return apply({ state: "signed-out" });
    } catch {
      return apply({ state: "unavailable" });
    }
  };

  return Object.freeze({
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Identity session listener must be a function");
      }
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    refresh,
    dispose() {
      disposed = true;
      refreshSequence += 1;
      listeners.clear();
    },
  });
}
