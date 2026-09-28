import { assertSurfaceRenderLifecycle } from "../../../contracts/surface-render-lifecycle.mjs";
import { createIntelligenceChatSession } from "../session.mjs";

const WINDOW_SELECTOR = '[data-window-id="intelligence"]';
const EXTENSION_SELECTOR = '[data-app-extension="intelligence-chat"]';

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
  const clear = node(documentObject, "button", "ordax-intelligence-chat-clear", t("intelligence.chat.clear"));
  clear.type = "button";
  clear.dataset.intelligenceChatClear = "";
  controls.append(clear);
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
  statusGrid.append(localCard, contextCard, webCard);

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
  let destroyed = false;
  let mountedSlot = null;

  const findSlot = () => root.querySelector(`${WINDOW_SELECTOR} ${EXTENSION_SELECTOR}`);

  const renderTranscript = (view) => {
    const transcript = view.querySelector("[data-intelligence-chat-transcript]");
    if (!transcript) return;
    transcript.replaceChildren();
    if (sessionSnapshot.messages.length === 0) {
      const empty = node(documentObject, "section", "ordax-intelligence-chat-empty");
      empty.append(
        node(documentObject, "strong", "", t("intelligence.chat.emptyTitle")),
        node(documentObject, "p", "", t("intelligence.chat.emptyBody")),
      );
      transcript.append(empty);
      return;
    }

    for (const message of sessionSnapshot.messages) {
      const item = node(documentObject, "article", "ordax-intelligence-chat-message");
      item.dataset.role = message.role;
      const author = message.role === "assistant"
        ? t("intelligence.chat.assistant")
        : t("intelligence.chat.user");
      item.append(
        node(documentObject, "span", "ordax-intelligence-chat-message-author", author),
        node(documentObject, "p", "ordax-intelligence-chat-message-text", message.text),
      );
      transcript.append(item);
    }
    transcript.scrollTop = transcript.scrollHeight;
  };

  const render = () => {
    if (destroyed) return;
    const slot = findSlot();
    if (!slot) {
      mountedSlot = null;
      return;
    }

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
    void session.send(prompt).catch(() => {});
  };

  const onClick = (event) => {
    const clear = event.target?.closest?.("[data-intelligence-chat-clear]");
    if (!clear || !root.contains(clear)) return;
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
      mountedSlot = null;
    },
  });
}
