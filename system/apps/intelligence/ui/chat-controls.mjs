import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { parseIntelligenceHandoffTarget } from "../../../contracts/intelligence-handoff.mjs";
import { createIntelligenceChatSession } from "../session.mjs";

const WINDOW_SELECTOR = '[data-window-id="intelligence"]';
const EXTENSION_SELECTOR = '[data-app-extension="intelligence-chat"]';
const INTERACTION_MODES = new Set(["chat", "plan"]);

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stateMessageId(state) {
  if (state === "ready") return "intelligence.chat.ready";
  if (state === "busy") return "intelligence.chat.busy";
  if (state === "error") return "intelligence.chat.error";
  return "intelligence.chat.degraded";
}

function modeButton(documentObject, t, mode, labelId) {
  const button = node(documentObject, "button", "ordax-intelligence-chat-mode", t(labelId));
  button.type = "button";
  button.dataset.intelligenceChatMode = mode;
  button.setAttribute("aria-pressed", "false");
  return button;
}

function createView(documentObject, t) {
  const view = node(documentObject, "div", "ordax-intelligence-chat");
  view.dataset.ordaxIntelligenceChat = "";

  const header = node(documentObject, "header", "ordax-intelligence-chat-header");
  const heading = node(documentObject, "div", "ordax-intelligence-chat-heading");
  heading.append(
    node(documentObject, "span", "ordax-intelligence-chat-kicker", "ORDAX"),
    node(documentObject, "h2", "ordax-intelligence-chat-title", t("intelligence.chat.heading")),
  );

  const controls = node(documentObject, "div", "ordax-intelligence-chat-controls");
  const modeSwitch = node(documentObject, "div", "ordax-intelligence-chat-mode-switch");
  modeSwitch.setAttribute("role", "group");
  modeSwitch.setAttribute("aria-label", t("intelligence.chat.modeAria"));
  modeSwitch.append(
    modeButton(documentObject, t, "chat", "intelligence.chat.modeChat"),
    modeButton(documentObject, t, "plan", "intelligence.chat.modePlan"),
  );
  const clear = node(documentObject, "button", "ordax-intelligence-chat-clear", t("intelligence.chat.clear"));
  clear.type = "button";
  clear.dataset.intelligenceChatClear = "";
  controls.append(modeSwitch, clear);
  header.append(heading, controls);

  const statusGrid = node(documentObject, "section", "ordax-intelligence-chat-status-grid");
  const localCard = node(documentObject, "article", "ordax-intelligence-chat-status-card");
  localCard.dataset.mode = "local";
  localCard.append(
    node(documentObject, "strong", "ordax-intelligence-chat-status-label", t("intelligence.chat.localBadge")),
    node(documentObject, "p", "ordax-intelligence-chat-status-detail", t("intelligence.chat.localDetail")),
  );
  const contextCard = node(documentObject, "article", "ordax-intelligence-chat-status-card");
  contextCard.dataset.mode = "system-context";
  contextCard.dataset.intelligenceChatContextCard = "";
  contextCard.hidden = true;
  contextCard.append(
    node(documentObject, "strong", "ordax-intelligence-chat-status-label", t("intelligence.chat.systemContext")),
    node(documentObject, "p", "ordax-intelligence-chat-status-detail", t("intelligence.chat.systemContextDetail")),
  );
  const webCard = node(documentObject, "article", "ordax-intelligence-chat-status-card");
  webCard.dataset.mode = "web-disabled";
  webCard.append(
    node(documentObject, "strong", "ordax-intelligence-chat-status-label", t("intelligence.chat.webDisabled")),
    node(documentObject, "p", "ordax-intelligence-chat-status-detail", t("intelligence.chat.webDisabledDetail")),
  );
  const planCard = node(documentObject, "article", "ordax-intelligence-chat-status-card");
  planCard.dataset.mode = "plan";
  planCard.dataset.intelligenceChatPlanCard = "";
  planCard.hidden = true;
  planCard.append(
    node(documentObject, "strong", "ordax-intelligence-chat-status-label", t("intelligence.plan.badge")),
    node(documentObject, "p", "ordax-intelligence-chat-status-detail", t("intelligence.plan.nonExecutable")),
  );
  const handoffCard = node(documentObject, "article", "ordax-intelligence-chat-status-card");
  handoffCard.dataset.mode = "handoff";
  handoffCard.dataset.intelligenceHandoffCard = "";
  handoffCard.hidden = true;
  const handoffDetail = node(documentObject, "p", "ordax-intelligence-chat-status-detail");
  handoffDetail.dataset.intelligenceHandoffDetail = "";
  handoffCard.append(
    node(documentObject, "strong", "ordax-intelligence-chat-status-label", t("intelligence.handoff.badge")),
    handoffDetail,
  );
  statusGrid.append(localCard, contextCard, webCard, planCard, handoffCard);

  const runtime = node(documentObject, "div", "ordax-intelligence-chat-runtime");
  const runtimeState = node(documentObject, "span", "ordax-intelligence-chat-runtime-state");
  runtimeState.dataset.intelligenceChatState = "";
  runtimeState.setAttribute("role", "status");
  runtimeState.setAttribute("aria-live", "polite");
  const model = node(documentObject, "span", "ordax-intelligence-chat-model");
  model.dataset.intelligenceChatModel = "";
  runtime.append(runtimeState, model);

  const transcript = node(documentObject, "div", "ordax-intelligence-chat-transcript");
  transcript.dataset.intelligenceChatTranscript = "";
  transcript.setAttribute("aria-live", "polite");

  const composer = node(documentObject, "form", "ordax-intelligence-chat-composer");
  composer.dataset.intelligenceChatComposer = "";
  const input = node(documentObject, "textarea", "ordax-intelligence-chat-input");
  input.rows = 3;
  input.maxLength = 32000;
  input.placeholder = t("intelligence.chat.inputPlaceholder");
  input.setAttribute("aria-label", t("intelligence.chat.inputAria"));
  input.dataset.intelligenceChatInput = "";
  const composerFooter = node(documentObject, "div", "ordax-intelligence-chat-composer-footer");
  composerFooter.append(node(documentObject, "small", "ordax-intelligence-chat-session-note", t("intelligence.chat.sessionOnly")));
  const send = node(documentObject, "button", "ordax-intelligence-chat-send", t("intelligence.chat.send"));
  send.type = "submit";
  send.dataset.intelligenceChatSend = "";
  composerFooter.append(send);
  composer.append(input, composerFooter);

  view.append(header, statusGrid, runtime, transcript, composer);
  return view;
}

