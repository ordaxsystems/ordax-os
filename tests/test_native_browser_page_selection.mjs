import assert from "node:assert/strict";
import test from "node:test";
import { createNativeBrowserPageSelection } from "../system/adapters/native/browser-page-selection.mjs";
import { BROWSER_PAGE_SELECTION_SCHEMA } from "../system/contracts/browser-page-selection.mjs";

const sample = {
  schema: BROWSER_PAGE_SELECTION_SCHEMA,
  kind: "selection",
  source: "untrusted-web-content",
  tabId: "tab-1",
  url: "https://example.org/page",
  title: "Title",
  text: "Highlighted content",
  truncated: false,
};

function fakeNativeWindow() {
  const events = new Map();
  const messages = [];
  const timers = new Map();
  let timerId = 0;
  return {
    messages, events, timers,
    webkit: {messageHandlers: {ordaxBrowser:{postMessage(value){messages.push(JSON.parse(value));}}}},
    addEventListener(name, fn){events.set(name,fn);},
    removeEventListener(name, fn){if(events.get(name)===fn)events.delete(name);},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},
    clearTimeout(id){timers.delete(id);},
    emit(payload){events.get("ordax-browser-host")?.({detail:payload});},
  };
}

test("Native capture correlates one-shot request IDs and refuses replay", async () => {
  const windowRef = fakeNativeWindow();
  const port = createNativeBrowserPageSelection(windowRef);
  const capture = port.readSelection("tab-1");
  assert.equal(windowRef.messages.length,1);
  const sent = windowRef.messages[0];
  assert.deepEqual(Object.keys(sent).sort(),["requestId","tabId","type"]);
  assert.equal(sent.type,"page-selection.capture");
  windowRef.emit({type:"page-selection.result",requestId:"unknown",tabId:"tab-1",selection:sample});
  await assert.rejects(port.readSelection("tab-2"),/already pending/);
  windowRef.emit({type:"page-selection.result",requestId:sent.requestId,tabId:"tab-1",selection:sample});
  assert.deepEqual(await capture,sample);
  assert.equal(windowRef.timers.size,0);
  port.dispose();
  assert.equal(windowRef.events.size,0);
});

test("Native page selection rejects wrong tab, untrusted data, and disposal", async () => {
  const w = fakeNativeWindow();
  const port = createNativeBrowserPageSelection(w);
  const capture = port.readSelection("tab-1");
  const id = w.messages[0].requestId;
  w.emit({type:"page-selection.result",requestId:id,tabId:"tab-2",selection:sample});
  w.emit({type:"page-selection.result",requestId:id,tabId:"tab-1",
    selection:{...sample,source:"system"}});
  await assert.rejects(capture,TypeError);
  const inFlight = port.readSelection("tab-1");
  port.dispose();
  await assert.rejects(inFlight,/disposed/);
  await assert.rejects(port.readSelection("tab-1"),/disposed/);
  assert.equal(w.timers.size,0);
});

test("Native page selection remains unavailable without a privileged bridge", () => {
  assert.equal(createNativeBrowserPageSelection({}),null);
  assert.equal(createNativeBrowserPageSelection({webkit:{messageHandlers:{}}}),null);
});
