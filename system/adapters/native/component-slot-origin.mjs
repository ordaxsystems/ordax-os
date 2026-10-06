export function nativeComponentSurfaceOrigin(windowRef = globalThis.window) {
  const href = windowRef?.location?.href;
  if (typeof href !== "string" || !href) {
    throw new TypeError("Native component source requires window.location.href");
  }
  const location = new URL(href);
  const port = Number(location.port);
  if (
    location.protocol !== "http:"
    || location.hostname !== "127.0.0.1"
    || location.username
    || location.password
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
  ) {
    throw new TypeError("Native component sources require the canonical loopback Surface origin");
  }
  return location.origin;
}
