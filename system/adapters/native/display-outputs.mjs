import { readNativeSession } from "./session-read.mjs";

import {
  DISPLAY_OUTPUTS_SCHEMA,
  assertDisplayOutputsPort,
  validateDisplayOutputsSnapshot,
} from "../../contracts/display-outputs.mjs";


const DISPLAY_ENDPOINT = "/__ordax/native/display-outputs";
const TOKEN_HEADER = "X-OrdaX-Display-Token";

async function readDisplayToken(windowRef) {
  const response = await readNativeSession(windowRef);
  if (!response.ok) throw new Error(`Native display session failed: ${response.status}`);
  const payload = response.payload;
  if (typeof payload.displayOutputsToken !== "string" || payload.displayOutputsToken.length < 16) {
    throw new Error("Native display token is unavailable");
  }
  return payload.displayOutputsToken;
}

export async function createNativeDisplayOutputs(windowRef = globalThis.window, {
  deferInitialRead = false,
} = {}) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native display outputs adapter requires window.fetch");
  }
  const token = await readDisplayToken(windowRef);
  const request = async (method, action = null, payload = {}) => {
    const options = {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { [TOKEN_HEADER]: token },
    };
    if (method === "POST") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ action, ...payload });
    }
    const response = await windowRef.fetch(DISPLAY_ENDPOINT, options);
    if (!response.ok) {
      const error = new Error(`Native display outputs request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return validateDisplayOutputsSnapshot(await response.json());
  };
  const port = {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    read() { return request("GET"); },
    preview(outputId, modeId) { return request("POST", "preview", { outputId, modeId }); },
    confirm(previewId) { return request("POST", "confirm", { previewId }); },
    revert(previewId) { return request("POST", "revert", { previewId }); },
  };
  assertDisplayOutputsPort(port);
  // Linux still proves the provider at bootstrap. Windows has a real,
  // authenticated Win32 provider, but eager enumeration competes with other
  // cold-start Native ports and could permanently discard this port on one
  // transient 503. The Desktop first reads physical modes when the existing
  // Settings controls request them; no cached/fabricated display data.
  if (!deferInitialRead) await port.read();
  return Object.freeze(port);
}
