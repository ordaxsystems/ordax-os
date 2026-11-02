import test from "node:test";
import assert from "node:assert/strict";
import {
  readMountedDesktopSurfaceApp,
  mountNativeDesktopSurfaceStateReport,
} from "../system/adapters/native/desktop-surface-state-report.mjs";

test("OS native Surface reporter uses the displayed canonical app ID, not the window instance", async () => {
  const payloads=[];
  const subscriptions=[];
  let timerCallback=null,intervalCleared=false,unsubscribed=false;
  let selected="system";
  const root={querySelector(selector){
    assert.match(selector,/data-window-id/);
    return selected ? {dataset:{windowId:"window-instance-18",appId:selected}} : null;
  }};
  const win={
    async fetch(path,opts){
      assert.equal(path,"/__ordax/native/desktop-surface-state");
      assert.equal(opts.method,"POST");
      assert.equal(opts.credentials,"same-origin");
      assert.equal(opts.headers["Content-Type"],"application/json");
      payloads.push(JSON.parse(opts.body));
      return {status:200};
    },
    setInterval(callback,interval){
      assert.equal(interval,5000);
      timerCallback=callback;
      return 42;
    },
    clearInterval(id){
      assert.equal(id,42);
      intervalCleared=true;
    },
  };
  const lifecycle={subscribeRender(fn){
    subscriptions.push(fn);
    return ()=>{unsubscribed=true};
  }};
  const reporter=mountNativeDesktopSurfaceStateReport(win,root,lifecycle);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(payloads[0].activeAppId,"system");
  assert.equal(payloads[0].surfaceReady,true);
  assert.deepEqual(Object.keys(payloads[0]).sort(),[
    "activeAppId","schema","surfaceReady",
  ]);
  selected="settings";
  subscriptions[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(payloads.at(-1).activeAppId,"settings");
  selected="../evil";
  timerCallback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(payloads.at(-1).activeAppId,null);
  const count=payloads.length;
  reporter.dispose();
  reporter.dispose();
  timerCallback();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(payloads.length,count);
  assert.equal(intervalCleared,true);
  assert.equal(unsubscribed,true);
});

test("invalid Native renderer dependencies fail before scheduling a reporter",()=>{
  assert.throws(()=>mountNativeDesktopSurfaceStateReport(null,{},{}));
  assert.equal(readMountedDesktopSurfaceApp(null),null);
});


test("Native Surface command opens through the canonical activation port and confirms visible app",async()=>{
  let active="system",renderListener,actions=[],receipts=[],reports=[],poll=null;
  const command={schema:"ordax.desktop-surface-command/1",
    requestId:"b".repeat(32),appId:"settings"};
  const root={querySelector:()=>({dataset:{
    windowId:"instance-18",appId:active,
  }})};
  const fakeWindow={
    async fetch(path,opts){
      if(path==="/__ordax/native/desktop-surface-state"){
        reports.push(JSON.parse(opts.body));
        return {status:200};
      }
      if(path==="/__ordax/native/desktop-surface-command")
        return {status:200,json:async()=>command};
      if(path==="/__ordax/native/desktop-surface-receipt"){
        receipts.push(JSON.parse(opts.body));
        return {status:200};
      }
      throw Error("unexpected Native endpoint");
    },
    setInterval(callback,ms){
      if(ms===450)poll=callback;
      return ms;
    },
    clearInterval(){},
  };
  const lifecycle={subscribeRender(fn){
    renderListener=fn;
    return ()=>{};
  }};
  const port={publish(value){
    actions.push(value);
    active=value.appId;
    renderListener();
    return value;
  }};
  const reporter=mountNativeDesktopSurfaceStateReport(
    fakeWindow,root,lifecycle,port);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof poll,"function");
  poll();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(actions,[{appId:"settings"}]);
  assert.equal(reports.at(-1).activeAppId,"settings");
  assert.deepEqual(receipts,[{
    schema:"ordax.desktop-surface-command/1",
    requestId:"b".repeat(32),state:"applied",
    activeAppId:"settings",
  }]);
  reporter.dispose();
});

test("Native Surface never confirms unavailable built-in app",async()=>{
  let poll,receipt,activations=0;
  const reporter=mountNativeDesktopSurfaceStateReport({
    async fetch(path,opts){
      if(path.endsWith("desktop-surface-state"))return {status:200};
      if(path.endsWith("desktop-surface-command"))return {status:200,json:async()=>({
        schema:"ordax.desktop-surface-command/1",
        requestId:"e".repeat(32),appId:"store",
      })};
      receipt=JSON.parse(opts.body);
      return {status:200};
    },
    setInterval(fn,ms){if(ms===450)poll=fn;return ms;},
    clearInterval(){},
  },{querySelector:()=>({dataset:{windowId:"win",appId:"system"}})},
  {subscribeRender:()=>()=>{}},
  {publish:()=>{activations++; /* Store not installed in the catalog. */}});
  poll();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(receipt,undefined,"The Surface must not reject a window that may still be rendering");
  poll();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(activations,1,"Do not retry activation while waiting for the Host deadline");
  reporter.dispose();
});

