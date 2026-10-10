const BOOT_SCREEN_ID = "ordax-boot-screen";
const STATUS_SELECTOR = "[data-ordax-boot-status]";

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

  let finished = false;
  const media = element.querySelector("[data-ordax-boot-video]");
  if (media && typeof media.addEventListener === "function") {
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    const source = media.dataset?.src;
    const poster = media.dataset?.poster;

    const showFallback = () => {
      if (!finished) element.dataset.animation = "fallback";
    };
    media.addEventListener("error", showFallback);
    media.addEventListener("playing", () => {
      if (!finished && element.dataset.state === "loading") {
        element.dataset.animation = "playing";
      }
    });
    media.addEventListener("loadeddata", () => {
      if (finished) return;
      try {
        const started = media.play?.();
        started?.catch?.(showFallback);
      } catch {
        showFallback();
      }
    });

    // The media is optional. Never request or decode it for reduced motion.
    if (!reducedMotion && typeof source === "string" && source.startsWith("../../surface/ui/boot/")) {
      if (typeof poster === "string" && poster.startsWith("../../surface/ui/boot/")) {
        media.poster = poster;
      }
      media.src = source;
      media.load?.();
    }
  }
  const stopMedia = () => {
    if (!media) return;
    try { media.pause?.(); } catch { /* fallback status is still visible */ }
  };

  const setStage = (message) => {
    if (finished) return false;
    const text = String(message ?? "").trim();
    if (!text) return false;
    status.textContent = text;
    element.dataset.state = "loading";
    return true;
  };

  return Object.freeze({
    setStage,
    ready() {
      if (finished) return false;
      finished = true;
      stopMedia();
      element.dataset.state = "ready";
      element.setAttribute("aria-hidden", "true");
      element.hidden = true;
      return true;
    },
    fail(message = "OrdaX") {
      if (finished) return false;
      const text = String(message ?? "").trim() || "OrdaX";
      status.textContent = text;
      stopMedia();
      element.dataset.animation = "fallback";
      element.dataset.state = "error";
      element.removeAttribute("aria-hidden");
      return true;
    },
    isFinished() {
      return finished;
    },
  });
}
