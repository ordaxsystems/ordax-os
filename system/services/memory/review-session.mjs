import { assertIdentitySessionPort } from "../../contracts/identity-session.mjs";
import {
  assertMemoryPort,
  memoryOwnersEqual,
  validateMemoryOwner,
} from "../../contracts/memory.mjs";
import { createMemoryReviewRuntime } from "./review.mjs";
import {
  DEVICE_MEMORY_OWNER,
  memoryOwnersForIdentityPort,
} from "./owners.mjs";

export const MEMORY_REVIEW_SESSION_SCHEMA = "ordax.memory-review-session/1";

function ownerKey(owner) {
  return owner.ownerKind === "device" ? "device" : `account:${owner.ownerId}`;
}

function freezeOwners(owners) {
  return Object.freeze(owners.map((owner) => Object.freeze({
    ownerKind: owner.ownerKind,
    ownerId: owner.ownerId,
    key: ownerKey(owner),
  })));
}

export function assertMemoryReviewSession(session) {
  if (
    !session
    || typeof session !== "object"
    || session.schema !== MEMORY_REVIEW_SESSION_SCHEMA
  ) {
    throw new TypeError("Compatible memory review session is required");
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "selectOwner",
    "create",
    "list",
    "exportSnapshot",
    "update",
    "remove",
    "clearAll",
    "flush",
    "dispose",
  ]) {
    if (typeof session[method] !== "function") {
      throw new TypeError(`Memory review session must implement ${method}()`);
    }
  }
  return session;
}

export function createMemoryReviewSession({
  memoryPort,
  identitySessionPort = null,
  spaceId = null,
  projectId = null,
  now = () => new Date(),
  idFactory = undefined,
  mutationPort = null,
} = {}) {
  const memory = assertMemoryPort(memoryPort);
  const identity = identitySessionPort === null
    ? null
    : assertIdentitySessionPort(identitySessionPort);
  if (typeof now !== "function") {
    throw new TypeError("Memory review session requires a clock function");
  }

  let availableOwners = identity === null
    ? [DEVICE_MEMORY_OWNER]
    : [...memoryOwnersForIdentityPort(identity)];
  let selectedOwner = DEVICE_MEMORY_OWNER;
  let disposed = false;
  const listeners = new Set();

  const snapshot = () => Object.freeze({
    schema: MEMORY_REVIEW_SESSION_SCHEMA,
    owners: freezeOwners(availableOwners),
    selectedOwner: Object.freeze({
      ownerKind: selectedOwner.ownerKind,
      ownerId: selectedOwner.ownerId,
      key: ownerKey(selectedOwner),
    }),
  });

  const publish = () => {
    if (disposed) return;
    const current = snapshot();
    for (const listener of [...listeners]) listener(current);
  };

  const refreshOwners = () => {
    const nextOwners = identity === null
      ? [DEVICE_MEMORY_OWNER]
      : [...memoryOwnersForIdentityPort(identity)];
    availableOwners = nextOwners;
    if (!availableOwners.some((owner) => memoryOwnersEqual(owner, selectedOwner))) {
      selectedOwner = DEVICE_MEMORY_OWNER;
    }
    publish();
  };

  const unsubscribeIdentity = identity === null
    ? () => {}
    : identity.subscribe(refreshOwners);

  const review = () => createMemoryReviewRuntime(memory, {
    ownerKind: selectedOwner.ownerKind,
    ownerId: selectedOwner.ownerId,
    spaceId,
    projectId,
    now,
    mutationPort,
    ...(idFactory === undefined ? {} : { idFactory }),
  });

  return Object.freeze({
    schema: MEMORY_REVIEW_SESSION_SCHEMA,
    getSnapshot() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Memory review session listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectOwner(ownerValue) {
      if (disposed) throw new Error("Memory review session is disposed");
      const owner = validateMemoryOwner(ownerValue, "Memory review selected owner");
      const match = availableOwners.find((candidate) => memoryOwnersEqual(candidate, owner));
      if (!match) {
        throw new Error("Memory review owner is not available in the current identity session");
      }
      const changed = !memoryOwnersEqual(match, selectedOwner);
      selectedOwner = match;
      if (changed) publish();
      return snapshot();
    },
    async create(content, options = {}) {
      if (disposed) throw new Error("Memory review session is disposed");
      return review().create(content, options);
    },
    list(options = {}) {
      if (disposed) throw new Error("Memory review session is disposed");
      return review().list(options);
    },
    exportSnapshot() {
      if (disposed) throw new Error("Memory review session is disposed");
      return review().exportSnapshot();
    },
    async update(id, patch = {}) {
      if (disposed) throw new Error("Memory review session is disposed");
      return review().update(id, patch);
    },
    async remove(id) {
      if (disposed) throw new Error("Memory review session is disposed");
      return review().remove(id);
    },
    async clearAll() {
      if (disposed) throw new Error("Memory review session is disposed");
      return review().clearAll();
    },
    async flush() {
      if (disposed) throw new Error("Memory review session is disposed");
      return memory.flush();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeIdentity();
      listeners.clear();
    },
  });
}
