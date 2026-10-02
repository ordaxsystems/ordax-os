import {
  IDENTITY_ACTIONS_SCHEMA,
  validateIdentityActionsSnapshot,
} from "../../contracts/identity-actions.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";

function actionsForSession(snapshot, registrationEnabled) {
  if (snapshot.state === "signed-out") {
    return registrationEnabled ? ["sign-in", "register"] : ["sign-in"];
  }
  if (snapshot.state === "signed-in") {
    return ["sign-out"];
  }
  return [];
}

export function createWebIdentityActions(
  windowRef = globalThis.window,
  identitySession = null,
  { registrationEnabled = false } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web identity actions require window.fetch");
  }
  if (typeof registrationEnabled !== "boolean") {
    throw new TypeError("registrationEnabled must be boolean");
  }
  const session = identitySession === null ? null : assertIdentitySessionPort(identitySession);
  let snapshot = validateIdentityActionsSnapshot({
    supportedActions: actionsForSession(session?.getSnapshot() ?? { state: "unavailable" }, registrationEnabled),
  });
  const listeners = new Set();
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) listener(snapshot);
  };

  const update = (sessionSnapshot) => {
    const next = validateIdentityActionsSnapshot({
      supportedActions: actionsForSession(sessionSnapshot, registrationEnabled),
    });
    const before = snapshot.supportedActions.join(",");
    const after = next.supportedActions.join(",");
    snapshot = next;
    if (before !== after) emit();
  };

  const unsubscribe = session?.subscribe(update) ?? (() => {});

  return Object.freeze({
    schema: IDENTITY_ACTIONS_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Identity actions listener must be a function");
      }
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async execute(action) {
      if (!snapshot.supportedActions.includes(action)) {
        throw new Error(`Identity action is unavailable: ${String(action)}`);
      }
      if (action === "sign-in") {
        windowRef.location?.assign?.("/login/");
        return;
      }
      if (action === "register") {
        windowRef.location?.assign?.("/cadastro/");
        return;
      }
      if (action === "sign-out") {
        const response = await windowRef.fetch("/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "manual",
          headers: { Accept: "application/json" },
        });
        if (!(response.ok || response.status === 303 || response.status === 0)) {
          throw new Error(`Identity sign-out failed: ${response.status}`);
        }
        await session?.refresh?.();
        return;
      }
      throw new Error(`Unsupported identity action: ${String(action)}`);
    },
    dispose() {
      disposed = true;
      unsubscribe();
      listeners.clear();
    },
  });
}
