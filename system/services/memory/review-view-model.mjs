import { MAX_MEMORY_SEARCH_RESULTS } from "../../contracts/memory.mjs";
import { assertMemoryReviewSession } from "./review-session.mjs";

export const MEMORY_REVIEW_VIEW_SCHEMA = "ordax.memory-review-view/1";
const DEFAULT_PAGE_SIZE = 16;
const MAX_PAGE_SIZE = MAX_MEMORY_SEARCH_RESULTS - 1;
const MAX_QUERY_CHARS = 1024;

function queryText(value) {
  if (value == null) return "";
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Memory review query must be text");
  }
  const normalized = value.trim();
  if (normalized.length > MAX_QUERY_CHARS) {
    throw new TypeError("Memory review query exceeds its allowed bound");
  }
  return normalized;
}

function pageSizeValue(value) {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new TypeError(`Memory review page size must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return value;
}

export function createMemoryReviewViewModel(reviewSessionValue, {
  pageSize: requestedPageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const review = assertMemoryReviewSession(reviewSessionValue);
  const pageSize = pageSizeValue(requestedPageSize);
  let query = "";
  let offset = 0;
  let items = Object.freeze([]);
  let canNext = false;
  let persistenceState = "idle";
  let persistenceError = null;
  let persistenceOrdinal = 0;
  let disposed = false;
  const listeners = new Set();

  const readPage = () => {
    const page = review.list({
      query,
      limit: pageSize + 1,
      offset,
    });
    items = Object.freeze(page.slice(0, pageSize));
    canNext = page.length > pageSize;
  };

  const snapshot = () => {
    const session = review.getSnapshot();
    return Object.freeze({
      schema: MEMORY_REVIEW_VIEW_SCHEMA,
      owners: session.owners,
      selectedOwner: session.selectedOwner,
      query,
      offset,
      pageSize,
      items,
      canPrevious: offset > 0,
      canNext,
      persistenceState,
      persistenceError,
    });
  };

  const publish = () => {
    if (disposed) return;
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  const refresh = ({ notify = true } = {}) => {
    if (disposed) throw new Error("Memory review view model is disposed");
    readPage();
    if (notify) publish();
    return snapshot();
  };

  const unsubscribeReview = review.subscribe(() => {
    if (disposed) return;
    // Invalidate any asynchronous completion that belongs to the previous
    // owner/session view. It must not publish saved/error into the new owner.
    persistenceOrdinal += 1;
    offset = 0;
    persistenceState = "idle";
    persistenceError = null;
    readPage();
    publish();
  });

  readPage();

  const persistMutation = async (mutate) => {
    if (disposed) throw new Error("Memory review view model is disposed");
    const result = mutate();
    if (result === null || result === false) {
      refresh();
      return result;
    }
    const ordinal = ++persistenceOrdinal;
    persistenceState = "pending";
    persistenceError = null;
    readPage();
    publish();
    try {
      await review.flush();
      if (ordinal === persistenceOrdinal && !disposed) {
        persistenceState = "saved";
        persistenceError = null;
        readPage();
        publish();
      }
      return result;
    } catch {
      if (ordinal === persistenceOrdinal && !disposed) {
        persistenceState = "error";
        persistenceError = "persistence-failed";
        readPage();
        publish();
      }
      throw new Error("Memory review persistence failed");
    }
  };

  return Object.freeze({
    schema: MEMORY_REVIEW_VIEW_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Memory review view listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setQuery(value) {
      if (disposed) throw new Error("Memory review view model is disposed");
      query = queryText(value);
      offset = 0;
      return refresh();
    },
    selectOwner(owner) {
      if (disposed) throw new Error("Memory review view model is disposed");
      review.selectOwner(owner);
      return snapshot();
    },
    nextPage() {
      if (disposed) throw new Error("Memory review view model is disposed");
      if (!canNext) return snapshot();
      offset += pageSize;
      return refresh();
    },
    previousPage() {
      if (disposed) throw new Error("Memory review view model is disposed");
      if (offset === 0) return snapshot();
      offset = Math.max(0, offset - pageSize);
      return refresh();
    },
    refresh() {
      return refresh();
    },
    exportSnapshot() {
      if (disposed) throw new Error("Memory review view model is disposed");
      return review.exportSnapshot();
    },
    async create(content, options = {}) {
      return persistMutation(() => review.create(content, options));
    },
    async update(id, patch = {}) {
      return persistMutation(() => review.update(id, patch));
    },
    async remove(id) {
      return persistMutation(() => review.remove(id));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      persistenceOrdinal += 1;
      unsubscribeReview();
      listeners.clear();
    },
  });
}
