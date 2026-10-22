import {
  DISPLAY_OUTPUTS_SCHEMA,
  assertDisplayOutputsPort,
  validateDisplayOutputsSnapshot,
} from "../../contracts/display-outputs.mjs";

const SESSION_ENDPOINT = "/__ordax/native/session";
const DISPLAY_ENDPOINT = "/__ordax/native/display-outputs";
const TOKEN_HEADER = "X-OrdaX-Display-Token";

async function readDisplayToken(windowRef) {
  const response = await windowRef.fetch(SESSION_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Native display session failed: ${response.status}`);
  const payload = await response.json();
  if (typeof payload.displayOutputsToken !== "string" || payload.displayOutputsToken.length < 16) {
    throw new Error("Native display token is unavailable");
  }
  return payload.displayOutputsToken;
}

export async function createNativeDisplayOutputs(windowRef = globalThis.window) {
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
  await port.read();
  return Object.freeze(port);
}
