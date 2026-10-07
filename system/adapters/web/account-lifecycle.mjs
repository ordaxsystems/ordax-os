import {
  ACCOUNT_LIFECYCLE_SCHEMA,
  validateAccountCloseRequest,
  validateAccountLifecycleSnapshot,
} from "../../contracts/account-lifecycle.mjs";
import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";

export function createSameOriginAccountLifecycle(
  windowRef = globalThis.window,
  identitySession = null,
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Account lifecycle adapter requires window.fetch");
  }
  const session = identitySession === null ? null : assertIdentitySessionPort(identitySession);
  let snapshot = validateAccountLifecycleSnapshot({ supportedActions: [] });
  let disposed = false;
  const listeners = new Set();

  const emit = () => {
    if (disposed) return;
    for (const listener of [...listeners]) listener(snapshot);
  };

  const setSupported = (enabled) => {
    const next = validateAccountLifecycleSnapshot({
      supportedActions: enabled === true ? ["close-account"] : [],
    });
    const before = snapshot.supportedActions.join(",");
    const after = next.supportedActions.join(",");
    snapshot = next;
    if (before !== after) emit();
  };

  const refresh = async () => {
    if (disposed) return snapshot;
    if (session && session.getSnapshot().state !== "signed-in") {
      setSupported(false);
      return snapshot;
    }
    try {
      const response = await windowRef.fetch("/auth/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        setSupported(false);
        return snapshot;
      }
      const payload = await response.json();
      setSupported(
        payload?.authenticated === true
        && payload?.accountCloseEnabled === true,
      );
    } catch {
      setSupported(false);
    }
    return snapshot;
  };

  let initialSessionEmission = true;
  const unsubscribe = session?.subscribe((sessionSnapshot) => {
    if (initialSessionEmission) {
      initialSessionEmission = false;
      if (sessionSnapshot.state !== "signed-in") setSupported(false);
      return;
    }
    if (sessionSnapshot.state !== "signed-in") {
      setSupported(false);
      return;
    }
    void refresh();
  }) ?? (() => {});

  return Object.freeze({
    schema: ACCOUNT_LIFECYCLE_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    refresh,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Account lifecycle listener must be a function");
      }
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    async closeAccount(request) {
      if (!snapshot.supportedActions.includes("close-account")) {
        throw new Error("Account close is unavailable");
      }
      const value = validateAccountCloseRequest(request);
      const body = new URLSearchParams();
      body.set("password", value.password);
      body.set("confirmation", value.confirmation);
      const response = await windowRef.fetch("/account/close", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "manual",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: body.toString(),
      });
      if (!response.ok) {
        throw new Error(`Account close failed: ${response.status}`);
      }
      const payload = await response.json();
      if (payload?.closed !== true) {
        throw new Error("Account close response is invalid");
      }
      setSupported(false);
      await session?.refresh?.();
      return Object.freeze({ closed: true });
    },
    dispose() {
      disposed = true;
      unsubscribe();
      listeners.clear();
    },
  });
}
