const BOOT_SCREEN_ID = "ordax-boot-screen";
const STATUS_SELECTOR = "[data-ordax-boot-status]";
const READY_GATE_NEXT_STAGE = "next-stage";

export function createSurfaceBootScreen(documentObject = globalThis.document) {
  if (!documentObject || typeof documentObject.querySelector !== "function") {
    throw new TypeError("Surface boot screen requires a document");
  }
  const element = documentObject.querySelector(`#${BOOT_SCREEN_ID}`);
  if (!(element instanceof Element)) {
    throw new TypeError("Surface boot screen element is missing");
  }
  const status = element.querySelector(STATUS_SELECTOR);
  if (!(status instanceof Element)) {
    throw new TypeError("Surface boot screen status element is missing");
  }

  const readyGate = element.dataset.readyGate ?? "";
  let finished = false;
  let readyPending = false;
  let revealGeneration = 0;

  const finishReady = () => {
    if (finished) return false;
    finished = true;
    readyPending = false;
    revealGeneration += 1;
    element.dataset.state = "ready";
    element.setAttribute("aria-hidden", "true");
    element.hidden = true;
    return true;
  };

  const scheduleReadyReveal = () => {
    if (finished || !readyPending) return false;
    const generation = ++revealGeneration;
    queueMicrotask(() => {
      if (finished || !readyPending || generation !== revealGeneration) return;
      finishReady();
    });
    return true;
  };

  const setStage = (message) => {
    if (finished) return false;
    const text = String(message ?? "").trim();
    if (!text) return false;
    status.textContent = text;
    element.dataset.state = "loading";
    if (readyPending && readyGate === READY_GATE_NEXT_STAGE) {
      scheduleReadyReveal();
    }
    return true;
  };

  return Object.freeze({
    setStage,
    ready() {
      if (finished || readyPending) return false;
      if (readyGate !== READY_GATE_NEXT_STAGE) {
        return finishReady();
      }
      readyPending = true;
      element.dataset.state = "ready-pending";
      return true;
    },
    fail(message = "OrdaX") {
      if (finished) return false;
      readyPending = false;
      revealGeneration += 1;
      const text = String(message ?? "").trim() || "OrdaX";
      status.textContent = text;
      element.dataset.state = "error";
      element.hidden = false;
      element.removeAttribute("aria-hidden");
      return true;
    },
    isFinished() {
      return finished;
    },
  });
}
