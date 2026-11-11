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
import { hasNativeHostBridge } from "../../adapters/native/host-bridge.mjs";

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
  const desktopHost = hasDesktopBrowserTransport(windowRef);
  const projection = createVerifiedAppStoreProjection({
    verifiedCatalogPort: nativeCatalog.port,
    componentSource,
    fetchImpl: fetchImpl ?? windowRef.fetch.bind(windowRef),
    // Windows alone exposes the read-only Go pending-health observation.
    // Linux keeps its existing Owner probation path unchanged.
    observePending: desktopHost,
    // Only the positively identified WebKit Native host may offer probation.
    // Loss of the Electron preload must not silently grant Windows that role;
    // its signed Go catalog is not a probation or CURRENT promotion receipt.
    probationHostReady: !desktopHost && hasNativeHostBridge(windowRef),
  });
  await projection.waitForCurrentRefresh();

  let destroyed = false;
  // A pending signed generation may be independently promoted by the trusted
  // Supervisor while the user is away. Reobserve on returning to the Desktop
  // without polling or treating health=healthy as CURRENT authorization.
  const canObserveFocus = desktopHost
    && typeof windowRef.addEventListener === "function"
    && typeof windowRef.removeEventListener === "function";
  let pendingResumeRefresh = null;
  let lastResumeRead = 0;
  const onResume = () => {
    if (destroyed || windowRef.document?.visibilityState === "hidden"
      || pendingResumeRefresh !== null) return;
    // Recheck the signed catalog and Native CURRENT on foreground return even
    // without a staged candidate. External removal, rollback and recovery from
    // an unavailable catalog must not leave stale Store actions on screen.
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
