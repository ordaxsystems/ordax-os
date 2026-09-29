import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { ASSISTANT_CONVERSATION_SCHEMA } from "../conversation.mjs";

const EXTENSION_SELECTOR = '[data-app-extension="assistant-conversation"]';

function requireConversation(value) {
  if (!value || typeof value !== "object" || value.schema !== ASSISTANT_CONVERSATION_SCHEMA) {
    throw new TypeError("Compatible Assistant conversation runtime is required");
  }
  for (const method of ["getSnapshot", "subscribe", "send", "clear"]) {
    if (typeof value[method] !== "function") {
      throw new TypeError(`Assistant conversation runtime must implement ${method}()`);
    }
  }
  return value;
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountAssistantConversationControls(
  root,
  conversationValue,
  surfaceLifecycle,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Assistant controls require a Surface root Element");
  }
  const conversation = requireConversation(conversationValue);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const t = lifecycle.localization.translate;
  const documentObject = root.ownerDocument;
  let destroyed = false;
  let draft = "";
  let mountedSlot = null;

  const stateCopy = (state) => {
    if (state === "ready") return t("assistant.state.ready");
    if (state === "busy") return t("assistant.state.busy");
    if (state === "error") return t("assistant.state.error");
    return t("assistant.state.unavailable");
  };

  const render = (snapshot = conversation.getSnapshot()) => {
    if (destroyed) return;
    const slot = root.querySelector(EXTENSION_SELECTOR);
    if (!slot) {
      mountedSlot = null;
      return;
    }
    mountedSlot = slot;
    slot.replaceChildren();
    slot.classList.add("ordax-assistant-host");

    const header = node(documentObject, "header", "ordax-assistant-header");
    const copy = node(documentObject, "div");
    copy.append(
      node(documentObject, "span", "ordax-assistant-eyebrow", t("assistant.eyebrow")),
      node(documentObject, "h3", "ordax-assistant-title", t("assistant.title")),
      node(documentObject, "p", "ordax-assistant-description", t("assistant.description")),
    );
    const status = node(documentObject, "span", "ordax-assistant-status", stateCopy(snapshot.state));
    status.dataset.state = snapshot.state;
    header.append(copy, status);
    slot.append(header);

    const transcript = node(documentObject, "div", "ordax-assistant-transcript");
    transcript.setAttribute("role", "log");
    transcript.setAttribute("aria-live", "polite");
    transcript.setAttribute("aria-label", t("assistant.transcript.aria"));
    if (snapshot.messages.length === 0) {
      transcript.append(
        node(documentObject, "p", "ordax-assistant-empty", t("assistant.empty")),
      );
    } else {
      for (const message of snapshot.messages) {
        const article = node(
          documentObject,
          "article",
          `ordax-assistant-message ordax-assistant-message-${message.role}`,
        );
        article.dataset.assistantMessageId = message.id;
        article.append(
          node(
            documentObject,
            "strong",
            "ordax-assistant-message-role",
            message.role === "user" ? t("assistant.role.user") : t("assistant.role.assistant"),
          ),
          node(documentObject, "p", "ordax-assistant-message-text", message.text),
        );
        transcript.append(article);
      }
    }
    slot.append(transcript);

    if (snapshot.lastError) {
      const error = node(documentObject, "p", "ordax-assistant-error", t("assistant.error.response"));
      error.setAttribute("role", "alert");
      slot.append(error);
    }

    const form = node(documentObject, "div", "ordax-assistant-compose");
    const textarea = documentObject.createElement("textarea");
    textarea.maxLength = 32000;
    textarea.rows = 3;
    textarea.placeholder = t("assistant.input.placeholder");
    textarea.setAttribute("aria-label", t("assistant.input.aria"));
    textarea.dataset.assistantInput = "";
    textarea.value = draft;
    textarea.disabled = snapshot.state === "busy" || snapshot.state === "unavailable";
    form.append(textarea);

    const actions = node(documentObject, "div", "ordax-assistant-actions");
    const clear = node(documentObject, "button", "ordax-assistant-clear", t("assistant.action.clear"));
    clear.type = "button";
    clear.dataset.assistantClear = "";
    clear.disabled = snapshot.state === "busy" || snapshot.messages.length === 0;

    const send = node(
      documentObject,
      "button",
      "ordax-assistant-send",
      snapshot.state === "busy" ? t("assistant.action.sending") : t("assistant.action.send"),
    );
    send.type = "button";
    send.dataset.assistantSend = "";
    send.disabled = (
      snapshot.state === "busy"
      || snapshot.state === "unavailable"
      || draft.trim().length === 0
    );
    actions.append(clear, send);
    form.append(actions);
    slot.append(form);

    slot.append(
      node(documentObject, "p", "ordax-assistant-footnote", t("assistant.footnote")),
    );
  };

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    draft = "";
    render();
    void conversation.send(value).catch(() => {});
  };

  const onInput = (event) => {
    const target = event.target;
    if (target?.dataset?.assistantInput === undefined) return;
    draft = target.value;
    const button = mountedSlot?.querySelector("[data-assistant-send]");
    if (button) {
      const snapshot = conversation.getSnapshot();
      button.disabled = (
        snapshot.state === "busy"
        || snapshot.state === "unavailable"
        || draft.trim().length === 0
      );
    }
  };

  const onKeyDown = (event) => {
    const target = event.target;
    if (target?.dataset?.assistantInput === undefined) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const onClick = (event) => {
    const target = event.target?.closest?.("button");
    if (!target || !mountedSlot?.contains(target)) return;
    if (target.dataset.assistantSend !== undefined) {
      submit();
      return;
    }
    if (target.dataset.assistantClear !== undefined) {
      draft = "";
      conversation.clear();
    }
  };

  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", onClick);
  const unsubscribeConversation = conversation.subscribe(render);
  const unsubscribeRender = lifecycle.subscribeRender(() => render());

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeConversation();
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("click", onClick);
      if (mountedSlot) {
        mountedSlot.classList.remove("ordax-assistant-host");
        mountedSlot.replaceChildren();
      }
      mountedSlot = null;
    },
  });
}
