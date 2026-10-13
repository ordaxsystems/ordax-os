export const WEB_JSON_READ_TIMEOUT_MS = 10_000;

/** @typedef {{ok: boolean, status: number, value: unknown}} WebJsonReadResult */

function readError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

// Adapter transport only: bounded same-origin GET + JSON body. No commands,
// credentials storage, domain state, retries or authority are introduced here.
export function createWebJsonReader(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web JSON reader requires window.fetch");
  }
  const schedule = windowRef.setTimeout?.bind(windowRef) ?? globalThis.setTimeout;
  const unschedule = windowRef.clearTimeout?.bind(windowRef) ?? globalThis.clearTimeout;
  let activeController = null;
  let disposed = false;

  const cancel = () => {
    activeController?.abort(readError("AbortError", "Web read cancelled"));
  };

  return Object.freeze({
    /** @param {string} path @returns {Promise<WebJsonReadResult>} */
    async read(path) {
      if (disposed) throw new Error("Web JSON reader is disposed");
      if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")
        || /[\\\u0000-\u0020\u007f#]/.test(path)) {
        throw new TypeError("Web read requires a same-origin absolute path");
      }
      cancel();
      const controller = new AbortController();
      activeController = controller;
      let timer = null;
      let releaseAbort = () => {};
      try {
        // Settle cancellation independently of fetch/body implementations. The
        // handlers below still consume late resolution/rejection without publishing.
        /** @type {Promise<WebJsonReadResult>} */
        const pending = new Promise((resolve, reject) => {
          const onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", onAbort, { once: true });
          releaseAbort = () => controller.signal.removeEventListener("abort", onAbort);
          timer = schedule(() => {
            controller.abort(readError("TimeoutError", "Web read deadline exceeded"));
          }, WEB_JSON_READ_TIMEOUT_MS);
          const operation = (async () => {
            const response = await windowRef.fetch(path, {
              method: "GET",
              credentials: "same-origin",
              cache: "no-store",
              redirect: "error",
              headers: { Accept: "application/json" },
              signal: controller.signal,
            });
            if (controller.signal.aborted) throw controller.signal.reason;
            return {
              ok: response.ok,
              status: response.status,
              value: response.ok ? await response.json() : null,
            };
          })();
          operation.then(resolve, reject);
        });
        return await pending;
      } finally {
        if (timer !== null) unschedule(timer);
        releaseAbort();
        if (activeController === controller) activeController = null;
      }
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
    },
  });
}
