import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_DOWNLOAD_PORT_SCHEMA,
  validateBrowserDownloadEvent,
  validateBrowserDownloadId,
} from "../system/contracts/browser-download.mjs";
import { createNativeBrowserDownload } from "../system/adapters/native/browser-download.mjs";

const id="download-0123456789abcdef";
function fakeWindow() {
  const listeners=new Map(), messages=[];
  return {
    listeners,messages,
    webkit:{messageHandlers:{ordaxBrowser:{postMessage(value){messages.push(JSON.parse(value));}}}},
    addEventListener(name,listener){listeners.set(name,listener);},
    removeEventListener(name,listener){if(listeners.get(name)===listener)listeners.delete(name);},
    emit(detail){listeners.get("ordax-browser-host")?.({detail});},
  };
}
test("native download requires one typed approval or cancellation from privileged interface", () => {
  const w=fakeWindow(), port=createNativeBrowserDownload(w);
  assert.equal(port.schema,BROWSER_DOWNLOAD_PORT_SCHEMA);
  const entries=[];
  const unsubscribe=port.subscribe(event=>entries.push(event));
  const event={type:"browser-download",id,status:"pending",fileName:"report.pdf"};
  w.emit(event);
  assert.deepEqual(entries,[event]);
  port.approve(id);
  port.cancel(id);
  assert.deepEqual(w.messages,[
    {type:"download.approve",id},
    {type:"download.cancel",id},
  ]);
  assert.throws(()=>port.approve("../../home"),TypeError);
  assert.throws(()=>port.cancel("download-1"),TypeError);
  unsubscribe();
  w.emit({...event,status:"saved"});
  assert.equal(entries.length,1);
  port.dispose();
  assert.equal(w.listeners.size,0);
  assert.equal(port.approve(id),false);
});
test("download event forbids extra metadata, arbitrary names, and unauthorized state", () => {
  const valid={type:"browser-download",id,status:"saved",fileName:"download.bin"};
  assert.deepEqual(validateBrowserDownloadEvent(valid),valid);
  assert.equal(Object.isFrozen(validateBrowserDownloadEvent(valid)),true);
  assert.equal(validateBrowserDownloadId(id),id);
  for(const candidate of [
    {...valid,status:"executed"},{...valid,type:"file-import"},
    {...valid,fileName:"../bad"},{...valid,fileName:"file\\name"},
    {...valid,fileName:".gitignore"},{...valid,fileName:"a".repeat(121)},
    {...valid,id:"download-abcd"},{...valid,url:"https://private.example"},
    {...valid,path:"/etc/passwd"}, {...valid,fileName:""},
  ]) assert.throws(()=>validateBrowserDownloadEvent(candidate),TypeError);
});
test("without a Native bridge, Web mode does not advertise downloading", () => {
  assert.equal(createNativeBrowserDownload({}),null);
  assert.equal(createNativeBrowserDownload({webkit:{messageHandlers:{}}}),null);
});
