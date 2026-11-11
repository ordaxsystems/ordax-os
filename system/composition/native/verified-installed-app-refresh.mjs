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
    let releaseWithdrawal;
    let withdrawalFailed = false;
    const withdrawalPublished = new Promise((resolve) => { releaseWithdrawal = resolve; });
    // Register cleanup before notifying subscribers: a synchronous callback
    // may close the Surface or request another CURRENT refresh.
    sequence = sequence.catch(() => {}).then(async () => {
      await withdrawalPublished;
      await previous?.destroy();
      if (withdrawalFailed || destroyed || request !== generation) return;
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
      // The canonical Native mount may fail closed for one app without
      // throwing (missing trusted App Data, stale slot, incompatible module).
      // Keep other verified mounts visible, but do not cache this generation
      // as fully reconciled: a subsequent signed observation must retry it.
      if (!destroyed && request === generation
        && verified.installed.some(entry => !mountedIds.has(entry.component.id))) {
        onError?.(new Error("One or more verified CURRENT apps could not be mounted"));
      }
    }).catch((error) => {
      // Fail closed: the withdrawn catalog is left empty if refresh fails.
      if (!destroyed && request === generation) onError?.(error);
    });
    // Withdraw launch authority synchronously before any asynchronous read.
    // Even if publication fails, the already-registered cleanup must run.
    try {
      publish(createCatalog([]).catalog);
    } catch (error) {
      withdrawalFailed = true;
      onError?.(error);
    } finally {
      releaseWithdrawal();
    }
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

// Ephemeral observation identity only. The signed Native verifier and mount
// continue to own activation, launch rights and runtime bytes.
export function verifiedCurrentInstallationFingerprint(observations) {
  if (!Array.isArray(observations) || observations.some(item =>
    !item || typeof item.componentId !== "string")) {
    throw new TypeError("Verified CURRENT observations must have component identities");
  }
  // Only verified installed slots can own external launch/mount authority.
  // Absent/removed revisions may change without affecting any mounted app.
  return JSON.stringify(observations.filter(item => item.source === "slot")
    .map(item => [
      item.componentId, item.source, item.revision, item.version,
      item.sourceCommit, item.entrypoint,
    ]).sort((left, right) => left[0].localeCompare(right[0])));
}
