import { assertAppStoreCatalogPort, createUnavailableAppStoreCatalogPort, validateAppStoreCatalogSnapshot } from '../../../../contracts/app-store.mjs';

export type StoreSnapshot = ReturnType<typeof validateAppStoreCatalogSnapshot>;
export type StoreEntry = StoreSnapshot['entries'][number];

/** React presentation cache for the existing authority-free port, not another catalog service. */
export function createStoreSnapshotSource(input: unknown) {
  const port = assertAppStoreCatalogPort(input);
  const unavailable = createUnavailableAppStoreCatalogPort('store-catalog-read-failed').getSnapshot();
  let snapshot: StoreSnapshot = unavailable;
  const read = (): StoreSnapshot => {
    try { snapshot = validateAppStoreCatalogSnapshot(port.getSnapshot()); }
    catch { snapshot = unavailable; }
    return snapshot;
  };
  read();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      let active = true;
      const release = port.subscribe(() => {
        if (!active) return;
        read();
        listener();
      });
      if (typeof release !== 'function') throw new TypeError('Store subscription must return cleanup');
      // Close the render/subscribe gap even when the port does not emit immediately.
      read();
      listener();
      return () => { active = false; release(); };
    },
  };
}
