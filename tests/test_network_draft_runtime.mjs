import assert from "node:assert/strict";
import test from "node:test";

import { SPACE_SELECTION_SCHEMA } from "../system/contracts/space-selection.mjs";
import {
  NETWORK_DRAFT_SCHEMA,
  createNetworkDraftRuntime,
} from "../system/apps/network/draft-runtime.mjs";
import { componentRuntime } from "../system/apps/network/runtime.mjs";

function selectionPort(seed) {
  let snapshot = seed;
  const listeners = new Set();
  return {
    schema: SPACE_SELECTION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    select() {},
    clear() {},
    set(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

const space = (id, name) => ({
  id,
  name,
  kind: "professional",
  state: "active",
  ownerId: "owner-0001",
  profilePack: null,
});

const selected = (id, name = id) => ({
  schema: SPACE_SELECTION_SCHEMA,
  state: "selected",
  subjectId: "subject-0001",
  selectedSpace: space(id, name),
});

test("draft binds the sender Space when text begins", () => {
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({ spaceSelection: selection, readOnline: () => true });
  const snapshot = draft.setBody("Mensagem");
  assert.equal(snapshot.schema, NETWORK_DRAFT_SCHEMA);
  assert.equal(snapshot.senderSpaceId, "space-a");
  assert.equal(snapshot.activeSpaceId, "space-a");
  assert.equal(snapshot.state, "backend-unavailable");
  assert.equal(snapshot.canSend, false);
});

test("changing Space never silently retargets a pending draft", () => {
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({ spaceSelection: selection, readOnline: () => true });
  draft.setBody("Mensagem importante");

  selection.set(selected("space-b"));
  const snapshot = draft.getSnapshot();
  assert.equal(snapshot.senderSpaceId, "space-a");
  assert.equal(snapshot.activeSpaceId, "space-b");
  assert.equal(snapshot.state, "sender-changed");
  assert.equal(snapshot.canSend, false);
});

test("sender rebinding is explicit", () => {
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({ spaceSelection: selection, readOnline: () => true });
  draft.setBody("Mensagem importante");
  selection.set(selected("space-b"));

  const rebound = draft.rebindToActiveSpace();
  assert.equal(rebound.senderSpaceId, "space-b");
  assert.equal(rebound.body, "Mensagem importante");
  assert.equal(rebound.state, "backend-unavailable");
});

test("offline state is honest and blocks transport", async () => {
  let online = false;
  let sends = 0;
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({
    spaceSelection: selection,
    readOnline: () => online,
    transport: { async sendMessage() { sends += 1; return { ok: true }; } },
  });
  draft.setBody("Mensagem");

  assert.equal(draft.getSnapshot().state, "offline");
  await assert.rejects(() => draft.send({ conversationId: "conversation-1", idempotencyKey: "client-key-00000001" }));
  assert.equal(sends, 0);

  online = true;
  draft.refreshConnectivity();
  assert.equal(draft.getSnapshot().state, "ready");
  assert.equal(draft.getSnapshot().canSend, true);
});

test("successful send uses the bound Space and clears the draft", async () => {
  const calls = [];
  const selection = selectionPort(selected("space-a"));
  const draft = createNetworkDraftRuntime({
    spaceSelection: selection,
    readOnline: () => true,
    transport: { async sendMessage(input) { calls.push(input); return { outcome: "applied" }; } },
  });
  draft.setBody("Mensagem");

  const result = await draft.send({
    conversationId: "conversation-1",
    idempotencyKey: "client-key-00000001",
  });

  assert.equal(result.outcome, "applied");
  assert.deepEqual(calls, [{
    spaceId: "space-a",
    conversationId: "conversation-1",
    idempotencyKey: "client-key-00000001",
    body: "Mensagem",
  }]);
  assert.equal(draft.getSnapshot().body, "");
  assert.equal(draft.getSnapshot().senderSpaceId, null);
});

test("component runtime mounts Surface lifecycle, owns styles, and cleans up", async () => {
  const previousElement = globalThis.Element;
  const previousTextAreaElement = globalThis.HTMLTextAreaElement;

  class FakeElement {
    constructor(tagName = "div", ownerDocument = null) {
      this.tagName = tagName.toUpperCase();
      this.ownerDocument = ownerDocument;
      this.parentNode = null;
      this.children = [];
      this.dataset = {};
      this.className = "";
      this.textContent = "";
      this.value = "";
      this.disabled = false;
      this.href = "";
      this.rel = "";
      this.listeners = new Map();
    }

    append(...children) {
      for (const child of children) {
        if (child && typeof child === "object") child.parentNode = this;
        this.children.push(child);
        if (this.tagName === "HEAD" && child?.tagName === "LINK") {
          for (const listener of child.listeners.get("load") ?? []) listener();
        }
      }
    }

    replaceChildren(...children) {
      for (const child of this.children) {
        if (child && typeof child === "object") child.parentNode = null;
      }
      this.children = [];
      this.append(...children);
    }

    querySelector() {
      return null;
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
    }

    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    }
  }

  class FakeTextAreaElement extends FakeElement {}

  class FakeDocument {
    constructor() {
      this.activeElement = null;
      this.head = new FakeElement("head", this);
    }

    createElement(tagName) {
      return tagName === "textarea"
        ? new FakeTextAreaElement(tagName, this)
        : new FakeElement(tagName, this);
    }

    querySelector(selector) {
      if (selector !== 'link[data-ordax-component-style="network"]') return null;
      return this.head.children.find(
        (child) => child?.dataset?.ordaxComponentStyle === "network",
      ) ?? null;
    }
  }

  globalThis.Element = FakeElement;
  globalThis.HTMLTextAreaElement = FakeTextAreaElement;

  try {
    const documentObject = new FakeDocument();
    const slot = new FakeElement("section", documentObject);
    const root = new FakeElement("main", documentObject);
    root.querySelector = () => slot;

    const mounted = await componentRuntime.mount({
      root,
      spaceSelection: selectionPort(selected("space-a")),
      surfaceLifecycle: {
        localization: {
          translate(messageId) {
            return messageId;
          },
        },
      },
      networkTransport: null,
      readOnline: () => true,
    });

    const style = documentObject.querySelector('link[data-ordax-component-style="network"]');
    assert.ok(style);
    assert.match(style.href, /network\.css$/);
    assert.equal(mounted.drafts.getSnapshot().state, "backend-unavailable");
    assert.equal(slot.children.length, 1);

    mounted.destroy();
    assert.equal(slot.children.length, 0);
    assert.equal(
      documentObject.querySelector('link[data-ordax-component-style="network"]'),
      null,
    );
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;

    if (previousTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = previousTextAreaElement;
  }
});
