import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_PAGE_FIND_PORT_SCHEMA,
  MAX_BROWSER_PAGE_FIND_CHARS,
  validatePageFindQuery,
  validatePageFindResult,
} from "../system/contracts/browser-page-find.mjs";
import { createNativeBrowserPageFind } from "../system/adapters/native/browser-page-find.mjs";

function fakeWindow() {
  const listeners = new Map();
  const commands = [];
  return {
    commands, listeners,
    webkit: {messageHandlers:{ordaxBrowser:{postMessage(payload){commands.push(JSON.parse(payload));}}}},
    addEventListener(name, callback){listeners.set(name,callback);},
    removeEventListener(name, callback){if(listeners.get(name)===callback)listeners.delete(name);},
    emit(detail){listeners.get("ordax-browser-host")?.({detail});},
  };
}

test("native find port sends only typed commands without extracting DOM or credentials", () => {
  const host = fakeWindow();
  const port = createNativeBrowserPageFind(host);
  assert.equal(port.schema, BROWSER_PAGE_FIND_PORT_SCHEMA);
  port.search("tab-1","navegação");
  port.next("tab-1");
  port.previous("tab-1");
  port.finish("tab-1");
  assert.deepEqual(host.commands,[
    {type:"page-find.search",tabId:"tab-1",query:"navegação"},
    {type:"page-find.next",tabId:"tab-1"},
    {type:"page-find.previous",tabId:"tab-1"},
    {type:"page-find.finish",tabId:"tab-1"},
  ]);
  port.dispose();
  assert.equal(host.listeners.size,0);
  assert.equal(port.search("tab-1","later"),false);
});

test("find query rejects controls, invalid ids and overlong content", () => {
  assert.equal(validatePageFindQuery(""), "");
  assert.equal(validatePageFindQuery("x".repeat(MAX_BROWSER_PAGE_FIND_CHARS)).length,
    MAX_BROWSER_PAGE_FIND_CHARS);
  for (const query of ["x".repeat(MAX_BROWSER_PAGE_FIND_CHARS+1),"foo\nbar","a\0b","\t"]) {
    assert.throws(()=>validatePageFindQuery(query),TypeError);
  }
  const host=fakeWindow();
  const port=createNativeBrowserPageFind(host);
  assert.throws(()=>port.search("../escape","abc"),TypeError);
  assert.throws(()=>port.search("tab-1","x".repeat(257)),TypeError);
  assert.deepEqual(host.commands,[]);
  port.dispose();
});

test("find results are bounded, trusted as event metadata only and never document text", () => {
  const h=fakeWindow();
  const port=createNativeBrowserPageFind(h);
  const received=[];
  port.subscribe(value=>received.push(value));
  h.emit({type:"page-find.result",tabId:"tab-1",query:"a",state:"found",count:17});
  h.emit({type:"page-find.result",tabId:"tab-1",query:"a",state:"not-found",count:0});
  h.emit({type:"page-find.result",tabId:"tab-1",query:"a",state:"found",count:1001});
  h.emit({type:"page-find.result",tabId:"tab-1",query:"a",state:"found",count:1,text:"secret"});
  assert.equal(received.length,2);
  assert.ok(Object.isFrozen(received[0]));
  assert.deepEqual(received[0],{tabId:"tab-1",query:"a",state:"found",count:17});
  assert.equal(validatePageFindResult({type:"page-find.result",tabId:"tab-1",query:"a",
    state:"not-found",count:0}).count,0);
  port.dispose();
  h.emit({type:"page-find.result",tabId:"tab-1",query:"a",state:"found",count:2});
  assert.equal(received.length,2);
});

test("Web mode never claims native find capabilities", () => {
  assert.equal(createNativeBrowserPageFind({}),null);
});
