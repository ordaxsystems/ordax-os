const MAX_TOOL_ARTIFACT_BYTES = 512 * 1024;

function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readNativeToolArtifactSha256(
  windowRef = globalThis.window,
  moduleUrl,
) {
  if (
    !windowRef
    || typeof windowRef.fetch !== "function"
    || typeof windowRef.crypto?.subtle?.digest !== "function"
  ) {
    throw new TypeError("Native tool artifact identity requires fetch and Web Crypto");
  }
  const base = windowRef.location?.href;
  if (typeof base !== "string" || !base) {
    throw new TypeError("Native tool artifact identity requires a host location");
  }
  const url = new URL(moduleUrl, base);
  if (url.origin !== new URL(base).origin) {
    throw new TypeError("Native tool artifact identity must be same-origin");
  }

  const response = await windowRef.fetch(url.href, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`Native tool artifact identity fetch failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength <= 0 || buffer.byteLength > MAX_TOOL_ARTIFACT_BYTES) {
    throw new RangeError("Native tool artifact source size is outside bounds");
  }
  const digest = await windowRef.crypto.subtle.digest("SHA-256", buffer);
  return toHex(new Uint8Array(digest));
}
