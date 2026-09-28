import {
  IDENTITY_SESSION_SCHEMA,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import { NETWORK_CONNECTIVITY_ESTABLISHED_EVENT } from "../../contracts/connectivity-signal.mjs";

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
    try {
      const response = await windowRef.fetch(SESSION_ENDPOINT, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return setSnapshot({ state: "unavailable" });
      }
      const value = await response.json();
      if (!value || value.$schema !== SESSION_SCHEMA) {
        return setSnapshot({ state: "unavailable" });
      }
      if (value.provider === "unconfigured") {
        return setSnapshot({ state: "unavailable" });
      }
      if (value.authenticated === true && value.status === "authenticated") {
        const displayName = publicDisplayName(value.email);
        if (typeof value.subject !== "string" || !value.subject || !displayName) {
          return setSnapshot({ state: "unavailable" });
        }
        return setSnapshot({
          state: "signed-in",
          subjectId: value.subject,
          displayName,
        });
      }
      return setSnapshot({ state: "signed-out" });
    } catch {
      return setSnapshot({ state: "unavailable" });
    }
  };

  const refreshAfterConnectivity = () => {
    if (!disposed) void refresh();
  };
  if (typeof windowRef.addEventListener === "function") {
    windowRef.addEventListener(
      NETWORK_CONNECTIVITY_ESTABLISHED_EVENT,
      refreshAfterConnectivity,
    );
  }

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
      if (typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener(
          NETWORK_CONNECTIVITY_ESTABLISHED_EVENT,
          refreshAfterConnectivity,
        );
      }
      listeners.clear();
    },
  });
}
