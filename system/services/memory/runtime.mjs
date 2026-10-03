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
  MEMORY_STORE_SCHEMA,
  MAX_MEMORY_ITEMS,
  assertMemoryStore,
  validateMemorySnapshot,
} from "../../contracts/memory-store.mjs";
import {
  MAX_MEMORY_RECORD_CANDIDATES,
  MEMORY_RECORD_STORE_SCHEMA,
  assertMemoryRecordStore,
} from "../../contracts/memory-record-store.mjs";

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

function resolvePersistence(store) {
  if (store === null) return Object.freeze({ kind: "none", store: null });
  if (store?.schema === MEMORY_STORE_SCHEMA) {
    return Object.freeze({ kind: "snapshot", store: assertMemoryStore(store) });
  }
  if (store?.schema === MEMORY_RECORD_STORE_SCHEMA) {
    return Object.freeze({ kind: "record", store: assertMemoryRecordStore(store) });
  }
  throw new TypeError("A compatible memory store is required");
}

function rankCandidates(candidates, request) {
  if (!Array.isArray(candidates) || candidates.length > MAX_MEMORY_RECORD_CANDIDATES) {
    throw new Error("Memory record store returned an invalid candidate set");
  }
  const ranked = [];
  const identities = new Set();
  for (const item of candidates) {
    const identity = memoryIdentityKey(item);
    if (identities.has(identity)) throw new Error("Memory record store returned duplicate identities");
    identities.add(identity);
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
}

function recordQuery(request, storeScope, maxCandidates) {
  const scopes = storeScope === "device"
    ? request.scopes.filter((scope) => scope !== "session")
    : request.scopes;
  return Object.freeze({
    ownerKind: request.ownerKind,
    ownerId: request.ownerId,
    scopes: Object.freeze(scopes),
    spaceId: request.spaceId,
    projectId: request.projectId,
    includeRestricted: request.includeRestricted,
    query: request.query,
    maxCandidates,
  });
}

function recordCandidates(store, request, maxCandidates) {
  const query = recordQuery(request, store.scope, maxCandidates);
  if (query.scopes.length === 0) return [];
  const candidates = store.query(query);
  if (!Array.isArray(candidates) || candidates.length > maxCandidates) {
    throw new Error("Memory record store returned an invalid candidate set");
  }
  return candidates.map((candidate) => validateMemoryItem(candidate));
}

export function createMemoryRuntime({ store = null } = {}) {
  const persistence = resolvePersistence(store);
  const snapshotStore = persistence.kind === "snapshot" ? persistence.store : null;
  const recordStore = persistence.kind === "record" ? persistence.store : null;
  const loaded = snapshotStore?.load?.() ?? null;
  let items = loaded === null
    ? []
    : [...validateMemorySnapshot(loaded).items];
  let volatileItems = [];

  if (snapshotStore?.scope === "device" && items.some((item) => item.scope === "session")) {
    throw new Error("Device memory store must not persist session-scoped memory");
  }
  if (snapshotStore?.scope === "session" && items.some((item) => item.scope !== "session")) {
    throw new Error("Session-only memory store must contain only session-scoped memory");
  }

  const persistSnapshot = (nextItems) => {
    if (snapshotStore === null) return;
    const accepted = snapshotStore.save(snapshotForStore(nextItems, snapshotStore));
    if (accepted !== true) throw new Error("Memory store rejected the snapshot");
  };

  return Object.freeze({
    schema: MEMORY_PORT_SCHEMA,
    search(value) {
      const request = validateMemorySearchRequest(value);
      if (recordStore !== null) {
        const volatileCandidates = request.scopes.includes("session") ? volatileItems : [];
        const maxDurableCandidates = MAX_MEMORY_RECORD_CANDIDATES - volatileCandidates.length;
        const durableCandidates = recordCandidates(recordStore, request, maxDurableCandidates);
        return rankCandidates([...durableCandidates, ...volatileCandidates], request);
      }
      return rankCandidates(items, request);
    },
    remember(value) {
      const item = validateMemoryItem(value);
      const activeStore = recordStore ?? snapshotStore;
      assertItemCompatibleWithStore(item, activeStore);
      if (recordStore !== null) {
        if (recordStore.scope === "device" && item.scope === "session") {
          const identity = memoryIdentityKey(item);
          const nextItems = [...volatileItems];
          const existingIndex = nextItems.findIndex(
            (candidate) => memoryIdentityKey(candidate) === identity,
          );
          if (existingIndex >= 0) nextItems[existingIndex] = item;
          else {
            if (nextItems.length >= MAX_MEMORY_ITEMS) {
              throw new Error("Memory runtime session item limit reached");
            }
            nextItems.push(item);
          }
          volatileItems = nextItems;
          return item;
        }
        if (recordStore.put(item) !== true) throw new Error("Memory record store rejected the item");
        return item;
      }
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
      persistSnapshot(nextItems);
      items = nextItems;
      return item;
    },
    forget(value) {
      const request = validateMemoryForgetRequest(value);
      if (recordStore !== null) {
        const volatileIndex = volatileItems.findIndex(
          (item) => item.id === request.id && memoryOwnersEqual(item, request),
        );
        if (volatileIndex >= 0) {
          const nextItems = [...volatileItems];
          nextItems.splice(volatileIndex, 1);
          volatileItems = nextItems;
          return true;
        }
        const removed = recordStore.remove(request);
        if (typeof removed !== "boolean") throw new Error("Memory record store returned an invalid remove result");
        return removed;
      }
      const index = items.findIndex(
        (item) => item.id === request.id && memoryOwnersEqual(item, request),
      );
      if (index < 0) return false;
      const nextItems = [...items];
      nextItems.splice(index, 1);
      persistSnapshot(nextItems);
      items = nextItems;
      return true;
    },
    async flush() {
      const storePort = recordStore ?? snapshotStore;
      if (storePort === null) return true;
      const flushed = await storePort.flush();
      if (flushed !== true) throw new Error("Memory store did not confirm persistence flush");
      return true;
    },
    getPersistenceSnapshot() {
      const storePort = recordStore ?? snapshotStore;
      const scope = storePort?.scope ?? "session";
      return Object.freeze({
        scope,
        durable: scope === "device",
      });
    },
  });
}
