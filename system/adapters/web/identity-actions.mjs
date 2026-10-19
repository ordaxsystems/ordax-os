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

  // One canonical logout request serves both Settings and First Run. Native
  // may acknowledge local cookie detachment while remote revocation is offline.
  const disconnectLocal = async () => {
    if (disposed) throw new Error("Identity actions are disposed");
    const response = await windowRef.fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    let remoteRevocation = "confirmed";
    if (response.status === 202) {
      const receipt = await response.json();
      if (
        !receipt
        || receipt.$schema !== "ordax.native-account-detach/1"
        || receipt.localSessionDetached !== true
        || !["unconfirmed", "not-applicable"].includes(receipt.remoteRevocation)
      ) throw new Error("Native account detachment proof is invalid");
      remoteRevocation = receipt.remoteRevocation;
    } else if (!(response.ok || response.status === 303)) {
      throw new Error(`Identity sign-out failed: ${response.status}`);
    }
    await session?.refresh?.();
    // An unavailable server is not proof of a guest session. Only an
    // explicit Native-local detachment receipt can permit offline continuation.
    if (
      session?.getSnapshot().state !== "signed-out"
      && !(response.status === 202 && session?.getSnapshot().state === "unavailable")
    ) throw new Error("Identity sign-out was not confirmed by the session authority");
    return Object.freeze({ localSessionDetached: true, remoteRevocation });
  };

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
    disconnectLocal,
    async execute(action) {
      if (disposed) throw new Error("Identity actions are disposed");
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
        await disconnectLocal();
        return;
      }
      throw new Error(`Unsupported identity action: ${String(action)}`);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      policyRefreshSequence += 1;
      unsubscribe();
      listeners.clear();
    },
  });
}
