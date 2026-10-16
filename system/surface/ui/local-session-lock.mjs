import {
  assertLocalSessionPort,
  validateLocalSessionSnapshot,
} from "../../contracts/local-session.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

export function mountLocalSessionLock(
  root,
  localSession,
  surfaceLifecycle,
  { documentObject = root?.ownerDocument ?? globalThis.document } = {},
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Local session lock requires the Surface root Element");
  }
  const port = assertLocalSessionPort(localSession);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  let snapshot = validateLocalSessionSnapshot(port.getSnapshot());
  let overlay = null;
  let pending = false;
  let secretVisible = false;
  let messageId = null;
  let destroyed = false;
  let previousInert = root.inert;
  let previousAriaHidden = root.getAttribute("aria-hidden");

  const restoreRoot = () => {
    root.inert = previousInert;
    if (previousAriaHidden === null) root.removeAttribute("aria-hidden");
    else root.setAttribute("aria-hidden", previousAriaHidden);
  };

  const removeOverlay = () => {
    overlay?.remove();
    overlay = null;
    restoreRoot();
  };

  const render = ({ preserveSecret = false } = {}) => {
    if (destroyed) return;
    if (snapshot.state !== "locked") {
      removeOverlay();
      return;
    }
    if (!overlay) {
      previousInert = root.inert;
      previousAriaHidden = root.getAttribute("aria-hidden");
      root.inert = true;
      root.setAttribute("aria-hidden", "true");
      overlay = documentObject.createElement("section");
      overlay.className = "ordax-local-session-lock";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "ordax-local-session-lock-title");
      documentObject.body.append(overlay);
    }

    const previousInput = preserveSecret
      ? overlay.querySelector("[data-local-session-secret]")
      : null;
    const secretState = previousInput instanceof HTMLInputElement
      ? {
          value: previousInput.value,
          selectionStart: previousInput.selectionStart,
          selectionEnd: previousInput.selectionEnd,
          focused: documentObject.activeElement === previousInput,
        }
      : null;

    overlay.replaceChildren();
    const card = documentObject.createElement("main");
    card.className = "ordax-local-session-lock-card";
    const brand = documentObject.createElement("strong");
    brand.className = "ordax-local-session-lock-brand";
    brand.textContent = "OrdaX";
    const title = documentObject.createElement("h1");
    title.id = "ordax-local-session-lock-title";
    title.textContent = t("localSession.lock.title");
    const copy = documentObject.createElement("p");
    copy.textContent = t("localSession.lock.description");
    const form = documentObject.createElement("form");
    form.className = "ordax-local-session-lock-form";
    form.dataset.localSessionUnlockForm = "";
    const label = documentObject.createElement("label");
    label.textContent = t("localSession.lock.secretLabel");
    const input = documentObject.createElement("input");
    input.type = secretVisible ? "text" : "password";
    input.autocomplete = "current-password";
    input.minLength = 6;
    input.maxLength = 128;
    input.required = true;
    input.dataset.localSessionSecret = "";
    input.disabled = pending;
    if (secretState && !pending) {
      input.value = secretState.value;
      if (
        secretState.selectionStart !== null
        && secretState.selectionEnd !== null
      ) {
        input.setSelectionRange(
          secretState.selectionStart,
          secretState.selectionEnd,
        );
      }
    }
    const secretRow = documentObject.createElement("div");
    secretRow.className = "ordax-local-session-lock-secret-row";
    const reveal = documentObject.createElement("button");
    reveal.type = "button";
    reveal.className = "ordax-local-session-lock-reveal";
    reveal.dataset.localSessionSecretToggle = "";
    reveal.setAttribute("aria-pressed", String(secretVisible));
    reveal.setAttribute("aria-label", secretVisible ? "Ocultar senha" : "Mostrar senha");
    reveal.textContent = secretVisible ? "Ocultar" : "Mostrar";
    reveal.disabled = pending;
    secretRow.append(input, reveal);
    label.append(secretRow);
    const button = documentObject.createElement("button");
    button.type = "submit";
    button.textContent = pending
      ? t("localSession.lock.action.verifying")
      : t("localSession.lock.action.unlock");
    button.disabled = pending;
    form.append(label, button);
    const status = documentObject.createElement("p");
    status.className = "ordax-local-session-lock-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = messageId ? t(messageId) : "";
    card.append(brand, title, copy, form, status);
    overlay.append(card);

    queueMicrotask(() => {
      if (destroyed || input.disabled) return;
      if (!secretState || secretState.focused || !documentObject.activeElement) {
        input.focus();
      }
    });
  };

  const onClick = (event) => {
    const toggle = event.target.closest?.("[data-local-session-secret-toggle]");
    if (!toggle || !overlay?.contains(toggle) || pending) return;
    secretVisible = !secretVisible;
    render({ preserveSecret: true });
  };

  const onSubmit = (event) => {
    const form = event.target.closest?.("[data-local-session-unlock-form]");
    if (!form || !overlay?.contains(form) || pending) return;
    event.preventDefault();
    const input = form.querySelector("[data-local-session-secret]");
    if (!(input instanceof HTMLInputElement)) return;
    let secret = input.value;
    input.value = "";
    if (secret.length < 6) {
      secret = "";
      messageId = "localSession.lock.message.minLength";
      render();
      return;
    }
    pending = true;
    messageId = null;
    render();
    const operationSecret = secret;
    secret = "";
    void port.unlock(operationSecret).catch((error) => {
      if (destroyed) return;
      messageId = error?.status === 429
        ? "localSession.lock.message.rateLimited"
        : "localSession.lock.message.incorrect";
    }).finally(() => {
      if (destroyed) return;
      pending = false;
      render();
    });
  };

  documentObject.addEventListener("click", onClick);
  documentObject.addEventListener("submit", onSubmit);
  const unsubscribeSession = port.subscribe((next) => {
    snapshot = validateLocalSessionSnapshot(next);
    if (snapshot.state !== "locked") messageId = null;
    render();
  });
  const unsubscribeLocalization = localization.subscribe(() => {
    render({ preserveSecret: true });
  });
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeSession();
      unsubscribeLocalization();
      documentObject.removeEventListener("click", onClick);
      documentObject.removeEventListener("submit", onSubmit);
      removeOverlay();
    },
  });
}
