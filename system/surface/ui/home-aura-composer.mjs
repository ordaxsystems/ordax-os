import {
  assertIntelligencePort,
  validateIntelligenceResponse,
  validateIntelligenceSnapshot,
} from "../../contracts/intelligence.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

function assertHomeAura(root) {
  if (!root || typeof root.querySelector !== "function" || !root.ownerDocument) {
    throw new TypeError("Home Aura requires a Surface root");
  }
  const elements = {
    hero: root.querySelector(".ordax-home-hero"),
    input: root.querySelector("[data-native-aura-prompt]"),
    submit: root.querySelector("[data-home-aura-submit]"),
    status: root.querySelector("[data-home-aura-status]"),
    note: root.querySelector("[data-home-aura-note]"),
    response: root.querySelector("[data-home-aura-response]"),
    responseText: root.querySelector("[data-home-aura-response-text]"),
  };
  if (Object.values(elements).some((element) => !element)) {
    throw new Error("Home Aura requires the canonical composer elements");
  }
  return elements;
}

function statusMessage(snapshot, pending, failed, translate) {
  if (pending || snapshot.state === "busy") {
    return Object.freeze({
      label: translate("home.aura.status.busy"),
      note: translate("home.aura.note.busy"),
      state: "busy",
    });
  }
  if (snapshot.state === "ready" && snapshot.inferenceAvailable) {
    return Object.freeze({
      label: translate("home.aura.status.ready"),
      note: translate(failed ? "home.aura.note.error" : "home.aura.note.ready"),
      state: failed ? "error" : "ready",
    });
  }
  if (snapshot.state === "degraded") {
    return Object.freeze({
      label: translate("home.aura.status.loading"),
      note: translate("home.aura.note.loading"),
      state: "loading",
    });
  }
  return Object.freeze({
    label: translate("home.aura.status.unavailable"),
    note: translate(failed ? "home.aura.note.error" : "home.aura.note.unavailable"),
    state: "unavailable",
  });
}

export function mountHomeAuraComposer(rootValue, {
  intelligence = null,
  surfaceLifecycle = null,
} = {}) {
  const root = rootValue;
  const elements = assertHomeAura(root);
  const intelligencePort = assertIntelligencePort(intelligence);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  let snapshot = validateIntelligenceSnapshot(intelligencePort.getSnapshot());
  let pending = false;
  let failed = false;
  let destroyed = false;
  let activeController = null;

  const render = () => {
    if (destroyed) return;
    snapshot = validateIntelligenceSnapshot(intelligencePort.getSnapshot());
    const view = statusMessage(snapshot, pending, failed, localization.translate);
    elements.status.textContent = view.label;
    elements.status.dataset.state = view.state;
    elements.note.textContent = view.note;
    elements.submit.disabled = pending || snapshot.state !== "ready" || !snapshot.inferenceAvailable;
    elements.input.disabled = pending;
    elements.hero.setAttribute("aria-busy", String(pending));
    elements.response.setAttribute("aria-busy", String(pending));
    elements.response.setAttribute("aria-live", pending ? "off" : "polite");
  };

  const submit = async () => {
    if (destroyed || pending) return;
    const prompt = elements.input.value.trim();
    if (!prompt) {
      elements.input.focus();
      return;
    }
    render();
    if (snapshot.state !== "ready" || !snapshot.inferenceAvailable) return;

    const controller = new AbortController();
    activeController = controller;
    pending = true;
    failed = false;
    elements.response.hidden = false;
    elements.response.dataset.state = "busy";
    elements.responseText.textContent = localization.translate("home.aura.response.working");
    render();

    try {
      const response = await intelligencePort.respond({
        intent: "ask",
        prompt,
        context: [],
        maxTokens: 512,
      }, {
        signal: controller.signal,
      });
      if (destroyed || controller.signal.aborted) return;
      const validated = validateIntelligenceResponse(response);
      elements.responseText.textContent = validated.text;
      elements.response.dataset.state = "ready";
      elements.input.value = "";
    } catch {
      if (destroyed || controller.signal.aborted) return;
      failed = true;
      elements.response.dataset.state = "error";
      elements.responseText.textContent = localization.translate("home.aura.response.error");
    } finally {
      if (activeController === controller) activeController = null;
      pending = false;
      render();
    }
  };

  const onClick = (event) => {
    if (!event.target.closest?.("[data-home-aura-submit]")) return;
    event.preventDefault();
    void submit();
  };
  const unsubscribeIntelligence = intelligencePort.subscribe((value) => {
    snapshot = validateIntelligenceSnapshot(value);
    render();
  });
  const unsubscribeLocalization = localization.subscribe(render);
  root.addEventListener("click", onClick);
  render();

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      activeController?.abort();
      activeController = null;
      unsubscribeIntelligence?.();
      unsubscribeLocalization?.();
      root.removeEventListener("click", onClick);
    },
  });
}
