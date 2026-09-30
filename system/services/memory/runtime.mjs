import {
  MEMORY_PORT_SCHEMA,
  memoryIdentityKey,
  memoryOwnersEqual,
  validateMemoryForgetRequest,
  validateMemoryItem,
  validateMemorySearchRequest,
} from "../../contracts/memory.mjs";
import {
  MEMORY_SNAPSHOT_SCHEMA,
  MAX_MEMORY_ITEMS,
  assertMemoryStore,
  validateMemorySnapshot,
} from "../../contracts/memory-store.mjs";

function normalizedSearchText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function lexicalScore(item, query) {
  if (!query) return 0;
  const needle = normalizedSearchText(query);
  const haystack = normalizedSearchText([
    item.content,
    item.provenance,
    item.kind,
  ].join("\n"));
  let score = haystack.includes(needle) ? 100 : 0;
  const tokens = needle.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (haystack.includes(token)) score += 10;
  }
  return score;
}

function isAuthorizedForSearch(item, request) {
  if (!memoryOwnersEqual(item, request) || !request.scopes.includes(item.scope)) {
    return false;
  }
  if (item.sensitivity === "restricted" && !request.includeRestricted) {
    return false;
  }
  if (item.scope === "space") {
    return request.spaceId !== null && item.spaceId === request.spaceId;
  }
  if (item.scope === "project") {
    if (request.projectId === null || item.projectId !== request.projectId) return false;
    if (item.spaceId !== null) {
      return request.spaceId !== null && item.spaceId === request.spaceId;
    }
  }
  return true;
}

function snapshotForStore(items, store) {
  const persisted = store.scope === "device"
    ? items.filter((item) => item.scope !== "session")
    : items;
  return validateMemorySnapshot({
    $schema: MEMORY_SNAPSHOT_SCHEMA,
    items: persisted,
  });
}

function assertItemCompatibleWithStore(item, store) {
  if (store?.scope === "session" && item.scope !== "session") {
    throw new Error("Session-only memory store cannot accept durable memory scopes");
  }
}

export function createMemoryRuntime({ store = null } = {}) {
  const persistence = store === null ? null : assertMemoryStore(store);
  const loaded = persistence?.load?.() ?? null;
  let items = loaded === null
    ? []
    : [...validateMemorySnapshot(loaded).items];

  if (persistence?.scope === "device" && items.some((item) => item.scope === "session")) {
    throw new Error("Device memory store must not persist session-scoped memory");
  }
  if (persistence?.scope === "session" && items.some((item) => item.scope !== "session")) {
    throw new Error("Session-only memory store must contain only session-scoped memory");
  }

  const persist = (nextItems) => {
    if (persistence === null) return;
    const accepted = persistence.save(snapshotForStore(nextItems, persistence));
    if (accepted !== true) {
      throw new Error("Memory store rejected the snapshot");
    }
  };

  return Object.freeze({
    schema: MEMORY_PORT_SCHEMA,
    search(value) {
      const request = validateMemorySearchRequest(value);
      const ranked = [];
      for (const item of items) {
        if (!isAuthorizedForSearch(item, request)) continue;
        const score = lexicalScore(item, request.query);
        if (request.query && score === 0) continue;
        ranked.push({ item, score });
      }
      ranked.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const timestamp = right.item.sourceTimestamp.localeCompare(left.item.sourceTimestamp);
        if (timestamp !== 0) return timestamp;
        return left.item.id.localeCompare(right.item.id);
      });
      const end = request.offset + request.limit;
      return Object.freeze(ranked.slice(request.offset, end).map(({ item }) => item));
    },
    remember(value) {
      const item = validateMemoryItem(value);
      assertItemCompatibleWithStore(item, persistence);
      const identity = memoryIdentityKey(item);
      const nextItems = [...items];
      const existingIndex = nextItems.findIndex(
        (candidate) => memoryIdentityKey(candidate) === identity,
      );
      if (existingIndex >= 0) {
        nextItems[existingIndex] = item;
      } else {
        if (nextItems.length >= MAX_MEMORY_ITEMS) {
          throw new Error("Memory runtime item limit reached");
        }
        nextItems.push(item);
      }
      persist(nextItems);
      items = nextItems;
      return item;
    },
    forget(value) {
      const request = validateMemoryForgetRequest(value);
      const index = items.findIndex(
        (item) => item.id === request.id && memoryOwnersEqual(item, request),
      );
      if (index < 0) return false;
      const nextItems = [...items];
      nextItems.splice(index, 1);
      persist(nextItems);
      items = nextItems;
      return true;
    },
    async flush() {
      if (persistence === null) return true;
      const flushed = await persistence.flush();
      if (flushed !== true) {
        throw new Error("Memory store did not confirm persistence flush");
      }
      return true;
    },
    getPersistenceSnapshot() {
      const scope = persistence?.scope ?? "session";
      return Object.freeze({
        scope,
        durable: scope === "device",
      });
    },
  });
}
