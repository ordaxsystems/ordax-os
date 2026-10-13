import {
  createUnavailableAppStoreCatalogPort,
} from "../../contracts/app-store.mjs";
import {
  createNativeVerifiedAppStoreCatalog,
} from "../../adapters/native/verified-app-store-catalog.mjs";
import {
  createVerifiedAppStoreProjection,
} from "../../services/apps/verified-store-projection.mjs";

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
  });
  await projection.refresh();

  let destroyed = false;
  return Object.freeze({
    port: projection.port,
    verifiedCatalogPort: nativeCatalog.port,
    getCurrentObservations() {
      return projection.getCurrentObservations();
    },
    async refresh() {
      if (destroyed) return projection.port.getSnapshot();
      await nativeCatalog.refresh();
      return projection.refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      projection.destroy();
      nativeCatalog.destroy();
    },
  });
}
