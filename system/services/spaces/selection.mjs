import {
  SPACE_SELECTION_RECORD_SCHEMA,
  SPACE_SELECTION_SCHEMA,
  assertSpaceSelectionStore,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpacesPort,
  validateSpacesSnapshot,
} from "../../contracts/spaces.mjs";

function unavailable() {
  return validateSpaceSelectionSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
}

function unselected(subjectId) {
  return validateSpaceSelectionSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unselected",
    subjectId,
    selectedSpace: null,
  });
}

function selected(subjectId, space) {
  return validateSpaceSelectionSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "selected",
    subjectId,
    selectedSpace: space,
  });
}

function fingerprint(snapshot) {
  return JSON.stringify(snapshot);
}

export function createSpaceSelectionRuntime({
  identitySession,
  spaces,
  store,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const spacesPort = assertSpacesPort(spaces);
  const selectionStore = assertSpaceSelectionStore(store);

  let identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
  let spacesSnapshot = validateSpacesSnapshot(spacesPort.getSnapshot());
  let catalogSubjectId = (
    identitySnapshot.state === "signed-in" && spacesSnapshot.state === "ready"
      ? identitySnapshot.subjectId
      : null
  );
  let current = unavailable();
  let currentFingerprint = fingerprint(current);
  let disposed = false;
  const listeners = new Set();

  const publish = (next) => {
    const validated = validateSpaceSelectionSnapshot(next);
    const nextFingerprint = fingerprint(validated);
    current = validated;
    if (nextFingerprint === currentFingerprint) return current;
    currentFingerprint = nextFingerprint;
    if (!disposed) {
      for (const listener of [...listeners]) listener(current);
    }
    return current;
  };

  const reconcile = () => {
    if (identitySnapshot.state !== "signed-in") {
      if (identitySnapshot.state === "signed-out") selectionStore.clear();
      return publish(unavailable());
    }
    if (
      spacesSnapshot.state !== "ready"
      || catalogSubjectId !== identitySnapshot.subjectId
    ) {
      return publish(unavailable());
    }

    const record = selectionStore.load();
    if (record === null) {
      return publish(unselected(identitySnapshot.subjectId));
    }
    if (record.subjectId !== identitySnapshot.subjectId) {
      selectionStore.clear();
      return publish(unselected(identitySnapshot.subjectId));
    }

    const space = spacesSnapshot.spaces.find((candidate) => candidate.id === record.selectedSpaceId);
    if (!space || space.state !== "active") {
      selectionStore.clear();
      return publish(unselected(identitySnapshot.subjectId));
    }
    return publish(selected(identitySnapshot.subjectId, space));
  };

  const unsubscribeIdentity = identity.subscribe((snapshot) => {
    const previousSubjectId = (
      identitySnapshot.state === "signed-in" ? identitySnapshot.subjectId : null
    );
    identitySnapshot = validateIdentitySessionSnapshot(snapshot);
    const nextSubjectId = (
      identitySnapshot.state === "signed-in" ? identitySnapshot.subjectId : null
    );
    if (previousSubjectId !== nextSubjectId) {
      catalogSubjectId = null;
    }
    reconcile();
  });
  const unsubscribeSpaces = spacesPort.subscribe((snapshot) => {
    spacesSnapshot = validateSpacesSnapshot(snapshot);
    catalogSubjectId = (
      identitySnapshot.state === "signed-in" && spacesSnapshot.state === "ready"
        ? identitySnapshot.subjectId
        : null
    );
    reconcile();
  });
  reconcile();

  return Object.freeze({
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Space selection listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    select(spaceId) {
      if (disposed) throw new Error("Space selection runtime is disposed");
      if (identitySnapshot.state !== "signed-in" || spacesSnapshot.state !== "ready") {
        throw new Error("Space selection is unavailable");
      }
      if (typeof spaceId !== "string" || !spaceId.trim() || spaceId.length > 160 || spaceId.includes("\0")) {
        throw new TypeError("Selected Space id is invalid");
      }
      const normalized = spaceId.trim();
      const space = spacesSnapshot.spaces.find((candidate) => candidate.id === normalized);
      if (!space || space.state !== "active") {
        throw new Error("Selected Space is not available to the current account");
      }
      selectionStore.save({
        schema: SPACE_SELECTION_RECORD_SCHEMA,
        subjectId: identitySnapshot.subjectId,
        selectedSpaceId: space.id,
      });
      return reconcile();
    },
    clear() {
      if (disposed) return current;
      selectionStore.clear();
      return reconcile();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeIdentity();
      unsubscribeSpaces();
      listeners.clear();
      current = unavailable();
      currentFingerprint = fingerprint(current);
    },
  });
}
