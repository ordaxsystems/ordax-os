import { INTELLIGENCE_MAX_PROMPT_CHARS } from "../../../contracts/intelligence.mjs";
import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { ASSISTANT_CONVERSATION_SCHEMA } from "../conversation.mjs";
import { projectAssistantResultCanvas } from "./result-view-model.mjs";
import { projectAssistantWorkStrip } from "./work-strip.mjs";

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
  { personalOrdax = null, identitySessionPort = null, spaceSelectionPort = null } = {},
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

  const workCards = () => {
    if (!personalOrdax || !identitySessionPort || !spaceSelectionPort) return { cards: [], remainingCount: 0 };
    try {
      // Read the current owners together on *every* render, including after
      // owner/Space change. Never retain a work snapshot across contexts.
      return projectAssistantWorkStrip(
        personalOrdax.getSnapshot(),
        identitySessionPort.getSnapshot(),
        spaceSelectionPort.getSnapshot(),
      );
    } catch {
      return { cards: [], remainingCount: 0 }; // Authorization/schemas fail closed.
    }
  };

  const stateCopy = (state) => {
    if (state === "ready") return t("assistant.state.ready");
    if (state === "busy") return t("assistant.state.busy");
    if (state === "error") return t("assistant.state.error");
    return t("assistant.state.unavailable");
  };

  const render = () => {
    if (destroyed) return;
    // Do not trust an old observer argument when Identity/Space changed between
    // publication and rendering. Reconcile the canonical conversation scope.
    const snapshot = conversation.getSnapshot();
    const slot = root.querySelector(EXTENSION_SELECTOR);
    if (!slot) {
      mountedSlot = null;
      return;
    }
    // This snapshot comes from the *existing* scoped conversation runtime.
    // No model-generated progress, HTML, actions or data sources are promoted.
    const view = projectAssistantResultCanvas(snapshot);
    const priorInput = slot.querySelector("[data-assistant-input]");
    const focusWasInDraft = documentObject.activeElement === priorInput;
    const cursor = focusWasInDraft ? [priorInput.selectionStart, priorInput.selectionEnd] : null;
    const expandedWork = new Set([...slot.querySelectorAll("details[data-assistant-work-details][open]")]
      .map((element) => element.dataset.assistantWorkDetails));
    const expandedActions = new Set([...slot.querySelectorAll("details[data-assistant-action-details][open]")]
      .map((element) => element.dataset.assistantActionDetails));
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

    const verifiedWork = workCards();
    if (verifiedWork.cards.length > 0) {
      const missions = node(documentObject, "section", "ordax-assistant-work-strip");
      missions.setAttribute("aria-label", t("assistant.work.aria"));
      missions.append(node(documentObject, "h4", "ordax-assistant-work-title",
        t("assistant.work.title")));
      for (const work of verifiedWork.cards) {
        const card = node(documentObject, "article", "ordax-assistant-work-card");
        card.dataset.assistantWorkId = work.workItemId;
        card.dataset.assistantWorkState = work.state;
        const statusLabel = work.workState === "paused" && work.state === "working"
          ? t("assistant.work.state.paused")
          : t(`assistant.work.state.${work.state}`);
        card.append(
          node(documentObject, "strong", "ordax-assistant-work-goal", work.goal),
          node(documentObject, "span", "ordax-assistant-work-state", statusLabel),
        );

        // Even a "finished" Activity event is evidence of a recorded event,
        // not permission for a UI action nor a synthetic success percentage.
        if (work.steps.length > 0) {
          const details = node(documentObject, "details", "ordax-assistant-work-details");
          details.dataset.assistantWorkDetails = work.workItemId;
          details.open = work.state === "requires-action"
            || expandedWork.has(work.workItemId);
          details.append(node(documentObject, "summary", "",
            `${t("assistant.work.events")} · ${work.steps.length}`));
          const list = node(documentObject, "ol", "ordax-assistant-work-events");
          for (const event of work.steps) {
            const line = node(documentObject, "li", "ordax-assistant-work-event");
            line.dataset.assistantWorkEvent = event.type;
            line.dataset.assistantWorkSequence = String(event.sequence);
            const copy = node(documentObject, "p", "ordax-assistant-work-event-summary", event.summary);
            const when = node(documentObject, "time", "ordax-assistant-work-event-time",
              new Date(event.occurredAt).toLocaleString(lifecycle.localization.getLocale()));
            when.dateTime = event.occurredAt;
            line.append(copy, when);
            list.append(line);
          }
          if (work.stepsTruncated) {
            list.prepend(node(documentObject, "li", "ordax-assistant-work-truncated",
              t("assistant.work.truncated")));
          }
          details.append(list);
          card.append(details);
        }
        if (work.pendingApproval !== null) {
          const pending = node(documentObject, "aside", "ordax-assistant-pending-approval");
          pending.dataset.assistantPendingApproval = work.pendingApproval.approvalId;
          pending.append(
            node(documentObject, "strong", "", t("assistant.work.approval.required")),
            node(documentObject, "p", "", work.pendingApproval.reason),
            node(documentObject, "p", "ordax-assistant-work-evidence",
              `${t("assistant.work.approval.effect")}: ${t(`assistant.work.effect.${work.pendingApproval.effect}`)}`),
            node(documentObject, "p", "ordax-assistant-work-evidence",
              t("assistant.work.approval.readonly")),
          );
          card.append(pending);
        }
        // The typed Action Attempt rows come only from verified Personal
        // Work/Activity/Result and are never constructed from model text.
        if (work.actionEvidence.length > 0) {
          const details = node(documentObject, "details", "ordax-assistant-action-details");
          details.dataset.assistantActionDetails = work.workItemId;
          details.open = work.actionEvidence.some((entry) => entry.status === "uncertain")
            || expandedActions.has(work.workItemId);
          details.append(node(documentObject, "summary", "",
            `${t("assistant.work.actions.title")} · ${work.actionEvidence.length}`));
          const table = node(documentObject, "table", "ordax-assistant-actions-table");
          const caption = node(documentObject, "caption", "", t("assistant.work.actions.caption"));
          const head = node(documentObject, "thead");
          const headings = node(documentObject, "tr");
          for (const key of ["status", "action", "time", "summary"]) {
            const th = node(documentObject, "th", "", t(`assistant.work.actions.${key}`));
            th.scope = "col";
            headings.append(th);
          }
          head.append(headings);
          const tbody = node(documentObject, "tbody");
          for (const entry of work.actionEvidence) {
            const tr = node(documentObject, "tr");
            tr.dataset.assistantActionAttempt = entry.attemptId;
            tr.dataset.assistantActionState = entry.status;
            const state = node(documentObject, "td", "",
              t(`assistant.work.attempt.${entry.status}`));
            const action = node(documentObject, "td", "", entry.actionId);
            const at = node(documentObject, "td");
            const when = entry.finishedAt ?? entry.startedAt;
            const time = node(documentObject, "time", "",
              new Date(when).toLocaleString(lifecycle.localization.getLocale()));
            time.dateTime = when;
            at.append(time);
            const summary = node(documentObject, "td", "",
              entry.summary ?? t("assistant.work.actions.noSummary"));
            tr.append(state, action, at, summary);
            tbody.append(tr);
          }
          table.append(caption, head, tbody);
          details.append(table);
          if (work.actionsTruncated) {
            details.append(node(documentObject, "p", "ordax-assistant-work-overflow",
              t("assistant.work.actions.truncated")));
          }
          details.append(node(documentObject, "p", "ordax-assistant-work-evidence",
            t("assistant.work.actions.readonly")));
          card.append(details);
        }
        if (work.state === "result" && work.result?.kind === "text" && work.provenance) {
          const result = node(documentObject, "section", "ordax-assistant-work-output");
          result.append(
            node(documentObject, "span", "ordax-assistant-result-label", t("assistant.work.result")),
            node(documentObject, "p", "ordax-assistant-work-result", work.result.text),
            node(documentObject, "p", "ordax-assistant-work-evidence",
              `${t("assistant.work.source")} · ${work.resultId} · ${work.provenance.engineId} / ${work.provenance.modelId}`),
          );
          card.append(result);
        }
        missions.append(card);
      }
      if (verifiedWork.remainingCount > 0) {
        missions.append(node(documentObject, "p", "ordax-assistant-work-overflow",
          `${verifiedWork.remainingCount} ${t("assistant.work.remaining")}`));
      }
      missions.append(node(documentObject, "p", "ordax-assistant-work-caption",
        t("assistant.work.readonly")));
      slot.append(missions);
    }

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
    if (focusWasInDraft && !textarea.disabled) {
      textarea.focus({ preventScroll: true });
      if (cursor?.every(Number.isInteger)) textarea.setSelectionRange(...cursor);
    }
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
  const unsubscribeWork = personalOrdax?.subscribe?.(() => render()) ?? null;
  const unsubscribeOwner = identitySessionPort?.subscribe?.(() => render()) ?? null;
  const unsubscribeSpace = spaceSelectionPort?.subscribe?.(() => render()) ?? null;
  const unsubscribeRender = lifecycle.subscribeRender(() => render());

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeSpace?.();
      unsubscribeOwner?.();
      unsubscribeWork?.();
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
