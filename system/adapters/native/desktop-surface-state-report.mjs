// The Native Surface (not the Windows host) reports its displayed app and
// executes only OS-authorized application activation through the shared port.
import {assertProjectCloudLinksReaderPort,validateProjectCloudLinksSnapshot}
  from "../../contracts/project-cloud-links-reader.mjs";
import {assertProjectCatalogReader,validateProjectCatalogSnapshot}
  from "../../contracts/project-catalog.mjs";

const ROUTE = "/__ordax/native/desktop-surface-state";
const COMMAND = "/__ordax/native/desktop-surface-command";
const RECEIPT = "/__ordax/native/desktop-surface-receipt";
const PROJECT_LINKS = "/__ordax/native/desktop-project-links";
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

export function mountNativeDesktopSurfaceStateReport(
  windowRef,lifecycle,activationPort=null,projectCloudLinksReader=null,
  projectCatalogReader=null,
) {
  if(typeof windowRef?.fetch!=="function"||
     typeof windowRef?.setInterval!=="function"||
     typeof windowRef?.clearInterval!=="function"||
     typeof lifecycle?.subscribeRender!=="function"||
     typeof lifecycle?.getActiveAppId!=="function"||
     (activationPort!==null&&typeof activationPort?.publish!=="function"))
    throw new TypeError("Mounted Surface and Native activation transport required");
  const cloudLinks = projectCloudLinksReader===null
    ? null : assertProjectCloudLinksReaderPort(projectCloudLinksReader);
  const localProjects = projectCatalogReader===null
    ? null : assertProjectCatalogReader(projectCatalogReader);
  if((cloudLinks===null)!==(localProjects===null))
    throw new TypeError("Project links require the Native Project Catalog reader");
  let disposed=false;
  let pendingReport=null;
  let pendingProjectLinksReport=null;
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
  const reportProjectLinks=(force=false)=>{
    if(disposed||cloudLinks===null)return Promise.resolve(false);
    if(pendingProjectLinksReport)
      return force?pendingProjectLinksReport.then(()=>reportProjectLinks())
        :pendingProjectLinksReport;
    let body;
    try{
      const snapshot=validateProjectCloudLinksSnapshot(cloudLinks.getSnapshot());
      const catalog=validateProjectCatalogSnapshot(localProjects.getSnapshot());
      // The canonical Project Catalog, not the model or cloud, owns the path.
      // Join its durable logical path to each explicitly authorized cloud link.
      const durable=snapshot.persistence==="device" && catalog.persistence==="device";
      const paths=new Map(catalog.projects.map(project=>[project.id,project.path]));
      const links=durable?snapshot.links.map(link=>{
        const localProjectPath=paths.get(link.localProjectId);
        if(!localProjectPath)throw new TypeError("Cloud link lacks a local Project Catalog entry");
        return {localProjectId:link.localProjectId,localProjectPath,
          cloudProjectId:link.cloudProjectId,spaceId:link.spaceId};
      }):[];
      body={schema:"ordax.desktop-project-links/1",
        persistence:durable?"device":"session",links};
    }catch{
      // Invalid or session-only local state withdraws prior Runtime authority.
      body={schema:"ordax.desktop-project-links/1",persistence:"session",links:[]};
    }
    pendingProjectLinksReport=(async()=>{
      try{
        const response=await windowRef.fetch(PROJECT_LINKS,{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
        });
        return response.status===200;
      }catch{return false}
    })();
    const result=pendingProjectLinksReport;
    void result.finally(()=>{
      if(pendingProjectLinksReport===result)pendingProjectLinksReport=null;
    });
    return result;
  };

  // The renderer owns completion: a background Electron window can throttle
  // intervals, but a committed render must not wait for the next GET poll to
  // send the verified post-command report and receipt.
  let acknowledging=false;
  const acknowledgeRenderedCommand=async()=>{
    const command=handled;
    if(disposed||!command||acknowledging)return;
    acknowledging=true;
    try{
      if(command.state==="awaiting-render"){
        if(readMountedDesktopSurfaceApp(lifecycle)!==command.appId)return;
        command.state="awaiting-report";
      }
      if(command.state==="awaiting-report"){
        if(readMountedDesktopSurfaceApp(lifecycle)!==command.appId)
          command.state="unavailable";
        else {
          // Only an accepted report *after* this command may authorize success.
          if(!(await report(true)))return;
          if(disposed||handled!==command)return;
          command.state=readMountedDesktopSurfaceApp(lifecycle)===command.appId
            ?"applied":"unavailable";
        }
      }
      if(disposed||handled!==command)return;
      const body={schema:SCHEMA,requestId:command.id,
        state:command.state,activeAppId:readMountedDesktopSurfaceApp(lifecycle)};
      const receipt=await windowRef.fetch(RECEIPT,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      });
      if(receipt.status===200&&handled===command)handled=null;
    }catch{
      // Fail closed. A later render/poll can retry an authoritative receipt.
    }finally{acknowledging=false}
  };
  const poll=async()=>{
    if(disposed||polling||activationPort===null)return;
    polling=true;
    try{
      const response=await windowRef.fetch(COMMAND,{
        method:"GET",credentials:"same-origin",cache:"no-store",
        headers:{"X-OrdaX-Native-Command-Wait":"1"},
        signal:commandAbort.signal,
      });
      if(disposed)return;
      if(response.status!==200){
        // A 204 is an explicit empty Host queue: forget an expired request
        // instead of carrying stale local command state into later work.
        if(response.status===204)handled=null;
        return;
      }
      const command=await response.json();
      if(disposed||!command||command.schema!==SCHEMA||
         !REQUEST_ID.test(command.requestId??"")||
         !NATIVE_APPS.has(command.appId))return;
      if(handled?.id!==command.requestId){
        // Register the request before publish(): render notifications can be
        // synchronous with OS activation and must be able to complete it.
        handled={id:command.requestId,appId:command.appId,state:"awaiting-render"};
        try{
          if(readMountedDesktopSurfaceApp(lifecycle)!==command.appId)
            activationPort.publish({appId:command.appId});
        }catch{
          // A listener may throw after committing a real window to the Surface.
          // Do not reject an in-flight activation based on a publisher error;
          // wait for an authenticated post-command render or the Host deadline.
          // No receipt is sent if the target never becomes visible.
        }
      }
      await acknowledgeRenderedCommand();
    }catch{
      // A failed poll never fabricates a successful app activation.
    }finally{polling=false}
  };
  const unsubscribe=lifecycle.subscribeRender(()=>{
    void report();
    if(handled)void acknowledgeRenderedCommand();
  });
  const unsubscribeProjectLinks=cloudLinks===null?()=>{}:
    cloudLinks.subscribe(()=>{void reportProjectLinks(true)});
  const unsubscribeProjectCatalog=localProjects===null?()=>{}:
    localProjects.subscribe(()=>{void reportProjectLinks(true)});
  const reportTimer=windowRef.setInterval(()=>{
    void report();
    void reportProjectLinks();
  },REPORT_INTERVAL_MS);
  const commandTimer=activationPort?windowRef.setInterval(()=>{void poll()},COMMAND_POLL_MS):null;
  void report();
  void reportProjectLinks();
  return Object.freeze({
    dispose(){
      if(disposed)return;
      disposed=true;
      commandAbort.abort(); // Free the Host's parked poll immediately.
      windowRef.clearInterval(reportTimer);
      if(commandTimer!==null)windowRef.clearInterval(commandTimer);
      unsubscribe();
      unsubscribeProjectLinks();
      unsubscribeProjectCatalog();
    },
  });
}
