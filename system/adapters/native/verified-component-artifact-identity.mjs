import { nativeComponentSurfaceOrigin } from "./component-slot-origin.mjs";

const COMPONENT_MODULE_PREFIX = "/__ordax/native/component-module/";
const MAX_PROVIDER_MODULE_BYTES = 1024 * 1024;

function canonicalModuleUrl(value, origin) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new TypeError("Verified component artifact URL is invalid");
  }
  const url = new URL(value);
  if (
    url.origin !== origin
    || url.username
    || url.password
    || url.search
    || url.hash
    || !url.pathname.startsWith(COMPONENT_MODULE_PREFIX)
  ) {
    throw new TypeError("Verified component artifact URL escaped the verified module namespace");
  }
  return url.href;
}

function readContentLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (raw == null || raw === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) {
    throw new TypeError("Verified component artifact Content-Length is invalid");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("Verified component artifact Content-Length is invalid");
  }
  return value;
}

function hexDigest(value) {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createNativeVerifiedComponentArtifactIdentity(
  windowRef = globalThis.window,
) {
  const origin = nativeComponentSurfaceOrigin(windowRef);
  if (typeof windowRef?.fetch !== "function") {
    throw new TypeError("Verified component artifact identity requires window.fetch");
  }

  return async function verifiedComponentArtifactIdentity(urlValue) {
    const url = canonicalModuleUrl(urlValue, origin);
    const subtle = windowRef.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== "function") {
      throw new Error("Verified component artifact identity requires Web Crypto SHA-256");
    }

    const response = await windowRef.fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    if (!response || typeof response.ok !== "boolean" || !response.ok) {
      throw new Error(
        `Verified component artifact unavailable: HTTP ${response?.status ?? "unknown"}`,
      );
    }

    const contentLength = readContentLength(response);
    if (contentLength !== null && contentLength > MAX_PROVIDER_MODULE_BYTES) {
      throw new Error("Verified component artifact exceeds the bounded module size");
    }
    if (typeof response.arrayBuffer !== "function") {
      throw new TypeError("Verified component artifact response must implement arrayBuffer()");
    }

    const bytes = await response.arrayBuffer();
    if (
      !bytes
      || typeof bytes.byteLength !== "number"
      || bytes.byteLength > MAX_PROVIDER_MODULE_BYTES
    ) {
      throw new Error("Verified component artifact exceeds the bounded module size");
    }

    return hexDigest(await subtle.digest("SHA-256", bytes));
  };
}
