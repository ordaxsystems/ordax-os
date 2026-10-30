// One Native Host session, independent capability checks.
//
// The host's session response contains separate capability tokens. Parallel
// boot adapters must not issue duplicate GETs for the same session. Share
// only the in-flight read per window; a settled promise is never cached,
// including after HTTP, transport or JSON errors. Permission checks and token
// lifetime remain the responsibility of each existing capability adapter.
export const NATIVE_SESSION_ENDPOINT = "/__ordax/native/session";
const pendingByWindow = new WeakMap();

export function readNativeSession(windowRef) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native session requires window.fetch");
  }
  const existing = pendingByWindow.get(windowRef);
  if (existing !== undefined) return existing;

  const pending = (async () => {
    const response = await windowRef.fetch(NATIVE_SESSION_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      return Object.freeze({ ok: false, status: response.status, payload: null });
    }
    return Object.freeze({ ok: true, status: response.status, payload: await response.json() });
  })();
  pendingByWindow.set(windowRef, pending);
  const release = () => {
    if (pendingByWindow.get(windowRef) === pending) pendingByWindow.delete(windowRef);
  };
  // Both completion paths release the shared promise. This callback does not
  // consume or rethrow a rejection; each caller observes the original error.
  void pending.then(release, release);
  return pending;
}
