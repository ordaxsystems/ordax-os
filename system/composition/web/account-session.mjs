import { createWebIdentitySession } from "../../adapters/web/identity.mjs";
import { createWebIdentityActions } from "../../adapters/web/identity-actions.mjs";
import { createWebSpacesCatalog } from "../../adapters/web/spaces.mjs";
import { createWebSurfaceHost } from "../../adapters/web/runtime.mjs";
import { createWebSpaceSelectionStore } from "../../adapters/web/space-selection.mjs";
import { createSpaceSelectionRuntime } from "../../services/spaces/selection.mjs";

// Composition only: the adapters retain all validation, credentials and state.
export function createWebAccountSession(windowRef = globalThis.window) {
  const identity = createWebIdentitySession(windowRef);
  const actions = createWebIdentityActions(windowRef, identity);
  const spaces = createWebSpacesCatalog(windowRef);
  // The domain service owns subject changes, catalog invalidation and selection.
  const selection = createSpaceSelectionRuntime({
    identitySession: identity, spaces, store: createWebSpaceSelectionStore(),
  });
  const surface = createWebSurfaceHost(windowRef, {
    readAccountIdentityAvailable: () => identity.getSnapshot().state !== "unavailable",
  });
  let pending = null;
  let disposed = false;
  const releaseIdentity = identity.subscribe(() => surface.refresh());
  let connectivity = surface.getSnapshot().connectivity;
  let connectivityRevision = 0;
  const releaseSurface = surface.subscribe(snapshot => {
    if (snapshot.connectivity === connectivity) return;
    connectivity = snapshot.connectivity;
    connectivityRevision += 1;
    // Canonical reset aborts the read and invalidates selection until revalidation.
    if (connectivity === "offline") spaces.reset();
  });
  function refresh() {
    if (disposed || surface.getSnapshot().connectivity === "offline") return Promise.resolve();
    if (pending !== null) return pending;
    pending = (async () => {
      // A reconnect during an in-flight read requests one fresh pass afterwards.
      // Only reads are repeated; identity commands are never replayed.
      while (!disposed && surface.getSnapshot().connectivity !== "offline") {
        const revision = connectivityRevision;
        await identity.refresh();
        if (disposed || surface.getSnapshot().connectivity === "offline") break;
        if (revision !== connectivityRevision) continue;
        if (identity.getSnapshot().state === "signed-in") await spaces.refresh();
        if (revision === connectivityRevision) break;
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
    identity, actions, spaces, selection, surface, refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      windowRef.removeEventListener("focus", refreshQuietly);
      windowRef.removeEventListener("online", refreshQuietly);
      windowRef.document?.removeEventListener("visibilitychange", onVisibility);
      releaseIdentity();
      releaseSurface();
      selection.dispose();
      actions.dispose();
      spaces.dispose();
      identity.dispose();
      surface.dispose();
    },
  });
}
