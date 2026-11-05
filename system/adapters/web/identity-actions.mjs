import {
  IDENTITY_ACTIONS_SCHEMA,
  validateIdentityActionsSnapshot,
} from "../../contracts/identity-actions.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import { runWebRequestWithinDeadline } from "./json-read.mjs";

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
  { registrationEnabled = false, registrationPolicy = null } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web identity actions require window.fetch");
  }
  if (typeof registrationEnabled !== "boolean") {
    throw new TypeError("registrationEnabled must be boolean");
  }
  if (registrationPolicy !== null && typeof registrationPolicy !== "function") {
    throw new TypeError("registrationPolicy must be a function when provided");
  }
  const session = identitySession === null ? null : assertIdentitySessionPort(identitySession);
  let registrationAllowed = registrationEnabled;
  let snapshot = validateIdentityActionsSnapshot({
    supportedActions: actionsForSession(session?.getSnapshot() ?? { state: "unavailable" }, registrationAllowed),
  });
  const listeners = new Set();
  let disposed = false;
  let policyRefreshSequence = 0;
  // One logout command and one verification per Web session, even on rapid clicks.
  let pendingSignOut = null;
  let logoutController = null;

  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) listener(snapshot);
  };

  const update = (sessionSnapshot) => {
    const next = validateIdentityActionsSnapshot({
      supportedActions: actionsForSession(sessionSnapshot, registrationAllowed),
    });
    const before = snapshot.supportedActions.join(",");
    const after = next.supportedActions.join(",");
    if (before === after) return;
    snapshot = next;
    emit();
  };

  const unsubscribe = session?.subscribe(update) ?? (() => {});

  const refreshRegistration = async () => {
    if (disposed) return snapshot;
    const sequence = ++policyRefreshSequence;
    let nextAllowed = registrationEnabled;
    if (registrationPolicy !== null) {
      try {
        const policy = await registrationPolicy();
        nextAllowed = policy?.registrationEnabled === true;
      } catch {
        nextAllowed = false;
      }
    }
    if (disposed || sequence !== policyRefreshSequence) return snapshot;
    if (nextAllowed !== registrationAllowed) {
      registrationAllowed = nextAllowed;
      update(session?.getSnapshot() ?? { state: "unavailable" });
    }
    return snapshot;
  };

  return Object.freeze({
    schema: IDENTITY_ACTIONS_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    async refresh() {
      return refreshRegistration();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Identity actions listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async execute(action) {
      if (disposed) throw new Error("Identity actions are disposed");
      // Join the pending request before the session refresh can change the
      // supported-actions snapshot; do not send another logout POST.
      if (action === "sign-out" && pendingSignOut !== null) return pendingSignOut;
      if (!snapshot.supportedActions.includes(action)) {
        throw new Error(`Identity action is unavailable: ${String(action)}`);
      }
      // The displayed policy may have been revoked since the last session read.
      // Navigation never creates an account; the destination still owns consent.
      if (action === "register" && registrationPolicy !== null) {
        await refreshRegistration();
        if (disposed || !snapshot.supportedActions.includes(action)) {
          throw new Error("Identity registration is unavailable");
        }
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
        const attempt = (async () => {
          const controller = new AbortController();
          logoutController = controller;
          let response;
          try {
            response = await runWebRequestWithinDeadline(windowRef, controller, (signal) =>
              windowRef.fetch("/auth/logout", {
                method: "POST",
                credentials: "same-origin",
                cache: "no-store",
                redirect: "manual",
                headers: { Accept: "application/json" },
                signal,
              }), "Web logout request");
          } finally {
            if (logoutController === controller) logoutController = null;
          }
          if (!(response.ok || response.status === 303 || response.status === 0)) {
            throw new Error(`Identity sign-out failed: ${response.status}`);
          }
          if (disposed) throw new Error("Identity actions are disposed");
          // A response acknowledges the command; only the canonical session
          // reader proves that the browser is actually signed out.
          await session?.refresh?.();
          if (disposed || session?.getSnapshot().state !== "signed-out") {
            throw new Error("Identity sign-out not confirmed by the session gateway");
          }
        })();
        pendingSignOut = attempt.finally(() => { pendingSignOut = null; });
        return pendingSignOut;
      }
      throw new Error(`Unsupported identity action: ${String(action)}`);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      policyRefreshSequence += 1;
      logoutController?.abort(new Error("Identity actions are disposed"));
      logoutController = null;
      unsubscribe();
      listeners.clear();
    },
  });
}
