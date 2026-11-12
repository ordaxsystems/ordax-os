import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";

// A read-through safety gate, NOT another application registry. It compares
// the boot-verified semantic binding with the current signed-slot observation
// already held by the canonical Native Store projection.
export function createCurrentVerifiedActionGate({
  verifiedSemantics,
  getCurrentObservations,
} = {}) {
  if (!Array.isArray(verifiedSemantics) || verifiedSemantics.length > 32 ||
      typeof getCurrentObservations !== "function") {
    throw new TypeError("Current action gate requires bounded verified source and Native observations");
  }
  const origins = new Map();
  for (const entry of verifiedSemantics) {
    const appId = entry?.application?.id;
    const component = entry?.application?.component;
    const revision = entry?.revision;
    const sourceCommit = entry?.sourceCommit;
    if (typeof appId !== "string" || component?.id !== appId ||
        typeof component.version !== "string" ||
        !Number.isSafeInteger(revision) || revision < 0 ||
        typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/i.test(sourceCommit) ||
        origins.has(appId)) {
      throw new TypeError("Verified application action origin is not unique or valid");
    }
    // Only identity, never a copy of the declaration or its tool authority.
    origins.set(appId,Object.freeze({
      version:component.version,
      revision,sourceCommit:sourceCommit.toLowerCase(),
    }));
  }
  // A transient CURRENT read can be scoped to ONE synchronous Aura
  // request. No persisted cache, second Store, grant or executor: outside
  // this scope every verification reads the current Native Store again.
  let scopedObservations = null;
  const readVerifiedObservations = () => {
    const observed = getCurrentObservations();
    if (!Array.isArray(observed) || observed.length > 128) {
      throw new TypeError("Native Store current observations unavailable");
    }
    return Object.freeze(observed.map(item =>
      validateComponentRuntimeMetadata(item, {
        componentId: item?.componentId, state: "current",
      })));
  };
  const fingerprint = entries => JSON.stringify(
    entries.map(entry => JSON.stringify(entry)).sort(),
  );
  const withCurrentSnapshot = (callback) => {
    if (typeof callback !== "function") {
      throw new TypeError("Native Store CURRENT scope requires a callback");
    }
    if (scopedObservations !== null || origins.size === 0) return callback();
    const initial = readVerifiedObservations();
    scopedObservations = initial;
    try {
      // The entire Aura context is composed from ONE verified CURRENT
      // observation, but a synchronous Store subscriber may reenter and
      // withdraw an app while the context is being assembled. Read back
      // CURRENT before any inference is dispatched; never authorize using
      // a transient view that has already changed during composition.
      const composed = callback();
      if (fingerprint(readVerifiedObservations()) !== fingerprint(initial)) {
        throw new Error("Native Store CURRENT changed during Aura context composition");
      }
      // Only synchronous composition shares the view. An awaited response
      // and any later approval or revocation read the live Store again.
      return composed;
    } finally {
      scopedObservations = null;
    }
  };
  // A single CURRENT observation must decide an entire action list.
  // The Store remains the only source; this never grants execution.
  const isCurrentBatch = (actions) => {
    if (!Array.isArray(actions) || actions.length > 512) {
      throw new TypeError("Native Store current action selection exceeds bounds");
    }
    if (!actions.some(action => origins.has(action?.appId))) {
      return Object.freeze(actions.map(() => false));
    }
    const observed = scopedObservations ?? getCurrentObservations();
    if (!Array.isArray(observed) || observed.length > 128) {
      throw new TypeError("Native Store current observations unavailable");
    }
    // Validate the ENTIRE publication, not just the requested apps.
    const currentById = new Map();
    let duplicate = false;
    for (const item of observed) {
      const entry = validateComponentRuntimeMetadata(item, {
        componentId: item?.componentId, state: "current",
      });
      if (entry.state !== "current") {
        throw new TypeError("Native Store CURRENT state mismatch");
      }
      if (currentById.has(entry.componentId)) duplicate = true;
      currentById.set(entry.componentId, entry);
    }
    if (duplicate) return Object.freeze(actions.map(() => false));
    return Object.freeze(actions.map(action => {
      const origin = origins.get(action?.appId);
      const current = currentById.get(action?.appId);
      return Boolean(origin && current && current.source === "slot" &&
        current.version === origin.version &&
        current.revision === origin.revision &&
        current.sourceCommit.toLowerCase() === origin.sourceCommit);
    }));
  };
  return Object.freeze({
    isCurrent(action) {
      return isCurrentBatch([action])[0];
    },
    isCurrentBatch,
    withCurrentSnapshot,
  });
}
