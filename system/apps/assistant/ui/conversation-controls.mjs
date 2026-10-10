import { INTELLIGENCE_MAX_PROMPT_CHARS } from "../../../contracts/intelligence.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { ASSISTANT_CONVERSATION_SCHEMA } from "../conversation.mjs";
import { projectAssistantResultCanvas } from "./result-view-model.mjs";

const EXTENSION_SELECTOR = '[data-app-extension="assistant-conversation"]';

function requireConversation(value) {
  if (!value || typeof value !== "object" || value.schema !== ASSISTANT_CONVERSATION_SCHEMA) {
    throw new TypeError("Compatible Assistant conversation runtime is required");
  }
  for (const method of ["getSnapshot", "subscribe", "send", "discardPendingResponse", "clear"]) {
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

export function canSubmitAssistantDraft(snapshot, draft) {
  if (!snapshot || typeof snapshot !== "object" || typeof draft !== "string") {
    return false;
  }
  const normalized = draft.trim();
  return (
    snapshot.state === "ready"
    && normalized.length > 0
    && normalized.length <= INTELLIGENCE_MAX_PROMPT_CHARS
  );
}

export function beginAssistantSubmission(conversation, draft) {
  const value = typeof draft === "string" ? draft.trim() : "";
  const before = conversation.getSnapshot();
  if (!canSubmitAssistantDraft(before, value)) {
    return Object.freeze({ accepted: false, pending: null });
  }

  const pending = conversation.send(value);
  const accepted = conversation.getSnapshot().state === "busy";
  return Object.freeze({ accepted, pending });
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
    // This snapshot comes from the *existing* scoped conversation runtime.
    // No model-generated progress, HTML, actions or data sources are promoted.
    const view = projectAssistantResultCanvas(snapshot);
    mountedSlot = slot;
    slot.replaceChildren();
    slot.classList.add("ordax-assistant-host");
    slot.dataset.assistantCanvasState = view.state;

    const header = node(documentObject, "header", "ordax-assistant-header");
    const heading = node(documentObject, "div", "ordax-assistant-heading");
    const emblem = node(documentObject, "span", "ordax-assistant-emblem", "✦");
    emblem.setAttribute("aria-hidden", "true");
    heading.append(emblem, node(documentObject, "h3", "ordax-assistant-title", t("assistant.title")));
    const status = node(documentObject, "span", "ordax-assistant-status", stateCopy(snapshot.state));
    status.dataset.state = snapshot.state;
    header.append(heading, status);
    slot.append(header);

    const canvas = node(documentObject, "section", "ordax-assistant-canvas");
    canvas.dataset.assistantCanvas = view.state;
    canvas.setAttribute("role", "region");
    canvas.setAttribute("aria-label", t("assistant.canvas.aria"));
    if (view.state === "idle") {
      canvas.append(node(documentObject, "p", "ordax-assistant-empty", t("assistant.empty")));
    } else if (view.state === "result") {
      const lastPrompt = [...view.history].reverse().find((item) => item.role === "user");
      if (lastPrompt) {
        canvas.append(node(documentObject, "p", "ordax-assistant-query", lastPrompt.text));
      }
      for (const block of view.blocks) {
        if (block.kind !== "text") continue;
        const article = node(documentObject, "article", "ordax-assistant-result-text");
        article.dataset.assistantResultMessageId = view.resultMessageId;
        article.append(
          node(documentObject, "span", "ordax-assistant-result-label", t("assistant.canvas.response")),
          // textContent only; even apparent Markdown, HTML and URLs are untrusted text.
          node(documentObject, "p", "ordax-assistant-result-body", block.text),
          node(documentObject, "p", "ordax-assistant-result-provenance",
            `${t("assistant.provider.local")} · ${block.provenance.engineId} / ${block.provenance.modelId}`),
        );
        canvas.append(article);
      }
    } else if (view.state === "working") {
      const progress = node(documentObject, "p", "ordax-assistant-pending", t("assistant.canvas.working"));
      progress.setAttribute("role", "status");
      canvas.append(progress);
    } else if (view.state === "unavailable") {
      canvas.append(node(documentObject, "p", "ordax-assistant-unavailable",
        t("assistant.canvas.unavailable")));
    }
    // Failed/discarded requests have no fabricated result; the existing
    // conversation error notice below explains what happened.
    if (canvas.childElementCount > 0) slot.append(canvas);

    if (snapshot.lastError || view.state === "failed") {
      const discarded = snapshot.lastError === "response-discarded";
      const notice = node(documentObject, "p",
        discarded ? "ordax-assistant-notice" : "ordax-assistant-error",
        t(discarded ? "assistant.notice.discarded" : "assistant.error.response"));
      notice.setAttribute("role", discarded ? "status" : "alert");
      slot.append(notice);
    }

    const form = node(documentObject, "div", "ordax-assistant-compose");
    const textarea = documentObject.createElement("textarea");
    textarea.maxLength = INTELLIGENCE_MAX_PROMPT_CHARS;
    textarea.rows = view.state === "idle" ? 2 : 3;
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
    clear.disabled = snapshot.state === "busy" || view.history.length === 0;
    const send = node(documentObject, "button", "ordax-assistant-send",
      snapshot.state === "busy" ? t("assistant.action.sending") : t("assistant.action.send"));
    send.type = "button";
    send.dataset.assistantSend = "";
    send.disabled = !canSubmitAssistantDraft(snapshot, draft);
    actions.append(clear, send);
    if (snapshot.inferencePending) {
      const discard = node(documentObject, "button", "ordax-assistant-discard",
        t(snapshot.discardRequested ? "assistant.action.discard.pending" : "assistant.action.discard"));
      discard.type = "button";
      discard.dataset.assistantDiscard = "";
      discard.disabled = !snapshot.canDiscardPending;
      actions.append(discard);
    }
    form.append(actions);
    slot.append(form);

    const provider = snapshot.providerCapabilities;
    const providerLabel = provider?.provider === "local"
      ? `${t("assistant.provider.local")} · ${provider.engineId} / ${provider.modelId}`
      : t("assistant.provider.unavailable");
    slot.append(node(documentObject, "p", "ordax-assistant-provider", providerLabel));

    if (view.history.length > 0) {
      const details = node(documentObject, "details", "ordax-assistant-history");
      const summary = node(documentObject, "summary", "", t("assistant.history.title"));
      const transcript = node(documentObject, "div", "ordax-assistant-transcript");
      transcript.setAttribute("role", "log");
      transcript.setAttribute("aria-label", t("assistant.transcript.aria"));
      for (const message of view.history) {
        const entry = node(documentObject, "article",
          `ordax-assistant-message ordax-assistant-message-${message.role}`);
        entry.dataset.assistantMessageId = message.id;
        entry.append(
          node(documentObject, "strong", "ordax-assistant-message-role",
            t(message.role === "user" ? "assistant.role.user" : "assistant.role.assistant")),
          node(documentObject, "p", "ordax-assistant-message-text", message.text),
        );
        transcript.append(entry);
      }
      details.append(summary, transcript);
      slot.append(details);
    }
    slot.append(node(documentObject, "p", "ordax-assistant-footnote", t("assistant.footnote")));
  };

  const submit = () => {
    const submission = beginAssistantSubmission(conversation, draft);
    if (submission.pending === null) return;
    if (submission.accepted) {
      draft = "";
      render();
    }
    void submission.pending.catch(() => render());
  };

  const onInput = (event) => {
    const target = event.target;
    if (target?.dataset?.assistantInput === undefined) return;
    draft = target.value;
    const button = mountedSlot?.querySelector("[data-assistant-send]");
    if (button) {
      button.disabled = !canSubmitAssistantDraft(conversation.getSnapshot(), draft);
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
      return;
    }
    if (target.dataset.assistantDiscard !== undefined) {
      conversation.discardPendingResponse();
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
