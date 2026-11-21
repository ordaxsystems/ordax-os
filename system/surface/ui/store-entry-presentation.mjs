// Presentation-only projection of the verified OS catalog. This module has
// no OS service imports so the behavior can be regression-tested standalone.
export const STORE_OPERATIONS = Object.freeze(["install", "update", "remove"]);

export function storeEntryVisualState(entry, pendingRequest = null) {
  const localRequest = pendingRequest?.appId === entry.appId
    && STORE_OPERATIONS.includes(pendingRequest.operation)
    && ["requesting", "accepted"].includes(pendingRequest.phase)
    ? pendingRequest : null;
  return Object.freeze({
    state: entry.state,
    updateAvailable: entry.state === "installed" && entry.updatable === true,
    blockedReason: entry.state === "blocked" ? entry.blockedReason : null,
    requestPhase: localRequest?.phase ?? null,
    requestOperation: localRequest?.operation ?? null,
  });
}

const STORE_OPENABLE_STATES = new Set(["installed", "failed-retained"]);

// This only exposes an Open intent for lifecycle states that retain a usable
// installed version. A blocked Store entry does not prove runtime launchability.
// The shared app-activation channel and the Surface catalog still revalidate
// the app before any window is launched; Store never becomes execution authority.
export function storeEntryOpenAvailable(entry) {
  return entry.installedVersion !== null && STORE_OPENABLE_STATES.has(entry.state);
}

/** Present empty results without inventing catalog health or duplicating translations.
 *  All message IDs come from the OS-owned Store catalog. */
export function storeEmptyPresentation(totalEntries, visibleEntries, view, query = "") {
  if (visibleEntries > 0) return null;
  if (totalEntries === 0) return Object.freeze({
    reason: "catalog-empty",
    titleId: "store.empty.filtered",
    descriptionId: "store.section.description.discover",
  });
  if (query.trim().length > 0) return Object.freeze({
    reason: "search-empty",
    titleId: "store.empty.filtered",
    descriptionId: "store.empty.filteredDescription",
  });
  return Object.freeze({
    reason: "section-empty",
    titleId: "store.section." + view,
    descriptionId: "store.section.description." + view,
  });
}

// Reuse this read-only ordering in Native and Web. Callers receive the same
// validated Store port snapshot and never infer installation from UI targets.
export function projectStoreCatalogPreview(snapshot, limit = 6) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
    throw new TypeError("Store preview limit must be bounded");
  }
  if (snapshot.state !== "ready") return Object.freeze({
    state: "unavailable", total: 0, entries: Object.freeze([]),
  });
  const sorted = [...snapshot.entries].sort((a, b) =>
    Number(b.installedVersion !== null) - Number(a.installedVersion !== null)
    || a.title.localeCompare(b.title, "pt-BR"));
  return Object.freeze({
    state: "ready", total: sorted.length,
    entries: Object.freeze(sorted.slice(0, limit)),
  });
}
