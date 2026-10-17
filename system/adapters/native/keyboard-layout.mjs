import {
  KEYBOARD_LAYOUT_SCHEMA,
  assertKeyboardLayoutPort,
  validateKeyboardLayoutSnapshot,
} from "../../contracts/keyboard-layout.mjs";

const KEYBOARD_LAYOUT_ENDPOINT = "/__ordax/native/keyboard-layout";
const KEYBOARD_LAYOUT_APPLY_ENDPOINT = "/__ordax/native/keyboard-layout/apply";

export async function createNativeKeyboardLayout(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native keyboard-layout adapter requires window.fetch");
  }

  const request = async (method, body = null, endpoint = KEYBOARD_LAYOUT_ENDPOINT) => {
    const response = await windowRef.fetch(endpoint, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: body === null ? undefined : { "Content-Type": "application/json" },
      body: body === null ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Native keyboard-layout request failed: ${response.status}`);
    }
    return validateKeyboardLayoutSnapshot(await response.json());
  };

  const port = {
    schema: KEYBOARD_LAYOUT_SCHEMA,
    read() {
      return request("GET");
    },
    configure(layoutId) {
      return request("POST", { layoutId });
    },
    apply(layoutId) {
      return request("POST", { layoutId }, KEYBOARD_LAYOUT_APPLY_ENDPOINT);
    },
  };

  assertKeyboardLayoutPort(port);
  await port.read();
  return Object.freeze(port);
}
