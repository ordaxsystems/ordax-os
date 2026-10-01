const NETWORK_WINDOW_SELECTOR = '[data-window-id="network"]';
const NETWORK_EXTENSION_SELECTOR = '[data-app-extension="network-workspace"]';

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stateCopy(snapshot, t) {
  switch (snapshot.state) {
    case "selection-unavailable":
      return t("network.app.state.selectionUnavailable");
    case "space-required":
      return t("network.app.state.spaceRequired");
    case "sender-changed":
      return t("network.app.state.senderChanged");
    case "offline":
      return t("network.app.state.offline");
    case "backend-unavailable":
      return t("network.app.state.backendUnavailable");
    default:
      return t("network.app.state.ready");
  }
}

export function mountNetworkWorkspaceControls(
  root,
  draftRuntime,
  { surfaceLifecycle = null, onError = null } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Network workspace requires a Surface root Element");
  }
  if (!draftRuntime || typeof draftRuntime.getSnapshot !== "function") {
    throw new TypeError("Network workspace requires a draft runtime");
  }

  const documentObject = root.ownerDocument;
  const t = surfaceLifecycle?.localization?.translate ?? ((messageId) => messageId);
  let destroyed = false;
  let slot = null;

  const findSlot = () =>
    root.querySelector(`${NETWORK_WINDOW_SELECTOR} ${NETWORK_EXTENSION_SELECTOR}`);

  const render = () => {
    if (destroyed) return;
    const nextSlot = findSlot();
    if (!nextSlot) return;
    slot = nextSlot;

    const previousInput = slot.querySelector("[data-network-draft-body]");
    const restoreComposerFocus = previousInput === documentObject.activeElement;
    const restoreStart = restoreComposerFocus ? previousInput.selectionStart : null;
    const restoreEnd = restoreComposerFocus ? previousInput.selectionEnd : null;

    const snapshot = draftRuntime.getSnapshot();
    const view = node(documentObject, "div", "ordax-network-workspace");

    const header = node(documentObject, "header", "ordax-network-workspace-header");
    header.append(
      node(documentObject, "span", "ordax-network-kicker", t("network.app.kicker")),
      node(documentObject, "h3", "ordax-network-title", t("network.app.title")),
      node(
        documentObject,
        "p",
        "ordax-network-subtitle",
        t("network.app.subtitle"),
      ),
    );

    const sender = node(documentObject, "section", "ordax-network-sender");
    sender.append(
      node(documentObject, "span", "ordax-network-label", t("network.app.sender")),
      node(
        documentObject,
        "strong",
        "ordax-network-sender-value",
        snapshot.senderSpaceId ?? snapshot.activeSpaceId ?? t("network.app.noSpace"),
      ),
    );
    if (snapshot.senderSpaceId && snapshot.senderSpaceId !== snapshot.activeSpaceId) {
      sender.append(
        node(
          documentObject,
          "small",
          "ordax-network-warning",
          t("network.app.activeSpace", { space: snapshot.activeSpaceId ?? t("network.app.activeSpace.none") }),
        ),
      );
    }

    const composer = node(documentObject, "section", "ordax-network-composer");
    const textarea = documentObject.createElement("textarea");
    textarea.rows = 6;
    textarea.maxLength = 4000;
    textarea.value = snapshot.body;
    textarea.placeholder = t("network.app.placeholder");
    textarea.dataset.networkDraftBody = "";
    textarea.disabled = snapshot.activeSpaceId === null && snapshot.senderSpaceId === null;

    const status = node(
      documentObject,
      "p",
      "ordax-network-status",
      stateCopy(snapshot, t),
    );
    status.dataset.state = snapshot.state;

    const actions = node(documentObject, "div", "ordax-network-actions");
    const send = node(documentObject, "button", "ordax-network-action-primary", t("network.app.action.send"));
    send.type = "button";
    send.dataset.networkSend = "";
    send.disabled = !snapshot.canSend;

    const discard = node(documentObject, "button", "ordax-network-action", t("network.app.action.discard"));
    discard.type = "button";
    discard.dataset.networkDiscard = "";
    discard.disabled = !snapshot.body;

    actions.append(send, discard);

    if (snapshot.state === "sender-changed") {
      const rebind = node(
        documentObject,
        "button",
        "ordax-network-action",
        t("network.app.action.rebind"),
      );
      rebind.type = "button";
      rebind.dataset.networkRebind = "";
      actions.append(rebind);
    }

    composer.append(textarea, status, actions);
    view.append(header, sender, composer);
    slot.replaceChildren(view);

    if (restoreComposerFocus) {
      textarea.focus({ preventScroll: true });
      if (restoreStart !== null && restoreEnd !== null) {
        textarea.setSelectionRange(
          Math.min(restoreStart, textarea.value.length),
          Math.min(restoreEnd, textarea.value.length),
        );
      }
    }
  };

  const onInput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-network-draft-body]")) {
      return;
    }
    try {
      draftRuntime.setBody(target.value);
    } catch (error) {
      onError?.(error);
    }
  };

  const onClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    try {
      if (target.closest("[data-network-discard]")) {
        draftRuntime.discard();
      } else if (target.closest("[data-network-rebind]")) {
        draftRuntime.rebindToActiveSpace();
      }
    } catch (error) {
      onError?.(error);
    }
  };

  root.addEventListener("input", onInput);
  root.addEventListener("click", onClick);
  const unsubscribe = draftRuntime.subscribe(render);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      root.removeEventListener("input", onInput);
      root.removeEventListener("click", onClick);
      if (slot) slot.replaceChildren();
    },
  });
}
