// UI render observers are independent, but none can claim host health.
// A failed optional view must not prevent other subscribed Native views from
// observing the same committed Surface state.
export function notifySurfaceRenderObservers(observers, reportError) {
  if (typeof reportError !== "function") {
    throw new TypeError("Render observer error reporter required");
  }
  for (const observer of [...observers]) {
    try { observer(); }
    catch (error) { reportError(error); }
  }
}

// A Native state change may already have installed a real window when one
// core renderer fails. Notify independent controllers before preserving that
// original failure for the caller; no presentation success is fabricated.
export function renderWithObserverRecovery(render, onFailure) {
  if (typeof render !== "function" || typeof onFailure !== "function") {
    throw new TypeError("Surface render recovery requires both callbacks");
  }
  try { return render(); }
  catch (error) {
    try { onFailure(error); }
    finally { throw error; }
  }
}
