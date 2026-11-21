// The Sync runtime reports transport and pending work, not a verified identity.
// Only the authoritative identity session may establish a signed-out state.
// This is strictly presentation: no service calls or persisted session data.
export function projectHomeSyncStatus(snapshot, sourceState, identity, translate, locale) {
  if (typeof translate !== "function") throw new TypeError("Home Sync requires localization");
  const message = (id, state) => Object.freeze({text:translate(id),state});
  if (sourceState !== "ready" || !snapshot) {
    return message(sourceState === "loading"
      ? "home.status.loading" : "home.status.unavailable",sourceState);
  }
  // A pending device queue remains relevant even during a session transition;
  // do not suppress queued work just because its remote transport is offline.
  if (snapshot.pendingMutationCount > 0) {
    const count = new Intl.NumberFormat(locale).format(snapshot.pendingMutationCount);
    const noun = translate(snapshot.pendingMutationCount === 1
      ? "home.status.sync.pendingOne" : "home.status.sync.pendingMany");
    return Object.freeze({text:count+" "+noun,state:"pending"});
  }
  if (identity?.state === "signed-out") {
    return message("home.status.account.signedOut","neutral");
  }
  if (identity?.state !== "signed-in") {
    return message("home.status.unavailable","unavailable");
  }
  if (snapshot.transport === "host-required") {
    return message("home.status.sync.waiting","neutral");
  }
  if (snapshot.accountContinuity === "active" && snapshot.transport === "available") {
    return message("home.status.sync.current","success");
  }
  // No active continuity is not an identity logout, and absence of pending
  // work does not establish that synchronization is operational.
  return message("home.status.unavailable","unavailable");
}
