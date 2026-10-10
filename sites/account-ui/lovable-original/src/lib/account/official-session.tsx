import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Presentation-only view over /auth/session, not a second auth/session owner. */
export type OfficialAccountState =
  | { status: "checking" | "anonymous" | "unavailable"; email?: never }
  | { status: "authenticated"; email: string | null };

const Context = createContext<OfficialAccountState>({ status: "checking" });

export function fromCanonicalSession(value: unknown): OfficialAccountState {
  if (!value || typeof value !== "object") throw new Error("invalid-session");
  const s = value as Record<string, unknown>;
  if (s.$schema !== "prototype-ordax.public-identity-session/1"
      || s.provider !== "supabase") throw new Error("invalid-session-contract");
  if (s.authenticated === false && s.status === "anonymous") return { status: "anonymous" };
  if (s.authenticated === true && s.status === "authenticated"
      && typeof s.subject === "string" && s.subject.length > 0) {
    return { status: "authenticated", email: typeof s.email === "string" && s.email.length <= 254 ? s.email : null };
  }
  throw new Error("invalid-session-state");
}

export function OfficialAccountSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OfficialAccountState>({ status: "checking" });
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ status: "checking" }); // Never display stale identity during revalidation.
    fetch("/auth/session", {
      method: "GET", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json" }, signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("session-unavailable");
      return fromCanonicalSession(await response.json());
    }).then(session => {
      if (!controller.signal.aborted) setState(session);
    }).catch(() => {
      if (!controller.signal.aborted) setState({ status: "unavailable" });
    });
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onFocus = () => refresh();
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      pending.current?.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh]);

  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useOfficialAccountSession() { return useContext(Context); }
