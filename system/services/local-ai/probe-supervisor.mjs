import { assertLocalAiPort } from "../../contracts/local-ai.mjs";

const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 60000;

/**
 * Native composition lifecycle owner for eventual model readiness.
 * The backend is non-boot-critical and starts independently of the Surface.
 * No request is replayed: only read-only discovery/health is retried.
 */
export function createLocalAiProbeSupervisor({
  localPort,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (id) => clearTimeout(id),
} = {}) {
  const local = assertLocalAiPort(localPort);
  if (typeof local.probe !== "function") {
    throw new TypeError("Local AI probe supervisor requires a probe-capable port");
  }
  if (typeof schedule !== "function" || typeof cancel !== "function") {
    throw new TypeError("Local AI probe supervisor requires scheduling functions");
  }
  let started = false;
  let disposed = false;
  let probing = false;
  let timer = null;
  let attempts = 0;

  const cancelPending = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };

  const reconcile = (snapshot) => {
    if (disposed || !started || probing) return;
    if (snapshot.state === "ready" || snapshot.state === "busy") {
      cancelPending();
      attempts = 0;
      return;
    }
    if (timer !== null) return;
    const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * (2 ** Math.min(attempts, 5)));
    attempts += 1;
    timer = schedule(() => {
      timer = null;
      void probeNow();
    }, delay);
  };

  const probeNow = async () => {
    if (disposed || probing) return;
    if (local.getSnapshot().state === "busy") return;
    probing = true;
    try {
      await local.probe();
    } catch {
      // An unavailable backend must not block Surface boot. The next bounded
      // read-only probe retries independently; user requests are never replayed.
    } finally {
      probing = false;
      if (!disposed) reconcile(local.getSnapshot());
    }
  };

  const unsubscribe = local.subscribe(reconcile);

  return Object.freeze({
    start() {
      if (disposed) throw new Error("Local AI probe supervisor is disposed");
      if (started) return;
      started = true;
      void probeNow();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelPending();
      unsubscribe();
    },
  });
}
