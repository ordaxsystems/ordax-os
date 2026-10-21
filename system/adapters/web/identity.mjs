import {
  IDENTITY_SESSION_SCHEMA,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";

import { createWebJsonReader } from "./json-read.mjs";

const SESSION_ENDPOINT = "/auth/session";
const SESSION_SCHEMA = "prototype-ordax.public-identity-session/1";

function safeDisplayName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || Array.from(normalized).length > 120 || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}

function publicDisplayName(value, accountDisplayName = null) {
  const profileName = safeDisplayName(accountDisplayName);
  if (profileName) return profileName;
  if (typeof value !== "string" || !value) return null;
  const at = value.indexOf("@");
  return at > 0 ? value.slice(0, at) : value;
}

export function createWebIdentitySession(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web identity session requires window.fetch");
  }

  let snapshot = validateIdentitySessionSnapshot({ state: "unavailable" });
  const reader = createWebJsonReader(windowRef);
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
      || validated.displayName !== snapshot.displayName
      || validated.email !== snapshot.email;
    if (!changed) return snapshot;
    snapshot = validated;
    emit();
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
      const response = await reader.read(SESSION_ENDPOINT);
      if (!response.ok) {
        return apply({ state: "unavailable" });
      }
      const value = response.value;
      if (!value || value.$schema !== SESSION_SCHEMA) {
        return apply({ state: "unavailable" });
      }
      if (value.provider === "unconfigured") {
        return apply({ state: "unavailable" });
      }
      if (value.authenticated === true && value.status === "authenticated") {
        const displayName = publicDisplayName(value.email, value.displayName);
        if (typeof value.subject !== "string" || !value.subject || !displayName) {
          return apply({ state: "unavailable" });
        }
        return apply({
          state: "signed-in",
          subjectId: value.subject,
          displayName,
          email: value.email,
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
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    refresh,
    // Adapter lifecycle extension; the neutral identity-session port is unchanged.
    cancelRefresh() {
      if (disposed) return;
      refreshSequence += 1;
      reader.cancel();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      refreshSequence += 1;
      reader.dispose();
      listeners.clear();
    },
  });
}
