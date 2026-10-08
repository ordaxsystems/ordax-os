import {
  assertAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";
import {
  APP_LIFECYCLE_REQUEST_SCHEMA,
  assertAppLifecycleRequestPort,
  validateAppLifecycleRequest,
  validateAppLifecycleRequestResultForRequest,
} from "../../contracts/app-lifecycle-request.mjs";

// This orchestrates authority-free Store REQUESTS, not installations.
// Real download, verification, activation, health and rollback belong solely
// to the platform's existing app lifecycle and its Native delegate.
export const STORE_UPDATE_BATCH_SCHEMA = "ordax.store-update-request-batch/1";
const MAX_REQUEST_IDENTITIES = 4096;

function eligible(entry) {
  return entry.state === "installed"
    && entry.installedVersion !== null
    && entry.availableVersion !== null
    && entry.updatable === true
    && entry.artifactIdentityVerified === true
    && entry.provenanceVerified === true;
}

function result(state, outcomes, intendedCount) {
  const acceptedRequests = outcomes.filter((entry) => entry.state === "accepted").length;
  const rejectedRequests = outcomes.filter((entry) => entry.state === "rejected").length;
  const skippedRequests = outcomes.filter((entry) => entry.state === "skipped").length;
  return Object.freeze({
    schema: STORE_UPDATE_BATCH_SCHEMA,
    authority: "none",
    state,
    intendedCount,
    acceptedRequests,
    rejectedRequests,
    skippedRequests,
    // "accepted" is only an acknowledgement of a lifecycle request, NEVER
    // proof that an app was installed, promoted, healthy or updated.
    outcomes: Object.freeze(outcomes.map((entry) => Object.freeze(entry))),
  });
}

function receipt(item, state, requestId, reason) {
  return {
    appId: item.appId,
    fromVersion: item.installedVersion,
    toVersion: item.availableVersion,
    state,
    requestId,
    reason,
  };
}

export function createStoreUpdateRequestBatch({
  catalogPort,
  lifecycleRequestPort,
  requestIdFactory,
} = {}) {
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const lifecycle = assertAppLifecycleRequestPort(lifecycleRequestPort);
  if (typeof requestIdFactory !== "function") {
    throw new TypeError("Secure Store requestIdFactory is required for batch updates");
  }

  let current = null;
  // A request accepted by the lifecycle is not a completed update. Keep a
  // bounded per-app acknowledgment until the Store projection changes, so
  // repeated "Update all" clicks do not spam the same accepted candidate.
  const acknowledged = new Map();
  // Never allow a previous lifecycle decision to be replayed as a response
  // to a subsequent batch, even when an injected ID factory malfunctions.
  // Fail closed at a bounded cardinality instead of evicting identities.
  const usedRequestIds = new Set();

  const submitAvailableUpdates = () => {
    // Rapid double-clicks must reuse the same in-flight batch and not issue
    // duplicate lifecycle requests.
    if (current !== null) return current.promise;
    const initial = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
    if (initial.state !== "ready") {
      return Promise.resolve(result("catalog-unavailable", [], 0));
    }

    const candidates = initial.entries.filter(eligible);
    for (const [appId, versions] of acknowledged) {
      const entry = candidates.find((candidate) => candidate.appId === appId);
      if (
        !entry
        || entry.installedVersion !== versions.installedVersion
        || entry.availableVersion !== versions.availableVersion
      ) acknowledged.delete(appId);
    }
    const plan = candidates.filter((entry) => !acknowledged.has(entry.appId)).map((entry) => ({
      appId: entry.appId,
      installedVersion: entry.installedVersion,
      availableVersion: entry.availableVersion,
    }));
    if (plan.length === 0) {
      return Promise.resolve(result(
        candidates.length === 0 ? "no-updates" : "requests-already-accepted", [], 0,
      ));
    }

    const session = { cancelled: false };
    const promise = Promise.resolve().then(async () => {
      const outcomes = [];
      let stopReason = null;

      for (const item of plan) {
        if (session.cancelled || stopReason !== null) {
          outcomes.push(receipt(item, "skipped", null, stopReason ?? "batch-cancelled"));
          continue;
        }

        // Re-read the one canonical projection for EVERY app. A revoked,
        // downgraded, replaced or no-longer-eligible entry cannot be replayed
        // from the snapshot used when "update all" was clicked.
        let snapshot;
        try {
          snapshot = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
        } catch {
          stopReason = "catalog-invalidated";
          outcomes.push(receipt(item, "skipped", null, stopReason));
          continue;
        }
        if (snapshot.state !== "ready") {
          stopReason = "catalog-unavailable";
          outcomes.push(receipt(item, "skipped", null, stopReason));
          continue;
        }
        const currentEntry = snapshot.entries.find((entry) => entry.appId === item.appId);
        if (
          !currentEntry
          || !eligible(currentEntry)
          || currentEntry.installedVersion !== item.installedVersion
          || currentEntry.availableVersion !== item.availableVersion
        ) {
          outcomes.push(receipt(item, "skipped", null, "candidate-changed"));
          continue;
        }

        let request;
        try {
          request = validateAppLifecycleRequest({
            schema: APP_LIFECYCLE_REQUEST_SCHEMA,
            requestId: requestIdFactory(item.appId),
            appId: item.appId,
            operation: "update",
            source: "store",
            authority: "none",
          });
          if (
            usedRequestIds.has(request.requestId)
            || usedRequestIds.size >= MAX_REQUEST_IDENTITIES
          ) {
            throw new TypeError("Replayed or exhausted lifecycle request identity");
          }
          usedRequestIds.add(request.requestId);
        } catch {
          // No time-based or counter-only fallback IDs. If secure identity
          // generation fails, stop the remaining queue fail-closed.
          stopReason = "request-id-unavailable";
          outcomes.push(receipt(item, "skipped", null, stopReason));
          continue;
        }

        try {
          const raw = await lifecycle.requestLifecycle(request);
          const reply = validateAppLifecycleRequestResultForRequest(raw, request);
          if (reply.state === "accepted") {
            acknowledged.set(item.appId, {
              installedVersion: item.installedVersion,
              availableVersion: item.availableVersion,
            });
          }
          outcomes.push(receipt(
            item, reply.state, request.requestId,
            reply.state === "rejected" ? reply.reason : null,
          ));
        } catch {
          outcomes.push(receipt(item, "rejected", request.requestId, "lifecycle-request-unavailable"));
        }
      }
      return result(session.cancelled ? "cancelled" : "requests-processed", outcomes, plan.length);
    });
    current = { promise, session };
    // Do not create an unhandled rejection through finally() on a detached
    // promise. The public caller receives the original promise.
    void promise.then(
      () => { if (current?.session === session) current = null; },
      () => { if (current?.session === session) current = null; },
    );
    return promise;
  };

  const cancelPending = () => {
    if (current === null) return false;
    current.session.cancelled = true;
    // An already delegated update cannot be undone by this UI-only cancel.
    return true;
  };

  return Object.freeze({
    authority: "none",
    submitAvailableUpdates,
    cancelPending,
  });
}
