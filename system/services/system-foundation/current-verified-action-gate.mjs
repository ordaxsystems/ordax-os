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
  return Object.freeze({
    isCurrent(action) {
      const appId = action?.appId;
      const origin = origins.get(appId);
      if (!origin) return false;
      const observed = getCurrentObservations();
      if (!Array.isArray(observed) || observed.length > 128) {
        throw new TypeError("Native Store current observations unavailable");
      }
      // CURRENT is one atomic Store publication. A matching app must not
      // remain visible if ANY peer in that publication is malformed or
      // duplicated, even before the next Store change event reaches the
      // semantic refresh coordinator. This is a transient validation pass,
      // never another persisted app catalog or source of authority.
      const ids = new Set();
      let current = null;
      for (const item of observed) {
        const entry = validateComponentRuntimeMetadata(item, {
          componentId: item?.componentId, state: "current",
        });
        if (entry.state !== "current") throw new TypeError("Native Store CURRENT state mismatch");
        if (ids.has(entry.componentId)) return false;
        ids.add(entry.componentId);
        if (entry.componentId === appId) current = entry;
      }
      if (current === null) return false;
      return current.source === "slot" &&
        current.version === origin.version &&
        current.revision === origin.revision &&
        current.sourceCommit.toLowerCase() === origin.sourceCommit;
    },
  });
}