export function mountIntelligenceChatControls(
  root,
  intelligence,
  surfaceLifecycle,
  { contextRegistry = null } = {},
) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Intelligence chat requires a Surface root");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;
  const session = createIntelligenceChatSession(intelligence, { contextRegistry });

  let sessionSnapshot = session.getSnapshot();
  let interactionMode = "chat";
  let activeHandoff = null;
  let consumedSurfaceTarget = null;
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () => root.querySelector(`${WINDOW_SELECTOR} ${EXTENSION_SELECTOR}`);

  const clearConsumedSurfaceTarget = (target) => {
    queueMicrotask(() => {
      if (destroyed) return;
      if (lifecycle.getAppTarget("intelligence") === target) {
        lifecycle.setAppTarget("intelligence", null);
      }
    });
  };

  const consumeSurfaceHandoff = () => {
    const target = lifecycle.getAppTarget("intelligence");
    if (target === null) {
      consumedSurfaceTarget = null;
      return;
    }
    if (target === consumedSurfaceTarget) return;
    consumedSurfaceTarget = target;

    let handoff;
    try {
      handoff = parseIntelligenceHandoffTarget(target);
    } catch {
      clearConsumedSurfaceTarget(target);
      return;
    }
    if (handoff === null) return;

    activeHandoff = handoff;
    interactionMode = handoff.mode === "plan" ? "plan" : "chat";
    clearConsumedSurfaceTarget(target);
    queueMicrotask(() => {
      if (destroyed) return;
      const input = findSlot()?.querySelector("[data-intelligence-chat-input]");
      if (!input) return;
      if (handoff.suggestedPrompt && !input.value.trim()) {
        input.value = handoff.suggestedPrompt;
      }
      input.focus({ preventScroll: true });
    });
  };

  const renderTranscript = (view) => {
    const transcript = view.querySelector("[data-intelligence-chat-transcript]");
    if (!transcript) return;
    transcript.replaceChildren();
    if (sessionSnapshot.messages.length === 0) {
      const empty = node(documentObject, "section", "ordax-intelligence-chat-empty");
      const titleId = interactionMode === "plan"
        ? "intelligence.plan.emptyTitle"
        : "intelligence.chat.emptyTitle";
      const bodyId = interactionMode === "plan"
        ? "intelligence.plan.emptyBody"
        : "intelligence.chat.emptyBody";
      empty.append(
        node(documentObject, "strong", "", t(titleId)),
        node(documentObject, "p", "", t(bodyId)),
      );
      transcript.append(empty);
      return;
    }

    for (const message of sessionSnapshot.messages) {
      const item = node(documentObject, "article", "ordax-intelligence-chat-message");
      item.dataset.role = message.role;
      item.dataset.kind = message.kind ?? "chat";
      const author = message.role === "assistant"
        ? message.kind === "plan"
          ? t("intelligence.plan.resultTitle")
          : t("intelligence.chat.assistant")
        : t("intelligence.chat.user");
      item.append(
        node(documentObject, "span", "ordax-intelligence-chat-message-author", author),
        node(documentObject, "p", "ordax-intelligence-chat-message-text", message.text),
      );
      if (message.role === "assistant" && message.kind === "plan") {
        item.append(node(
          documentObject,
          "small",
          "ordax-intelligence-chat-plan-safety",
          t("intelligence.plan.nonExecutableShort"),
        ));
      }
      transcript.append(item);
    }
    transcript.scrollTop = transcript.scrollHeight;
  };

  const renderMode = (view) => {
    for (const button of view.querySelectorAll("[data-intelligence-chat-mode]")) {
      const active = button.dataset.intelligenceChatMode === interactionMode;
      button.dataset.active = active ? "true" : "false";
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const planCard = view.querySelector("[data-intelligence-chat-plan-card]");
    if (planCard) planCard.hidden = interactionMode !== "plan";

    const handoffMatchesMode = activeHandoff !== null
      && (activeHandoff.mode === "plan" ? interactionMode === "plan" : interactionMode === "chat");
    const handoffCard = view.querySelector("[data-intelligence-handoff-card]");
    const handoffDetail = view.querySelector("[data-intelligence-handoff-detail]");
    if (handoffCard) handoffCard.hidden = !handoffMatchesMode;
    if (handoffDetail && handoffMatchesMode) {
      const label = activeHandoff.displayLabel
        ?? `${activeHandoff.target.kind}:${activeHandoff.target.id}`;
      handoffDetail.textContent = t("intelligence.handoff.detail", {
        label,
        app: activeHandoff.sourceAppId,
      });
    }

    const input = view.querySelector("[data-intelligence-chat-input]");
    if (input) {
      input.placeholder = t(
        interactionMode === "plan"
          ? "intelligence.plan.inputPlaceholder"
          : "intelligence.chat.inputPlaceholder",
      );
      input.setAttribute(
        "aria-label",
        t(interactionMode === "plan" ? "intelligence.plan.inputAria" : "intelligence.chat.inputAria"),
      );
    }
    const send = view.querySelector("[data-intelligence-chat-send]");
    if (send) {
      send.textContent = t(
        interactionMode === "plan" ? "intelligence.plan.send" : "intelligence.chat.send",
      );
    }
  };

  const render = () => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }

    consumeSurfaceHandoff();

    let view = slot.querySelector("[data-ordax-intelligence-chat]");
    if (!view || mountedSlot !== slot) {
      slot.replaceChildren();
      view = createView(documentObject, t);
      slot.append(view);
      mountedSlot = slot;
    }

    const intelligenceSnapshot = sessionSnapshot.intelligence;
    const state = view.querySelector("[data-intelligence-chat-state]");
    if (state) {
      state.textContent = sessionSnapshot.failed
        ? t("intelligence.chat.failure")
        : t(stateMessageId(intelligenceSnapshot.state));
      state.dataset.state = sessionSnapshot.failed ? "error" : intelligenceSnapshot.state;
    }
    const model = view.querySelector("[data-intelligence-chat-model]");
    if (model) {
      model.textContent = intelligenceSnapshot.modelId
        ? t("intelligence.chat.model", { model: intelligenceSnapshot.modelId })
        : t("intelligence.chat.modelUnknown");
    }
    const contextCard = view.querySelector("[data-intelligence-chat-context-card]");
    if (contextCard) {
      contextCard.hidden = sessionSnapshot.contextSources.length === 0;
    }
    const input = view.querySelector("[data-intelligence-chat-input]");
    const send = view.querySelector("[data-intelligence-chat-send]");
    const disabled = sessionSnapshot.pending || intelligenceSnapshot.state !== "ready";
    if (input) input.disabled = disabled;
    if (send) send.disabled = disabled;
    renderMode(view);
    renderTranscript(view);
  };

  const onSubmit = (event) => {
    const form = event.target?.closest?.("[data-intelligence-chat-composer]");
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    const input = form.querySelector("[data-intelligence-chat-input]");
    const prompt = input?.value ?? "";
    if (!prompt.trim()) return;
    if (input) input.value = "";
    const operation = interactionMode === "plan"
      ? session.plan({ goal: prompt, target: activeHandoff?.target ?? null })
      : session.send(prompt);
    void operation.catch(() => {});
  };

  const onClick = (event) => {
    const modeControl = event.target?.closest?.("[data-intelligence-chat-mode]");
    if (modeControl && root.contains(modeControl)) {
      const nextMode = modeControl.dataset.intelligenceChatMode;
      if (INTERACTION_MODES.has(nextMode)) {
        if (
          activeHandoff !== null
          && (activeHandoff.mode === "plan" ? nextMode !== "plan" : nextMode !== "chat")
        ) {
          activeHandoff = null;
        }
        interactionMode = nextMode;
        render();
      }
      return;
    }
    const clear = event.target?.closest?.("[data-intelligence-chat-clear]");
    if (!clear || !root.contains(clear)) return;
    activeHandoff = null;
    lifecycle.setAppTarget("intelligence", null);
    session.clear();
  };

  const unsubscribeSession = session.subscribe((next) => {
    sessionSnapshot = next;
    render();
  });
  const unsubscribeLocalization = localization.subscribe(() => {
    mountedSlot = null;
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(() => render());
  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender();
      unsubscribeLocalization();
      unsubscribeSession();
      root.removeEventListener("submit", onSubmit);
      root.removeEventListener("click", onClick);
      findSlot()?.querySelector("[data-ordax-intelligence-chat]")?.remove();
      session.dispose();
      activeHandoff = null;
      mountedSlot = null;
    },
  });
}
