import {
  createUnavailableAppStoreCatalogPort,
} from "../../contracts/app-store.mjs";
import {
  createNativeVerifiedAppStoreCatalog,
} from "../../adapters/native/verified-app-store-catalog.mjs";
import {
  createVerifiedAppStoreProjection,
} from "../../services/apps/verified-store-projection.mjs";
import { hasDesktopBrowserTransport } from "../../adapters/native/browser-host-transport.mjs";

export async function createNativeStoreCatalogComposition({
  windowRef = globalThis.window,
  componentSource,
  fetchImpl = null,
} = {}) {
  const unavailable = createUnavailableAppStoreCatalogPort();
  if (!windowRef || typeof windowRef.fetch !== "function") {
    return Object.freeze({
      port: unavailable,
      verifiedCatalogPort: null,
      getCurrentObservations() {
        return Object.freeze([]);
      },
      async refresh() {
        return unavailable.getSnapshot();
      },
      destroy() {},
    });
  }

  const nativeCatalog = await createNativeVerifiedAppStoreCatalog(windowRef);
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: nativeCatalog.port,
    componentSource,
    fetchImpl: fetchImpl ?? windowRef.fetch.bind(windowRef),
    // Windows alone exposes the read-only Go pending-health observation.
    // Linux keeps its existing Owner probation path unchanged.
    observePending: hasDesktopBrowserTransport(windowRef),
    // The installed Electron transport has no component probation receipt
    // owner. A Go-accepted staged artifact cannot become CURRENT merely from
    // a renderer bridge or a signed catalog. Do not offer a dead-end install
    // until an independently trusted Windows probation owner is connected.
    probationHostReady: !hasDesktopBrowserTransport(windowRef),
  });
  await projection.waitForCurrentRefresh();

  let destroyed = false;
  // A pending signed generation may be independently promoted by the trusted
  // Supervisor while the user is away. Reobserve on returning to the Desktop
  // without polling or treating health=healthy as CURRENT authorization.
  const desktopHost = hasDesktopBrowserTransport(windowRef);
  const canObserveFocus = desktopHost
    && typeof windowRef.addEventListener === "function"
    && typeof windowRef.removeEventListener === "function";
  let pendingResumeRefresh = null;
  let lastResumeRead = 0;
  const onResume = () => {
    if (destroyed || windowRef.document?.visibilityState === "hidden"
      || pendingResumeRefresh !== null) return;
    const snapshot = projection.port.getSnapshot();
    if (snapshot.state !== "ready"
      || !snapshot.entries.some(entry => entry.state === "staged")) return;
    const now = Date.now();
    if (now - lastResumeRead < 1500) return;
    lastResumeRead = now;
    // Use the existing signed catalog owner, which in turn refreshes the same
    // Go-verified CURRENT and pending metadata. No extra install inventory.
    pendingResumeRefresh = Promise.resolve().then(() => {
      if (!destroyed) return nativeCatalog.refresh();
    }).then(() => {
      if (!destroyed) return projection.waitForCurrentRefresh();
    }).catch(() => {
      // Existing catalog/activation ports already fail closed on read error.
    }).finally(() => { pendingResumeRefresh = null; });
  };
  if (canObserveFocus) windowRef.addEventListener("focus", onResume);
  const visibleDocument = canObserveFocus && windowRef.document
    && typeof windowRef.document.addEventListener === "function"
    && typeof windowRef.document.removeEventListener === "function"
    ? windowRef.document : null;
  visibleDocument?.addEventListener("visibilitychange", onResume);

  return Object.freeze({
    port: projection.port,
    verifiedCatalogPort: nativeCatalog.port,
    getCurrentObservations() {
      return projection.getCurrentObservations();
    },
    async refresh() {
      if (destroyed) return projection.port.getSnapshot();
      await nativeCatalog.refresh();
      return projection.waitForCurrentRefresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (canObserveFocus) windowRef.removeEventListener("focus", onResume);
      visibleDocument?.removeEventListener("visibilitychange", onResume);
      projection.destroy();
      nativeCatalog.destroy();
    },
  });
}
