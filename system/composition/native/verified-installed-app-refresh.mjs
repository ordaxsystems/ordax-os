// Native CURRENT remains the only installation authority. The Store subscription
// is a notification, never a substitute for re-reading the verified slot.
export function createNativeVerifiedInstalledAppRefresh({
  initialMounts = null,
  discover, createCatalog, mount, publish, onError = null,
} = {}) {
  if (typeof discover !== "function" || typeof createCatalog !== "function"
    || typeof mount !== "function" || typeof publish !== "function"
    || (onError !== null && typeof onError !== "function")) {
    throw new TypeError("Native installed app refresh requires trusted functions");
  }

  let destroyed = false;
  let generation = 0;
  let activeMounts = initialMounts;
  let sequence = Promise.resolve();

  function refresh() {
    if (destroyed) return sequence;
    const request = ++generation;
    const previous = activeMounts;
    activeMounts = null;
    // Remove stale launch authority synchronously, before any network read.
    try {
      publish(createCatalog([]).catalog);
    } catch (error) {
      // A failed catalog withdrawal must still stop the old executable.
      sequence = sequence.catch(() => {}).then(() => previous?.destroy());
      onError?.(error);
      return sequence;
    }
    sequence = sequence.catch(() => {}).then(async () => {
      await previous?.destroy();
      if (destroyed || request !== generation) return;
      const entries = await discover();
      if (destroyed || request !== generation) return;
      const verified = createCatalog(entries);
      const mounted = await mount(verified.installed);
      if (destroyed || request !== generation) {
        await mounted?.destroy();
        return;
      }
      const mountedIds = new Set(mounted?.mountedIds ?? []);
      const activeEntries = entries.filter((entry) => mountedIds.has(entry.component.id));
      let nextCatalog;
      try {
        nextCatalog = createCatalog(activeEntries).catalog;
      } catch (error) {
        await mounted?.destroy();
        throw error;
      }
      if (destroyed || request !== generation) {
        await mounted?.destroy();
        return;
      }
      // Publish may synchronously invoke a Store/Surface listener that
      // starts a new refresh. Publish the owning mount before notifying it.
      activeMounts = mounted;
      try {
        publish(nextCatalog);
      } catch (error) {
        // A reentrant refresh may have already claimed destruction ownership.
        if (activeMounts === mounted) {
          activeMounts = null;
          await mounted?.destroy();
        }
        throw error;
      }
    }).catch((error) => {
      // Fail closed: the withdrawn catalog is left empty if refresh fails.
      if (!destroyed && request === generation) onError?.(error);
    });
    return sequence;
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    const current = activeMounts;
    activeMounts = null;
    await sequence.catch(() => {});
    await current?.destroy();
  }

  return Object.freeze({ refresh, destroy });
}
