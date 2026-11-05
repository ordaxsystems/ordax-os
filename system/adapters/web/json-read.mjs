export const WEB_JSON_READ_TIMEOUT_MS = 10_000;

/** @typedef {{ok: boolean, status: number, value: unknown}} WebJsonReadResult */

function readError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

// One cancellation/deadline primitive for same-origin Web transports.
// Domain adapters still own HTTP methods, routes, response validation and
// mutation semantics. Aborting an HTTP POST cannot prove a server rollback.
export async function runWebRequestWithinDeadline(
  windowRef,
  controller,
  operation,
  label = "Web read",
) {
  if (!windowRef || typeof windowRef.fetch !== "function"
    || !(controller instanceof AbortController) || typeof operation !== "function") {
    throw new TypeError("Bounded Web request requires fetch, AbortController and operation");
  }
  const schedule = windowRef.setTimeout?.bind(windowRef) ?? globalThis.setTimeout;
  const unschedule = windowRef.clearTimeout?.bind(windowRef) ?? globalThis.clearTimeout;
  let timer = null;
  let releaseAbort = () => {};
  try {
    return await new Promise((resolve, reject) => {
      const onAbort = () => reject(controller.signal.reason ?? readError("AbortError", "Web request cancelled"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      releaseAbort = () => controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      timer = schedule(() => {
        controller.abort(readError("TimeoutError", `${label} deadline exceeded`));
      }, WEB_JSON_READ_TIMEOUT_MS);
      // Starting the operation synchronously preserves the established reader
      // lifecycle. A noncooperative fetch/body is still settled by onAbort.
      const pending = (async () => operation(controller.signal))();
      pending.then(resolve, reject);
    });
  } finally {
    if (timer !== null) unschedule(timer);
    releaseAbort();
  }
}

// Adapter transport only: bounded same-origin GET + JSON body. No commands,
// credentials storage, domain state, retries or authority are introduced here.
export function createWebJsonReader(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Web JSON reader requires window.fetch");
  }
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
      try {
        return await runWebRequestWithinDeadline(windowRef, controller, async (signal) => {
          const response = await windowRef.fetch(path, {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            headers: { Accept: "application/json" },
            signal,
          });
          if (signal.aborted) throw signal.reason;
          return {
            ok: response.ok,
            status: response.status,
            value: response.ok ? await response.json() : null,
          };
        });
      } finally {
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
