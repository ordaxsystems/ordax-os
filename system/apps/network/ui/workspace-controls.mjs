import { assertNetworkDraftPort, validateNetworkDraftSnapshot } from "../../../contracts/network-draft.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";

const WINDOW_SELECTOR = '[data-window-id="network"]';
const EXTENSION_SELECTOR = '[data-app-extension="network-workspace"]';

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function buildShell(documentObject, t) {
  const view = node(documentObject, "div", "ordax-network-view");
  view.dataset.ordaxNetworkView = "";

  const header = node(documentObject, "header", "ordax-network-header");
  header.append(
    node(documentObject, "span", "ordax-network-kicker", t("networkApp.kicker")),
    node(documentObject, "h2", "ordax-network-title", t("networkApp.title")),
    node(documentObject, "p", "ordax-network-intro", t("networkApp.intro")),
  );

  const sender = node(documentObject, "section", "ordax-network-card");
  sender.dataset.networkSenderCard = "";
  sender.append(
    node(documentObject, "span", "ordax-network-label", t("networkApp.sender.label")),
    node(documentObject, "strong", "", t("networkApp.sender.none")),
    node(documentObject, "p", "ordax-network-detail", t("networkApp.sender.select")),
  );
  sender.children[1].dataset.networkSenderTitle = "";
  sender.children[2].dataset.networkSenderDetail = "";
  const senderActions = node(documentObject, "div", "ordax-network-action-row");
  senderActions.dataset.networkSenderActions = "";
  sender.append(senderActions);

  const backend = node(documentObject, "section", "ordax-network-card");
  backend.dataset.networkBackend = "unavailable";
  backend.append(
    node(documentObject, "span", "ordax-network-label", t("networkApp.backend.title")),
    node(documentObject, "strong", "", t("networkApp.backend.unavailable")),
    node(documentObject, "p", "ordax-network-detail", t("networkApp.backend.detail")),
  );

  const grid = node(documentObject, "div", "ordax-network-grid");
  for (const [id, messageId] of [
    ["directory", "networkApp.section.directory"],
    ["communities", "networkApp.section.communities"],
    ["messages", "networkApp.section.messages"],
  ]) {
    const section = node(documentObject, "section", "ordax-network-section");
    section.dataset.networkSection = id;
    section.append(
      node(documentObject, "strong", "", t(messageId)),
      node(documentObject, "p", "ordax-network-note", t("networkApp.section.unavailable")),
    );
    grid.append(section);
  }

  const messages = node(documentObject, "section", "ordax-network-section");
  messages.dataset.networkComposer = "";
  messages.append(node(documentObject, "strong", "", t("networkApp.section.messages")));
  const composerBody = node(documentObject, "div", "ordax-network-compose");
  composerBody.dataset.networkComposerBody = "";
  messages.append(composerBody);

  view.append(header, sender, backend, grid, messages);
  return view;
}

function senderCopy(snapshot, t) {
  if (snapshot === null || snapshot.state === "signed-out" || snapshot.state === "unselected") {
    return {
      title: t("networkApp.sender.none"),
      detail: t("networkApp.sender.select"),
    };
  }
  if (snapshot.state === "ready") {
    return {
      title: t("networkApp.sender.active", { name: snapshot.currentSpace.name }),
      detail: t("networkApp.sender.select"),
    };
  }
  if (snapshot.state === "drafting") {
    return {
      title: t("networkApp.sender.draft", { name: snapshot.draft.senderSpaceName }),
      detail: t("networkApp.messages.sendUnavailable"),
    };
  }
  if (snapshot.state === "sender-mismatch") {
    return {
      title: t("networkApp.sender.draft", { name: snapshot.draft.senderSpaceName }),
      detail: t("networkApp.sender.mismatch", {
        current: snapshot.currentSpace.name,
        draft: snapshot.draft.senderSpaceName,
      }),
    };
  }
  return {
    title: t("networkApp.sender.draft", { name: snapshot.draft.senderSpaceName }),
    detail: t("networkApp.sender.paused", { draft: snapshot.draft.senderSpaceName }),
  };
}

