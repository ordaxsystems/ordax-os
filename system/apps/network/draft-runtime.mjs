import {
  SPACE_SELECTION_SCHEMA,
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertNetworkMessagePlainText } from "../../contracts/network-message-content-v1.mjs";

export const NETWORK_DRAFT_SCHEMA = "ordax.network-draft/1";

function selectedSpaceId(snapshot) {
  return snapshot.state === "selected" ? snapshot.selectedSpace.id : null;
}

function snapshotState({ selection, body, senderSpaceId, transportAvailable, online }) {
  const activeSpaceId = selectedSpaceId(selection);
  let state = "ready";

  if (selection.state === "unavailable") state = "selection-unavailable";
  else if (selection.state === "unselected") state = "space-required";
  else if (body && senderSpaceId !== activeSpaceId) state = "sender-changed";
  else if (!online) state = "offline";
  else if (!transportAvailable) state = "backend-unavailable";

  return Object.freeze({
    schema: NETWORK_DRAFT_SCHEMA,
    state,
    body,
    senderSpaceId,
    activeSpaceId,
    canSend: Boolean(
      body
      && senderSpaceId
      && senderSpaceId === activeSpaceId
      && online
      && transportAvailable
    ),
  });
}

export function createNetworkDraftRuntime({
  spaceSelection,
  transport = null,
  readOnline = () => true,
} = {}) {
  const selectionPort = assertSpaceSelectionPort(spaceSelection);
  if (transport !== null && (typeof transport !== "object" || typeof transport.sendMessage !== "function")) {
    throw new TypeError("Network draft transport must implement sendMessage()");
  }
  if (typeof readOnline !== "function") {
    throw new TypeError("Network draft readOnline must be a function");
  }

  let selection = validateSpaceSelectionSnapshot(selectionPort.getSnapshot());
  let body = "";
  let senderSpaceId = null;
  let disposed = false;
  const listeners = new Set();

  const current = () => snapshotState({
    selection,
    body,
    senderSpaceId,
    transportAvailable: transport !== null,
    online: readOnline() === true,
  });

  const publish = () => {
    const value = current();
    if (!disposed) {
      for (const listener of [...listeners]) listener(value);
    }
    return value;
  };

  const unsubscribeSelection = selectionPort.subscribe((next) => {
    selection = validateSpaceSelectionSnapshot(next);
    publish();
  });

  return Object.freeze({
    schema: NETWORK_DRAFT_SCHEMA,
    getSnapshot() {
      return current();
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Network draft listener must be a function");
      }
      if (disposed) return () => {};
      listeners.add(listener);
      listener(current());
      return () => listeners.delete(listener);
    },
    setBody(value) {
      if (disposed) throw new Error("Network draft runtime is disposed");
      if (typeof value !== "string") throw new TypeError("Network draft body must be text");
      const normalized = value.length === 0 ? "" : assertNetworkMessagePlainText(value);
      if (normalized && senderSpaceId === null) {
        const active = selectedSpaceId(selection);
        if (active === null) throw new Error("A selected Space is required before drafting");
        senderSpaceId = active;
      }
      body = normalized;
      if (!body) senderSpaceId = null;
      return publish();
    },
    discard() {
      if (disposed) return current();
      body = "";
      senderSpaceId = null;
      return publish();
    },
    rebindToActiveSpace() {
      if (disposed) throw new Error("Network draft runtime is disposed");
      const active = selectedSpaceId(selection);
      if (active === null) throw new Error("A selected Space is required");
      if (!body) {
        senderSpaceId = null;
      } else {
        senderSpaceId = active;
      }
      return publish();
    },
    async send({ conversationId, idempotencyKey } = {}) {
      if (disposed) throw new Error("Network draft runtime is disposed");
      const before = current();
      if (!before.body) throw new Error("Network draft is empty");
      if (before.senderSpaceId !== before.activeSpaceId) {
        throw new Error("Network draft sender Space changed");
      }
      if (!readOnline()) throw new Error("Network is offline");
      if (transport === null) throw new Error("Network backend is unavailable");

      const result = await transport.sendMessage({
        spaceId: before.senderSpaceId,
        conversationId,
        idempotencyKey,
        body: before.body,
      });
      body = "";
      senderSpaceId = null;
      publish();
      return result;
    },
    refreshConnectivity() {
      return publish();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSelection();
      listeners.clear();
      body = "";
      senderSpaceId = null;
    },
  });
}
