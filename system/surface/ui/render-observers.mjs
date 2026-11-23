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
