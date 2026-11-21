// One presentation-level cancellation boundary for every Aura consumer.
// The canonical Intelligence port owns execution; this only guarantees
// that a non-cooperative provider cannot leave the Surface awaiting forever.
function abortError() {
  const error = new Error("Aura request was cancelled");
  error.name = "AbortError";
  return error;
}

export async function awaitAbortable(start, signal) {
  if (typeof start !== "function")
    throw new TypeError("Aura request must be a callable operation");
  if (signal != null && !(signal instanceof AbortSignal))
    throw new TypeError("Aura request signal must be an AbortSignal");
  // No provider work may begin after a cancelled request.
  if (signal?.aborted) throw abortError();
  if (signal == null) return await start();

  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Start after installing the listener, and observe late rejections even
    // if this presentation has already finished due to cancellation.
    const result = start();
    const answer = await Promise.race([result, cancelled]);
    if (signal.aborted) throw abortError();
    return answer;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// A completed or cancelled presentation must not accept provisional chunks
// from a provider retaining the streaming callback after settlement.
export function createPresentationDeltaGate(consume, signal = null) {
  if (typeof consume !== "function") {
    throw new TypeError("Provisional delta consumer must be a function");
  }
  if (signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("Provisional delta signal must be an AbortSignal");
  }
  let open = true;
  return Object.freeze({
    async onDelta(delta) {
      if (!open || signal?.aborted) return;
      await consume(delta);
    },
    close() { open = false; },
  });
}
