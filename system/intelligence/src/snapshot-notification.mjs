// Advisory runtime observers must never control inference state or suppress
// notifications to other subscribers. Snapshot validation happens at owner.
export function notifySnapshotListeners(listeners, snapshot) {
  // A fixed iteration avoids invoking subscribers added during notification.
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue;
    try {
      listener(snapshot);
    } catch {
      // Observer exceptions belong to the consumer, not to the runtime
      // transition. In particular, a thrown busy notification must not leave
      // the inference port permanently busy or disrupt other observers.
    }
  }
}
