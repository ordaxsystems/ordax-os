// Common event delivery for the two existing Native signed Store readers.
// This is NOT a catalog, authority or lifecycle journal: it only keeps
// notification callbacks from blocking or overtaking a newer publication.
export function createStoreObserverDelivery(listeners, diagnostic) {
  if (!(listeners instanceof Set) || typeof diagnostic !== "string" ||
      diagnostic.length === 0) {
    throw new TypeError("Store observer delivery requires listeners and a diagnostic");
  }
  let emission = 0;
  return (published) => {
    const current = ++emission;
    for (const listener of [...listeners]) {
      // If a callback synchronously publishes a newer revocation, stop
      // delivering this superseded snapshot to the remaining subscribers.
      if (current !== emission) break;
      if (!listeners.has(listener)) continue;
      try {
        listener(published);
      } catch {
        // A UI callback is not a signature verifier. Keep remaining owners
        // notified and avoid exposing untrusted application/user error text.
        console.warn(diagnostic);
      }
    }
  };
}
