import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { APP_STORE_CATALOG_PORT_SCHEMA, createUnavailableAppStoreCatalogPort } from '../../../../contracts/app-store.mjs';
import { createStoreSnapshotSource, type StoreSnapshot } from '../../lib/store/official';

const fallback = createUnavailableAppStoreCatalogPort('web-store-transport-unavailable');
const StoreCatalogContext = createContext<StoreSnapshot>(fallback.getSnapshot());
const StoreCatalogPortContext = createContext<unknown>(fallback);

export function StoreCatalogProvider({ port, children }: { port: unknown; children: ReactNode }) {
  const source = useMemo(() => createStoreSnapshotSource(port), [port]);
  // The shared DOM view consumes the same validated snapshot cache as React.
  const presentationPort = useMemo(() => ({
    schema: APP_STORE_CATALOG_PORT_SCHEMA, authority: 'none',
    getSnapshot: source.getSnapshot,
    subscribe: (listener: (value: StoreSnapshot) => void) => source.subscribe(() => listener(source.getSnapshot())),
  }), [source]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return <StoreCatalogPortContext.Provider value={presentationPort}><StoreCatalogContext.Provider value={snapshot}>{children}</StoreCatalogContext.Provider></StoreCatalogPortContext.Provider>;
}

export function useStoreCatalog() { return useContext(StoreCatalogContext); }
export function useStoreCatalogPort() { return useContext(StoreCatalogPortContext); }
