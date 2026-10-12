import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebSpacesCatalog } from "../../adapters/web/spaces.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";

// Composition only: the adapters retain all validation, credentials and state.
export function createWebAccountSession(windowRef = globalThis.window) {
  const identity = createWebIdentitySession(windowRef);
  const actions = createWebIdentityActions(windowRef, identity);
  const spaces = createWebSpacesCatalog(windowRef);
  const surface = createWebSurfaceHost(windowRef, {
    readAccountIdentityAvailable: () => identity.getSnapshot().state !== "unavailable",
  });
  let subjectId = null;
  let pending = null;
  let disposed = false;
  const releaseIdentity = identity.subscribe((snapshot) => {
    const nextSubject = snapshot.state === "signed-in" ? snapshot.subjectId : null;
    if (nextSubject !== subjectId) {
      subjectId = nextSubject;
      // Aborts old catalog reads before another subject can see their results.
      spaces.reset();
    }
    surface.refresh();
  });
  function refresh() {
    if (disposed) return Promise.resolve();
    if (pending !== null) return pending;
    pending = (async () => {
      await identity.refresh();
      if (!disposed && identity.getSnapshot().state === "signed-in") {
        await spaces.refresh();
      }
    })().finally(() => { pending = null; });
    return pending;
  }
  const refreshQuietly = () => { void refresh().catch(() => {}); };
  const onVisibility = () => {
    if (windowRef.document?.visibilityState === "visible") refreshQuietly();
  };
  windowRef.addEventListener("focus", refreshQuietly);
  windowRef.addEventListener("online", refreshQuietly);
  windowRef.document?.addEventListener("visibilitychange", onVisibility);
  return Object.freeze({
    identity, actions, spaces, surface, refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      windowRef.removeEventListener("focus", refreshQuietly);
      windowRef.removeEventListener("online", refreshQuietly);
      windowRef.document?.removeEventListener("visibilitychange", onVisibility);
      releaseIdentity();
      actions.dispose();
      spaces.dispose();
      identity.dispose();
      surface.dispose();
    },
  });
}
