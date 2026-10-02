import {
  NETWORK_DRAFT_SCHEMA,
  assertNetworkDraftPort,
  validateNetworkDraftSnapshot,
} from "../../contracts/network-draft.mjs";
import {
  assertIdentitySessionPort,
  validateIdentitySessionSnapshot,
} from "../../contracts/identity-session.mjs";
import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertNetworkMessagePlainText } from "../../contracts/network-message-content-v1.mjs";

function selectedSpace(selectionSnapshot, subjectId) {
  if (
    selectionSnapshot.state !== "selected"
    || selectionSnapshot.subjectId !== subjectId
  ) {
    return null;
  }
  return Object.freeze({
    id: selectionSnapshot.selectedSpace.id,
    name: selectionSnapshot.selectedSpace.name,
  });
}

function boundedConversationId(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Network conversation id must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new TypeError("Network conversation id is outside bounds");
  }
  return normalized;
}

function snapshotFor(identitySnapshot, selectionSnapshot, draft) {
  if (identitySnapshot.state !== "signed-in") {
    return validateNetworkDraftSnapshot({
      schema: NETWORK_DRAFT_SCHEMA,
      state: "signed-out",
      subjectId: null,
      currentSpace: null,
      draft: null,
    });
  }

  const subjectId = identitySnapshot.subjectId;
  const currentSpace = selectedSpace(selectionSnapshot, subjectId);

  if (draft === null) {
    return validateNetworkDraftSnapshot({
      schema: NETWORK_DRAFT_SCHEMA,
      state: currentSpace === null ? "unselected" : "ready",
      subjectId,
      currentSpace,
      draft: null,
    });
  }

  if (currentSpace === null) {
    return validateNetworkDraftSnapshot({
      schema: NETWORK_DRAFT_SCHEMA,
      state: "paused",
      subjectId,
      currentSpace: null,
      draft,
    });
  }

  return validateNetworkDraftSnapshot({
    schema: NETWORK_DRAFT_SCHEMA,
    state: draft.senderSpaceId === currentSpace.id ? "drafting" : "sender-mismatch",
    subjectId,
    currentSpace,
    draft,
  });
}

export function createNetworkDraftRuntime({
  identitySession,
  spaceSelection,
} = {}) {
  const identity = assertIdentitySessionPort(identitySession);
  const selection = assertSpaceSelectionPort(spaceSelection);

  let identitySnapshot = validateIdentitySessionSnapshot(identity.getSnapshot());
  let selectionSnapshot = validateSpaceSelectionSnapshot(selection.getSnapshot());
  let draft = null;
  let draftRevision = 0;
  let current = snapshotFor(identitySnapshot, selectionSnapshot, draft);
  let disposed = false;
  const listeners = new Set();

  const advanceDraftRevision = () => {
    if (draftRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Network draft revision space is exhausted");
    }
    draftRevision += 1;
    return draftRevision;
  };

  const publish = () => {
    current = snapshotFor(identitySnapshot, selectionSnapshot, draft);
    if (!disposed) {
      for (const listener of [...listeners]) listener(current);
    }
    return current;
  };

  const currentSelectedSpace = () => {
    if (identitySnapshot.state !== "signed-in") return null;
    return selectedSpace(selectionSnapshot, identitySnapshot.subjectId);
  };

  const unsubscribeIdentity = identity.subscribe((value) => {
    const previousSubject = identitySnapshot.state === "signed-in"
      ? identitySnapshot.subjectId
      : null;
    identitySnapshot = validateIdentitySessionSnapshot(value);
    const nextSubject = identitySnapshot.state === "signed-in"
      ? identitySnapshot.subjectId
      : null;

    if (previousSubject !== nextSubject) {
      if (draft !== null) advanceDraftRevision();
      draft = null;
    }
    publish();
  });

  const unsubscribeSelection = selection.subscribe((value) => {
    selectionSnapshot = validateSpaceSelectionSnapshot(value);
    publish();
  });

  const port = {
    schema: NETWORK_DRAFT_SCHEMA,
    getSnapshot() {
      return current;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Network draft listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    begin(conversationId) {
      if (disposed) throw new Error("Network draft runtime is disposed");
      if (identitySnapshot.state !== "signed-in") {
        throw new Error("Network drafting requires a signed-in account");
      }
      const space = currentSelectedSpace();
      if (space === null) {
        throw new Error("Network drafting requires an explicitly selected Space");
      }
      const normalizedConversationId = boundedConversationId(conversationId);
      if (
        draft !== null
        && (
          draft.conversationId !== normalizedConversationId
          || draft.subjectId !== identitySnapshot.subjectId
        )
      ) {
        throw new Error("Clear the current Network draft before changing conversation");
      }
      if (draft === null) {
        advanceDraftRevision();
        draft = Object.freeze({
          subjectId: identitySnapshot.subjectId,
          senderSpaceId: space.id,
          senderSpaceName: space.name,
          conversationId: normalizedConversationId,
          body: "",
        });
      }
      return publish();
    },
    setBody(body) {
      if (disposed) throw new Error("Network draft runtime is disposed");
      if (draft === null) {
        throw new Error("Begin a Network draft before setting its body");
      }
      if (typeof body !== "string" || body.length > 4000) {
        throw new TypeError("Network draft body is outside bounds");
      }
      if (body.length > 0) {
        assertNetworkMessagePlainText(body);
      }
      advanceDraftRevision();
      draft = Object.freeze({ ...draft, body });
      return publish();
    },
    retargetToCurrentSpace() {
      if (disposed) throw new Error("Network draft runtime is disposed");
      if (draft === null || identitySnapshot.state !== "signed-in") {
        throw new Error("No Network draft is available to retarget");
      }
      const space = currentSelectedSpace();
      if (space === null) {
        throw new Error("Select an active Space before retargeting the draft");
      }
      if (draft.subjectId !== identitySnapshot.subjectId) {
        throw new Error("Network drafts cannot cross account identity");
      }
      advanceDraftRevision();
      draft = Object.freeze({
        ...draft,
        senderSpaceId: space.id,
        senderSpaceName: space.name,
      });
      return publish();
    },
    bindSend() {
      if (disposed) throw new Error("Network draft runtime is disposed");
      if (draft === null || current.state !== "drafting") {
        throw new Error("Network draft sender context is not ready to send");
      }
      const body = assertNetworkMessagePlainText(draft.body);
      if (!body.trim()) {
        throw new TypeError("Network message body cannot be blank");
      }
      return Object.freeze({
        revision: draftRevision,
        subjectId: draft.subjectId,
        senderSpaceId: draft.senderSpaceId,
        conversationId: draft.conversationId,
        body,
      });
    },
    clear(expectedRevision = null) {
      if (disposed) return current;
      if (expectedRevision !== null) {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
          throw new TypeError("Network draft expected revision is invalid");
        }
        if (draft === null || draftRevision !== expectedRevision) {
          return current;
        }
      }
      if (draft === null) return current;
      advanceDraftRevision();
      draft = null;
      return publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeIdentity();
      unsubscribeSelection();
      listeners.clear();
      draft = null;
    },
  };

  assertNetworkDraftPort(port);
  return Object.freeze(port);
}
