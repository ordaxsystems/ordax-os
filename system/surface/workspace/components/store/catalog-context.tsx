import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { createUnavailableAppStoreCatalogPort } from '../../../../contracts/app-store.mjs';
import { createStoreSnapshotSource, type StoreSnapshot } from '../../lib/store/official';

const fallback = createUnavailableAppStoreCatalogPort('web-store-transport-unavailable');
const StoreCatalogContext = createContext<StoreSnapshot>(fallback.getSnapshot());

export function StoreCatalogProvider({ port, children }: { port: unknown; children: ReactNode }) {
  const source = useMemo(() => createStoreSnapshotSource(port), [port]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return <StoreCatalogContext.Provider value={snapshot}>{children}</StoreCatalogContext.Provider>;
}

export function useStoreCatalog() { return useContext(StoreCatalogContext); }
