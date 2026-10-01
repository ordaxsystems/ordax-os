const NETWORK_WINDOW_SELECTOR = '[data-window-id="network"]';
const NETWORK_EXTENSION_SELECTOR = '[data-app-extension="network-workspace"]';

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stateCopy(snapshot) {
  switch (snapshot.state) {
    case "selection-unavailable":
      return "A seleção de Space está indisponível nesta sessão.";
    case "space-required":
      return "Escolha um Space em Conta antes de escrever.";
    case "sender-changed":
      return "O Space ativo mudou. O rascunho continua ligado ao remetente original.";
    case "offline":
      return "Sem conexão. O rascunho permanece local e não será enviado.";
    case "backend-unavailable":
      return "O backend da Rede ainda não está ativado nesta composição.";
    default:
      return "Pronto para enviar.";
  }
}

export function mountNetworkWorkspaceControls(
  root,
  draftRuntime,
  { onError = null } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Network workspace requires a Surface root Element");
  }
  if (!draftRuntime || typeof draftRuntime.getSnapshot !== "function") {
    throw new TypeError("Network workspace requires a draft runtime");
  }

  const documentObject = root.ownerDocument;
  let destroyed = false;
  let slot = null;

  const findSlot = () =>
    root.querySelector(`${NETWORK_WINDOW_SELECTOR} ${NETWORK_EXTENSION_SELECTOR}`);

  const render = () => {
    if (destroyed) return;
    const nextSlot = findSlot();
    if (!nextSlot) return;
    slot = nextSlot;

    const snapshot = draftRuntime.getSnapshot();
    const view = node(documentObject, "div", "ordax-network-workspace");

    const header = node(documentObject, "header", "ordax-network-workspace-header");
    header.append(
      node(documentObject, "span", "ordax-network-kicker", "Rede"),
      node(documentObject, "h3", "ordax-network-title", "Comunidades e mensagens"),
      node(
        documentObject,
        "p",
        "ordax-network-subtitle",
        "A Rede usa o Space como identidade profissional remetente.",
      ),
    );

    const sender = node(documentObject, "section", "ordax-network-sender");
    sender.append(
      node(documentObject, "span", "ordax-network-label", "Space remetente"),
      node(
        documentObject,
        "strong",
        "ordax-network-sender-value",
        snapshot.senderSpaceId ?? snapshot.activeSpaceId ?? "Nenhum Space selecionado",
      ),
    );
    if (snapshot.senderSpaceId && snapshot.senderSpaceId !== snapshot.activeSpaceId) {
      sender.append(
        node(
          documentObject,
          "small",
          "ordax-network-warning",
          `Space ativo atual: ${snapshot.activeSpaceId ?? "nenhum"}`,
        ),
      );
    }

    const composer = node(documentObject, "section", "ordax-network-composer");
    const textarea = documentObject.createElement("textarea");
    textarea.rows = 6;
    textarea.maxLength = 4000;
    textarea.value = snapshot.body;
    textarea.placeholder = "Escreva uma mensagem…";
    textarea.dataset.networkDraftBody = "";
    textarea.disabled = snapshot.activeSpaceId === null && snapshot.senderSpaceId === null;

    const status = node(
      documentObject,
      "p",
      "ordax-network-status",
      stateCopy(snapshot),
    );
    status.dataset.state = snapshot.state;

    const actions = node(documentObject, "div", "ordax-network-actions");
    const send = node(documentObject, "button", "ordax-network-action-primary", "Enviar");
    send.type = "button";
    send.dataset.networkSend = "";
    send.disabled = !snapshot.canSend;

    const discard = node(documentObject, "button", "ordax-network-action", "Descartar");
    discard.type = "button";
    discard.dataset.networkDiscard = "";
    discard.disabled = !snapshot.body;

    actions.append(send, discard);

    if (snapshot.state === "sender-changed") {
      const rebind = node(
        documentObject,
        "button",
        "ordax-network-action",
        "Usar o Space ativo",
      );
      rebind.type = "button";
      rebind.dataset.networkRebind = "";
      actions.append(rebind);
    }

    composer.append(textarea, status, actions);
    view.append(header, sender, composer);
    slot.replaceChildren(view);
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