export function mountNetworkWorkspaceControls(
  root,
  {
    surfaceLifecycle,
    draftPort = null,
  } = {},
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Network workspace requires a Surface root");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const draft = draftPort === null ? null : assertNetworkDraftPort(draftPort);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;

  let draftSnapshot = draft ? validateNetworkDraftSnapshot(draft.getSnapshot()) : null;
  let mountedSlot = null;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    const windowNode = root.querySelector(WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      mountedSlot = null;
      return;
    }

    const locale = localization.getLocale();
    if (
      !slot.dataset.ordaxNetworkMounted
      || slot.dataset.ordaxNetworkLocale !== locale
    ) {
      slot.replaceChildren(buildShell(documentObject, t));
      slot.dataset.ordaxNetworkMounted = "true";
      slot.dataset.ordaxNetworkLocale = locale;
    }
    mountedSlot = slot;

    const senderCard = slot.querySelector("[data-network-sender-card]");
    const senderTitle = slot.querySelector("[data-network-sender-title]");
    const senderDetail = slot.querySelector("[data-network-sender-detail]");
    const actions = slot.querySelector("[data-network-sender-actions]");
    const copy = senderCopy(draftSnapshot, t);
    senderTitle.textContent = copy.title;
    senderDetail.textContent = copy.detail;
    senderCard.dataset.state = draftSnapshot?.state ?? "unavailable";
    actions.replaceChildren();

    if (draftSnapshot?.state === "sender-mismatch") {
      const retarget = node(
        documentObject,
        "button",
        "ordax-network-action",
        t("networkApp.sender.retarget"),
      );
      retarget.type = "button";
      retarget.dataset.networkRetargetDraft = "";
      actions.append(retarget);
    }
    if (draftSnapshot?.draft) {
      const clear = node(
        documentObject,
        "button",
        "ordax-network-action",
        t("networkApp.sender.clear"),
      );
      clear.type = "button";
      clear.dataset.networkClearDraft = "";
      actions.append(clear);
    }

    const composer = slot.querySelector("[data-network-composer-body]");
    composer.replaceChildren();
    const target = lifecycle.getAppTarget("network");

    if (typeof target !== "string" || !target.trim()) {
      composer.append(
        node(
          documentObject,
          "p",
          "ordax-network-note",
          t("networkApp.messages.noConversation"),
        ),
      );
      return;
    }

    const label = node(documentObject, "label", "ordax-network-compose");
    label.append(node(documentObject, "span", "ordax-network-label", t("networkApp.messages.draftLabel")));
    const textarea = documentObject.createElement("textarea");
    textarea.maxLength = 4000;
    textarea.placeholder = t("networkApp.messages.placeholder");
    textarea.dataset.networkDraftBody = "";
    textarea.value = draftSnapshot?.draft?.conversationId === target
      ? draftSnapshot.draft.body
      : "";

    const canDraft = Boolean(
      draft
      && draftSnapshot
      && ["ready", "drafting"].includes(draftSnapshot.state)
      && (
        draftSnapshot.draft === null
        || draftSnapshot.draft.conversationId === target
      )
    );
    textarea.disabled = !canDraft;
    label.append(textarea);

    const noteId = draftSnapshot?.state === "sender-mismatch"
      ? "networkApp.messages.senderMismatch"
      : "networkApp.messages.sendUnavailable";
    label.append(node(documentObject, "p", "ordax-network-note", t(noteId)));

    const send = node(documentObject, "button", "ordax-network-action", t("networkApp.section.messages"));
    send.type = "button";
    send.disabled = true;
    send.dataset.networkSend = "";
    label.append(send);
    composer.append(label);
  };

  const onInput = (event) => {
    const textarea = event.target?.closest?.("[data-network-draft-body]");
    if (!textarea || !mountedSlot?.contains(textarea) || !draft) return;
    const target = lifecycle.getAppTarget("network");
    if (typeof target !== "string" || !target.trim()) return;

    try {
      if (draft.getSnapshot().draft === null) {
        draft.begin(target);
      }
      draft.setBody(textarea.value);
    } catch {
      render();
    }
  };

  const onClick = (event) => {
    const retarget = event.target?.closest?.("[data-network-retarget-draft]");
    if (retarget && mountedSlot?.contains(retarget) && draft) {
      draft.retargetToCurrentSpace();
      return;
    }
    const clear = event.target?.closest?.("[data-network-clear-draft]");
    if (clear && mountedSlot?.contains(clear) && draft) {
      draft.clear();
    }
  };

  const unsubscribeDraft = draft?.subscribe((snapshot) => {
    draftSnapshot = validateNetworkDraftSnapshot(snapshot);
    render();
  }) ?? null;
  const unsubscribeLocalization = localization.subscribe(() => render());
  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeLocalization();
      unsubscribeDraft?.();
      root.removeEventListener("input", onInput);
      root.removeEventListener("click", onClick);
      mountedSlot = null;
    },
  });
}
