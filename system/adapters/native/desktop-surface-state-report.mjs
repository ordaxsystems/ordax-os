// The Native Surface (not the Windows host) reports its displayed app and
// executes only OS-authorized application activation through the shared port.
const ROUTE = "/__ordax/native/desktop-surface-state";
const COMMAND = "/__ordax/native/desktop-surface-command";
const RECEIPT = "/__ordax/native/desktop-surface-receipt";
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const REQUEST_ID = /^[a-f0-9]{32}$/;
const NATIVE_APPS = new Set(["account","settings","system","store"]);
const REPORT_INTERVAL_MS = 5000;
const COMMAND_POLL_MS = 450;
const SCHEMA = "ordax.desktop-surface-command/1";

export function readMountedDesktopSurfaceApp(lifecycle) {
  // The Surface owns this state. Presentation is a semantic service
  // projection, not a query over HTML, windows or the Windows desktop.
  if(typeof lifecycle?.getActiveAppId!=="function")
    throw new TypeError("Native Surface state port unavailable");
  const id=lifecycle.getActiveAppId();
  if(id===null)return null; // Home with no active application is valid.
  if(typeof id!=="string"||!ID.test(id))
    throw new TypeError("Invalid Native Surface application observation");
  return id;
}

export function mountNativeDesktopSurfaceStateReport(windowRef,lifecycle,activationPort=null) {
  if(typeof windowRef?.fetch!=="function"||
     typeof windowRef?.setInterval!=="function"||
     typeof windowRef?.clearInterval!=="function"||
     typeof lifecycle?.subscribeRender!=="function"||
     typeof lifecycle?.getActiveAppId!=="function"||
     (activationPort!==null&&typeof activationPort?.publish!=="function"))
    throw new TypeError("Mounted Surface and Native activation transport required");
  let disposed=false;
  let pendingReport=null;
  let polling=false;
  let handled=null;
  const commandAbort=new AbortController();
  const report=(force=false)=>{
    if(disposed)return Promise.resolve(false);
    if(pendingReport) {
      return force?pendingReport.then(()=>report()):pendingReport;
    }
    let activeAppId;
    try{activeAppId=readMountedDesktopSurfaceApp(lifecycle)}
    catch{return Promise.resolve(false)}
    const body={schema:"ordax.desktop-surface-state/1",
      activeAppId,surfaceReady:true};
    pendingReport=(async()=>{
      try{
        const response=await windowRef.fetch(ROUTE,{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        return response.status===200;
      }catch{return false}
    })();
    const result=pendingReport;
    void result.finally(()=>{if(pendingReport===result)pendingReport=null});
    return result;
  };

  const poll=async()=>{
    if(disposed||polling||activationPort===null)return;
    polling=true;
    try{
      const response=await windowRef.fetch(COMMAND,{
        method:"GET",credentials:"same-origin",cache:"no-store",
        // Wait on the authenticated Native Host instead of hammering the
        // local bridge every 450ms while no application command is queued.
        headers:{"X-OrdaX-Native-Command-Wait":"1"},
        signal:commandAbort.signal,
      });
      if(disposed||response.status!==200)return;
      const command=await response.json();
      if(disposed||!command||command.schema!==SCHEMA||
         !REQUEST_ID.test(command.requestId??"")||
         !NATIVE_APPS.has(command.appId))return;
      if(handled?.id!==command.requestId) {
        // A newly mounted Native window may not yet be visible when publish()
        // returns. Never interpret an in-flight render as an app failure.
        let state="awaiting-render";
        try{
          // The same visible app is already the desired result; no new window.
          if(readMountedDesktopSurfaceApp(lifecycle)!==command.appId)
            activationPort.publish({appId:command.appId});
        }catch{state="unavailable"}
        handled={id:command.requestId,appId:command.appId,state};
      }
      if(handled.state==="awaiting-render") {
        // An unavailable app eventually fails under the Host's bounded
        // command deadline. Do not resend appActivation or confirm prematurely.
        if(readMountedDesktopSurfaceApp(lifecycle)!==handled.appId)return;
        handled.state="awaiting-report";
      }
      if(handled.state==="awaiting-report") {
        // The Host must accept a post-command presentation report before an
        // "applied" receipt is sent. Retry the report, not appActivation.
        if(readMountedDesktopSurfaceApp(lifecycle)!==handled.appId)
          handled.state="unavailable";
        else {
          if(!(await report(true)))return;
          handled.state="applied";
        }
      }
      if(disposed)return;
      const body={schema:SCHEMA,requestId:handled.id,
        state:handled.state,activeAppId:readMountedDesktopSurfaceApp(lifecycle)};
      const receipt=await windowRef.fetch(RECEIPT,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      });
      if(receipt.status===200)handled=null;
    }catch{
      // Command failures cannot interrupt or falsely acknowledge the UI.
    }finally{polling=false}
  };
  const unsubscribe=lifecycle.subscribeRender(()=>{void report()});
  const reportTimer=windowRef.setInterval(()=>{void report()},REPORT_INTERVAL_MS);
  const commandTimer=activationPort?windowRef.setInterval(()=>{void poll()},COMMAND_POLL_MS):null;
  void report();
  return Object.freeze({
    dispose(){
      if(disposed)return;
      disposed=true;
      commandAbort.abort(); // Free the Host's parked poll immediately.
      windowRef.clearInterval(reportTimer);
      if(commandTimer!==null)windowRef.clearInterval(commandTimer);
      unsubscribe();
    },
  });
}
