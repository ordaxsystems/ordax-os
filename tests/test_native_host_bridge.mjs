import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {
  hasNativeHostBridge,
  NATIVE_HOST_BRIDGE_MAX_MESSAGE_CHARS,
  NATIVE_HOST_BRIDGE_READY_ATTRIBUTE,
  NATIVE_HOST_BRIDGE_READY_VALUE,
  postNativeHostMessage,
} from "../system/adapters/native/host-bridge.mjs";
import { createNativeHostWindow } from "./support/native-host-window.mjs";

test("Native host transport sends bounded JSON to the same trusted window origin", () => {
  const sent = [];
  const { windowRef } = createNativeHostWindow({
    onPostMessage(raw, targetOrigin) {
      sent.push({ payload: JSON.parse(raw), targetOrigin });
    },
  });
  assert.equal(hasNativeHostBridge(windowRef), true);
  assert.equal(postNativeHostMessage(windowRef, { type: "snapshot.request" }), true);
  assert.deepEqual(sent, [{
    payload: { type: "snapshot.request" },
    targetOrigin: "http://127.0.0.1:43177",
  }]);
});

test("Native host transport fails closed without the host-injected readiness marker", () => {
  const { windowRef } = createNativeHostWindow({ ready: false });
  assert.equal(hasNativeHostBridge(windowRef), false);
  assert.throws(() => postNativeHostMessage(windowRef, { type: "snapshot.request" }), /unavailable/);
  const spoofedPublicWindow = createNativeHostWindow({ origin: "https://web.ordax.com.br" }).windowRef;
  assert.equal(hasNativeHostBridge(spoofedPublicWindow), false);
});

test("only same-origin messages from the top-level Surface reach the host handler", async () => {
  const hostSource = await readFile(
    new URL("../system/surface/runtime/ordax_browser_host.py", import.meta.url),
    "utf8",
  );
  const template = hostSource.match(/NATIVE_HOST_BRIDGE_SCRIPT = r"""([\s\S]*?)"""/);
  assert.ok(template, "Native host must define its isolated-world adapter script");
  const origin = "http://127.0.0.1:43177";
  const bridgeScript = template[1]
    .replace("__ORDAX_NATIVE_HOST_ORIGIN__", JSON.stringify(origin))
    .replace("__ORDAX_NATIVE_HOST_BRIDGE_NAME__", JSON.stringify("ordaxBrowser"))
    .replace("__ORDAX_NATIVE_HOST_READY_ATTRIBUTE__", JSON.stringify(NATIVE_HOST_BRIDGE_READY_ATTRIBUTE))
    .replace("__ORDAX_NATIVE_HOST_READY_VALUE__", JSON.stringify(NATIVE_HOST_BRIDGE_READY_VALUE))
    .replace("__ORDAX_NATIVE_HOST_MAX_MESSAGE_CHARS__", String(NATIVE_HOST_BRIDGE_MAX_MESSAGE_CHARS));
  const forwarded = [];
  let receiveMessage;
  const windowRef = {
    location: { origin },
    addEventListener(type, listener) {
      assert.equal(type, "message");
      receiveMessage = listener;
    },
    webkit: { messageHandlers: { ordaxBrowser: {
      postMessage(raw) { forwarded.push(JSON.parse(raw)); },
    } } },
  };
  const attributes = new Map();
  const document = { documentElement: {
    setAttribute(name, value) { attributes.set(name, value); },
  } };
  vm.runInNewContext(bridgeScript, { window: windowRef, document });
  assert.equal(attributes.get(NATIVE_HOST_BRIDGE_READY_ATTRIBUTE), NATIVE_HOST_BRIDGE_READY_VALUE);
  assert.equal(typeof receiveMessage, "function");

  const payload = JSON.stringify({ type: "snapshot.request" });
  receiveMessage({ source: windowRef, origin, data: payload });
  receiveMessage({ source: {}, origin, data: payload });
  receiveMessage({ source: windowRef, origin: "https://attacker.example", data: payload });
  receiveMessage({ source: windowRef, origin, data: "not-json" });
  receiveMessage({ source: windowRef, origin, data: JSON.stringify([]) });
  assert.deepEqual(forwarded, [{ type: "snapshot.request" }]);
});

test("Native host transport rejects non-object and oversized payloads", () => {
  const { windowRef } = createNativeHostWindow();
  assert.throws(() => postNativeHostMessage(windowRef, []), TypeError);
  assert.throws(() => postNativeHostMessage(windowRef, {
    data: "x".repeat(NATIVE_HOST_BRIDGE_MAX_MESSAGE_CHARS),
  }), /transport limit/);
});