test("Native Surface retries a failed state publication without repeating the app activation",async()=>{
  let activeAppId="system",poll,reportCount=0,failOneReport=true,receiptCount=0;
  const activations=[];
  const command={schema:"ordax.desktop-surface-command/1",
    requestId:"c".repeat(32),appId:"settings"};
  const windowRef={
    async fetch(url,options){
      if(url==="/__ordax/native/desktop-surface-state"){
        reportCount++;
        if(activeAppId==="settings"&&failOneReport){
          failOneReport=false;
          return {status:503};
        }
        return {status:200};
      }
      if(url==="/__ordax/native/desktop-surface-command")
        return {status:200,json:async()=>command};
      if(url==="/__ordax/native/desktop-surface-receipt"){
        receiptCount++;
        const body=JSON.parse(options.body);
        assert.equal(body.activeAppId,"settings");
        assert.equal(body.state,"applied");
        return {status:200};
      }
      throw new Error("Unexpected Native action endpoint");
    },
    setInterval(fn,ms){if(ms===450)poll=fn;return ms;},
    clearInterval(){},
  };
  const root={querySelector:()=>({dataset:{appId:activeAppId,
    windowId:"window-instance",active:"true"}})};
  const reporter=mountNativeDesktopSurfaceStateReport(
    windowRef,root,{subscribeRender:()=>()=>{}},
    {publish({appId}){activations.push(appId);activeAppId=appId;}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reportCount,1);
  poll();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(activations,["settings"]);
  assert.equal(receiptCount,0,
    "Failed Native state upload must never generate a success receipt");
  poll();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(activations,["settings"],
    "Native command retry must not invoke appActivation twice");
  assert.equal(receiptCount,1);
  assert.equal(reportCount,3);
  reporter.dispose();
});

test("Native MCP waits for the displayed app instead of rejecting a delayed render",async()=>{
  let active="system",poll,render,activations=0,reportPosts=0,receipts=0;
  const command={schema:"ordax.desktop-surface-command/1",
    requestId:"a".repeat(32),appId:"settings"};
  const win={
    async fetch(path,opts){
      if(path==="/__ordax/native/desktop-surface-state"){
        reportPosts++;return {status:200};
      }
      if(path==="/__ordax/native/desktop-surface-command")
        return {status:200,json:async()=>command};
      if(path==="/__ordax/native/desktop-surface-receipt"){
        const payload=JSON.parse(opts.body);
        assert.equal(payload.state,"applied");
        assert.equal(payload.activeAppId,"settings");
        receipts++;
        return {status:200};
      }
      throw Error("Unexpected Native endpoint");
    },
    setInterval(fn,ms){if(ms===450)poll=fn;return ms;},
    clearInterval(){},
  };
  const reporter=mountNativeDesktopSurfaceStateReport(win,
    {querySelector:()=>({dataset:{windowId:"current",appId:active}})},
    {subscribeRender(callback){render=callback;return ()=>{};}},
    {publish(value){
      assert.equal(value.appId,"settings");
      activations++;
      // Real appActivation can finish mounting after the transport returns.
    }});
  await new Promise(resolve=>setImmediate(resolve));
  poll();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(activations,1);
  assert.equal(receipts,0,"Never reject or confirm before the app is visible");
  poll();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(activations,1,"A pending command cannot reopen a second window");
  assert.equal(receipts,0);
  active="settings";
  render();
  poll();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(activations,1);
  assert.equal(receipts,1);
  assert.ok(reportPosts>=2);
  reporter.dispose();
});

test("Native MCP does not reopen an already visible app",async()=>{
  let activationCount=0,reportCount=0,receiptCount=0,poll;
  const win={
    async fetch(path,opts){
      if(path==="/__ordax/native/desktop-surface-state"){
        reportCount++;return {status:200};
      }
      if(path==="/__ordax/native/desktop-surface-command")
        return {status:200,json:async()=>({
          schema:"ordax.desktop-surface-command/1",
          requestId:"f".repeat(32),appId:"system",
        })};
      if(path==="/__ordax/native/desktop-surface-receipt"){
        assert.equal(JSON.parse(opts.body).state,"applied");
        receiptCount++;return {status:200};
      }
      throw Error("Unexpected Native endpoint");
    },
    setInterval(fn,ms){if(ms===450)poll=fn;return ms;},
    clearInterval(){},
  };
  const reporter=mountNativeDesktopSurfaceStateReport(win,
    {querySelector:()=>({dataset:{windowId:"already-visible",appId:"system"}})},
    {subscribeRender:()=>()=>{}},
    {publish(){activationCount++}});
  await new Promise(resolve=>setImmediate(resolve));
  poll();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(activationCount,0,"Opening an active app should be idempotent");
  assert.equal(receiptCount,1);
  assert.ok(reportCount>=2,"Receipt requires a report after the request");
  reporter.dispose();
});