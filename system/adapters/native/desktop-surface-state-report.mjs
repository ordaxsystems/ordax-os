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

export function readMountedDesktopSurfaceApp(root) {
  if(typeof root?.querySelector!=="function")return null;
  const selected=root.querySelector('[data-window-id][data-active="true"]:not([hidden])');
  // Surface's window instance ID is not its app ID. Never report it to GPT.
  const id=selected?.dataset?.appId;
  return typeof id==="string"&&ID.test(id)?id:null;
}

export function mountNativeDesktopSurfaceStateReport(windowRef,root,lifecycle,activationPort=null) {
  if(typeof windowRef?.fetch!=="function"||
     typeof windowRef?.setInterval!=="function"||
     typeof windowRef?.clearInterval!=="function"||
     typeof lifecycle?.subscribeRender!=="function"||
     typeof root?.querySelector!=="function"||
     (activationPort!==null&&typeof activationPort?.publish!=="function"))
    throw new TypeError("Mounted Surface and Native activation transport required");
  let disposed=false;
  let pendingReport=null;
  let polling=false;
  let handled=null;
  const report=(force=false)=>{
    if(disposed)return Promise.resolve(false);
    if(pendingReport) {
      return force?pendingReport.then(()=>report()):pendingReport;
    }
    const body={schema:"ordax.desktop-surface-state/1",
      activeAppId:readMountedDesktopSurfaceApp(root),surfaceReady:true};
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
      });
      if(response.status!==200)return;
      const command=await response.json();
      if(!command||command.schema!==SCHEMA||
         !REQUEST_ID.test(command.requestId??"")||
         !NATIVE_APPS.has(command.appId))return;
      if(handled?.id!==command.requestId) {
        // A newly mounted Native window may not yet be visible when publish()
        // returns. Never interpret an in-flight render as an app failure.
        let state="awaiting-render";
        try{
          // The same visible app is already the desired result; no new window.
          if(readMountedDesktopSurfaceApp(root)!==command.appId)
            activationPort.publish({appId:command.appId});
        }catch{state="unavailable"}
        handled={id:command.requestId,appId:command.appId,state};
      }
      if(handled.state==="awaiting-render") {
        // An unavailable app eventually fails under the Host's bounded
        // command deadline. Do not resend appActivation or confirm prematurely.
        if(readMountedDesktopSurfaceApp(root)!==handled.appId)return;
        handled.state="awaiting-report";
      }
      if(handled.state==="awaiting-report") {
        // The Host must accept a post-command presentation report before an
        // "applied" receipt is sent. Retry the report, not appActivation.
        if(readMountedDesktopSurfaceApp(root)!==handled.appId)
          handled.state="unavailable";
        else {
          if(!(await report(true)))return;
          handled.state="applied";
        }
      }
      if(disposed)return;
      const body={schema:SCHEMA,requestId:handled.id,
        state:handled.state,activeAppId:readMountedDesktopSurfaceApp(root)};
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
      windowRef.clearInterval(reportTimer);
      if(commandTimer!==null)windowRef.clearInterval(commandTimer);
      unsubscribe();
    },
  });
}
