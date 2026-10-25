import {
  NATIVE_HOST_BRIDGE_READY_ATTRIBUTE,
  NATIVE_HOST_BRIDGE_READY_VALUE,
} from "../../system/adapters/native/host-bridge.mjs";

export function createNativeHostWindow({
  onPostMessage = () => {},
  origin = "http://127.0.0.1:43177",
  ready = true,
} = {}) {
  const parsedOrigin = new URL(origin).origin;
  const attributes = new Map();
  if (ready) {
    attributes.set(NATIVE_HOST_BRIDGE_READY_ATTRIBUTE, NATIVE_HOST_BRIDGE_READY_VALUE);
  }
  const windowRef = {
    location: {
      origin: parsedOrigin,
      protocol: new URL(parsedOrigin).protocol,
      hostname: new URL(parsedOrigin).hostname,
    },
    document: {
      documentElement: {
        getAttribute(name) {
          return attributes.get(name) ?? null;
        },
        setAttribute(name, value) {
          attributes.set(name, String(value));
        },
      },
    },
    postMessage(value, targetOrigin) {
      if (targetOrigin !== "*" && targetOrigin !== parsedOrigin) {
        throw new TypeError("Native message target origin does not match");
      }
      onPostMessage(value, targetOrigin);
    },
  };
  return Object.freeze({ windowRef, attributes });
}
