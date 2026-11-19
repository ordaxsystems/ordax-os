// The OS Native Host is the sole authority for the Surface/Runtime channel.
// This bridge never exposes Windows automation or direct app implementation.
import {randomBytes,timingSafeEqual} from "node:crypto";

export const DESKTOP_SURFACE_BRIDGE_PATH = "/__ordax/native/desktop-surface-state";
export const DESKTOP_SURFACE_COMMAND_PATH = "/__ordax/native/desktop-surface-command";
export const DESKTOP_SURFACE_RECEIPT_PATH = "/__ordax/native/desktop-surface-receipt";
export const DESKTOP_PROJECT_LINKS_PATH = "/__ordax/native/desktop-project-links";
const TOKEN = /^[0-9a-f]{64}$/;
const APP_ID = /^[a-z][a-z0-9-]{0,63}$/;
const REQUEST_ID = /^[0-9a-f]{32}$/;
const LOCAL_PROJECT_ID = /^project-[1-9][0-9]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALLOWED_NATIVE_APPS = new Set(["account","settings","system","store"]);
const LOOPBACK = new Set(["127.0.0.1","::1","::ffff:127.0.0.1"]);
const MAX_REPORT_BYTES = 512;
const MAX_PROJECT_LINKS_BYTES = 16 * 1024;
const MAX_PROJECT_LINKS = 32;
const MAX_COMMAND_BYTES = 256;
const MAX_AGE_MS = 15000;
const COMMAND_DEADLINE_MS = 4500;
const COMMAND_WAIT_MS = 1800; // Authenticated local-only command notification.
const SCHEMA = "ordax.desktop-surface-state/1";
const COMMAND_SCHEMA = "ordax.desktop-surface-command/1";
const PROJECT_LINKS_SCHEMA = "ordax.desktop-project-links/1";

export function createDesktopSurfaceRuntimeBridge({
  reportToken,runtimeToken,now=Date.now,onFirstReport=()=>{},
  onFirstCommandPoll=()=>{},
}={}){
  if(!TOKEN.test(reportToken??"")||!TOKEN.test(runtimeToken??"")||
     reportToken===runtimeToken||typeof now!=="function"||
     typeof onFirstReport!=="function"||typeof onFirstCommandPoll!=="function")
    throw new TypeError("Distinct per-launch Surface and Product grants required");
  const reportKey=Buffer.from(reportToken,"hex");
  const runtimeKey=Buffer.from(runtimeToken,"hex");
  let current=null;
  let receivedAt=0;
  let acceptedReportRevision=0;
  let currentProjectLinks=null;
  let projectLinksReceivedAt=0;
  let pending=null;
  let commandPollAuthenticated=false;
  let waitingCommandPoll=null;
  const reply=(response,code,data)=>{
    if(response.writableEnded||response.destroyed)return;
    response.writeHead(code,{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      "X-Content-Type-Options":"nosniff",
    });
    response.end(JSON.stringify(data));
  };
  const auth=(request,header,key)=>{
    const value=request.headers[header];
    return typeof value==="string"&&TOKEN.test(value)&&
      timingSafeEqual(key,Buffer.from(value,"hex"));
  };
  const fresh=()=>current&&(now()-receivedAt>=0)&&(now()-receivedAt<=MAX_AGE_MS);
  const freshProjectLinks=()=>currentProjectLinks&&
    (now()-projectLinksReceivedAt>=0)&&(now()-projectLinksReceivedAt<=MAX_AGE_MS);
  const readBody=async(request,maxBytes)=>{
    let size=0;
    const chunks=[];
    for await(const chunk of request){
      size+=chunk.length;
      if(size>maxBytes)return {error:413};
      chunks.push(chunk);
    }
    let data=null;
    try{data=JSON.parse(Buffer.concat(chunks).toString("utf8"))}catch{return {error:400}}
    return {data};
  };
  const jsonContent=request=>String(request.headers["content-type"]??"")
    .toLowerCase().startsWith("application/json");
  const strict=(data,schema,keys)=>data&&typeof data==="object"&&
    !Array.isArray(data)&&data.schema===schema&&
    Object.keys(data).every(k=>keys.includes(k));
  const exact=(data,schema,keys)=>strict(data,schema,keys)&&
    Object.keys(data).length===keys.length&&keys.every(key=>key in data);
  const validatedProjectLinks=(data)=>{
    if(!exact(data,PROJECT_LINKS_SCHEMA,["schema","persistence","links"])||
       !["device","session"].includes(data.persistence)||
       !Array.isArray(data.links)||data.links.length>MAX_PROJECT_LINKS)
      return null;
    // Session-backed links are never Runtime authority. The renderer may only
    // use this form to withdraw a previously durable projection immediately.
    if(data.persistence==="session")
      return data.links.length===0?Object.freeze({persistence:"session",links:[]}):null;
    const localIds=new Set(),cloudIds=new Set(),links=[];
    for(const raw of data.links){
      if(!raw||typeof raw!=="object"||Array.isArray(raw)||
         Object.keys(raw).length!==3||
         !["localProjectId","cloudProjectId","spaceId"].every(key=>key in raw)||
         !LOCAL_PROJECT_ID.test(raw.localProjectId??"")||
         !UUID.test(raw.cloudProjectId??"")||!UUID.test(raw.spaceId??"")||
         localIds.has(raw.localProjectId)||cloudIds.has(raw.cloudProjectId))
        return null;
      localIds.add(raw.localProjectId);cloudIds.add(raw.cloudProjectId);
      links.push(Object.freeze({
        localProjectId:raw.localProjectId,
        cloudProjectId:raw.cloudProjectId,
        spaceId:raw.spaceId,
      }));
    }
    return Object.freeze({persistence:"device",links:Object.freeze(links)});
  };

  function middleware(request,response,next){
    const route=(request.url??"").split("?")[0];
    if(![DESKTOP_SURFACE_BRIDGE_PATH,DESKTOP_SURFACE_COMMAND_PATH,
      DESKTOP_SURFACE_RECEIPT_PATH,DESKTOP_PROJECT_LINKS_PATH].includes(route))
      return next();
    if(request.url!==route||!LOOPBACK.has(request.socket?.remoteAddress))
      return reply(response,403,{error:"Native Surface bridge denied"});
    if(route===DESKTOP_SURFACE_BRIDGE_PATH){
      if(request.method==="GET"){
        if(!auth(request,"x-ordax-product-bridge-token",runtimeKey))
          return reply(response,401,{error:"Product Runtime grant required"});
        if(!fresh())return reply(response,503,{error:"Surface has no recent verified presentation"});
        return reply(response,200,{...current,ageMs:now()-receivedAt});
      }
      if(request.method!=="POST")
        return reply(response,405,{error:"Unsupported Surface bridge method"});
      if(!auth(request,"x-ordax-surface-report-token",reportKey))
        return reply(response,401,{error:"Surface reporter grant required"});
      if(!jsonContent(request))return reply(response,415,{error:"Expected JSON"});
      void(async()=>{
        const {data,error}=await readBody(request,MAX_REPORT_BYTES);
        if(error)return reply(response,error,{error:"Invalid Surface report"});
        if(!strict(data,SCHEMA,["schema","activeAppId","surfaceReady"])||
          data.surfaceReady!==true||
          !(data.activeAppId===null||
            typeof data.activeAppId==="string"&&APP_ID.test(data.activeAppId)))
          return reply(response,400,{error:"Invalid Surface report"});
        current=Object.freeze({schema:SCHEMA,host:"ordax-desktop",
          surfaceReady:true,activeAppId:data.activeAppId});
        const first=receivedAt===0;
        receivedAt=now();
        acceptedReportRevision++;
        if(first)try{onFirstReport()}catch{}
        reply(response,200,{ok:true});
      })().catch(()=>reply(response,503,{error:"Surface report unavailable"}));
      return;
    }
    if(route===DESKTOP_PROJECT_LINKS_PATH){
      if(request.method==="GET"){
        if(!auth(request,"x-ordax-product-bridge-token",runtimeKey))
          return reply(response,401,{error:"Product Runtime grant required"});
        if(!freshProjectLinks())
          return reply(response,503,{error:"Durable Project links unavailable"});
        return reply(response,200,currentProjectLinks);
      }
      if(request.method!=="POST")
        return reply(response,405,{error:"Unsupported Project links bridge method"});
      if(!auth(request,"x-ordax-surface-report-token",reportKey))
        return reply(response,401,{error:"Surface reporter grant required"});
      if(!jsonContent(request))return reply(response,415,{error:"Expected JSON"});
      void(async()=>{
        const {data,error}=await readBody(request,MAX_PROJECT_LINKS_BYTES);
        if(error)return reply(response,error,{error:"Invalid Project links report"});
        const accepted=validatedProjectLinks(data);
        if(!accepted)return reply(response,400,{error:"Invalid Project links report"});
        if(accepted.persistence!=="device"){
          currentProjectLinks=null;
          projectLinksReceivedAt=0;
          return reply(response,200,{ok:true,state:"withdrawn"});
        }
        currentProjectLinks=Object.freeze({
          schema:PROJECT_LINKS_SCHEMA,host:"ordax-desktop",
          persistence:"device",links:accepted.links,
        });
        projectLinksReceivedAt=now();
        return reply(response,200,{ok:true,state:"published"});
      })().catch(()=>reply(response,503,{error:"Project links report unavailable"}));
      return;
    }
    if(route===DESKTOP_SURFACE_COMMAND_PATH&&request.method==="GET"){
      if(!auth(request,"x-ordax-surface-report-token",reportKey))
        return reply(response,401,{error:"Surface reporter grant required"});
      if(!commandPollAuthenticated){
        commandPollAuthenticated=true;
        try{onFirstCommandPoll()}catch{}
      }
      if(!pending){
        // Only the authenticated Surface may opt into a bounded wait.
        // Keep legacy non-waiting clients compatible and allow at most one
        // parked response: polling never creates another queue or authority.
        if(request.headers["x-ordax-native-command-wait"]!=="1"||
           waitingCommandPoll)return reply(response,204,{state:"empty"});
        let timer=null;
        const onClose=()=>{
          clearTimeout(timer);
          if(waitingCommandPoll===complete)waitingCommandPoll=null;
        };
        const complete=(code,data)=>{
          onClose();
          response.off("close",onClose);
          reply(response,code,data);
        };
        waitingCommandPoll=complete;
        response.once("close",onClose);
        timer=setTimeout(()=>complete(204,{state:"empty"}),COMMAND_WAIT_MS);
        timer.unref?.();
        return;
      }
      return reply(response,200,{schema:COMMAND_SCHEMA,
        requestId:pending.id,appId:pending.appId});
    }
    if(route===DESKTOP_SURFACE_COMMAND_PATH&&request.method==="POST"){
      if(!auth(request,"x-ordax-product-bridge-token",runtimeKey))
        return reply(response,401,{error:"Product Runtime grant required"});
      if(!jsonContent(request))return reply(response,415,{error:"Expected JSON"});
      void(async()=>{
        const {data,error}=await readBody(request,MAX_COMMAND_BYTES);
        if(error)return reply(response,error,{error:"Invalid Native command"});
        if(!strict(data,COMMAND_SCHEMA,["schema","appId"])||
          !ALLOWED_NATIVE_APPS.has(data.appId))
          return reply(response,400,{error:"Native app target not permitted"});
        if(!fresh())return reply(response,503,{error:"Surface not ready"});
        if(pending)return reply(response,409,{error:"Native command already pending"});
        const id=randomBytes(16).toString("hex");
        const command={id,appId:data.appId,
          startingReportRevision:acceptedReportRevision,settle:null};
        pending=command;
        // Wake the single authenticated renderer poll immediately; this is
        // only an in-process hint. The canonical command still requires the
        // visible-app report and matching receipt before success.
        if(waitingCommandPoll)waitingCommandPoll(200,{
          schema:COMMAND_SCHEMA,requestId:command.id,appId:command.appId,
        });
        const timer=setTimeout(()=>{
          if(pending!==command)return;
          pending=null;
          reply(response,504,{error:"Surface did not confirm Native activation",
            requestId:id});
        },COMMAND_DEADLINE_MS);
        timer.unref?.();
        command.settle=(result)=>{
          if(pending!==command)return;
          clearTimeout(timer);
          pending=null;
          reply(response,result==="applied"?200:409,{
            schema:COMMAND_SCHEMA,requestId:id,appId:command.appId,
            state:result,activeAppId:current?.activeAppId??null,
          });
        };
      })().catch(()=>reply(response,503,{error:"Native action unavailable"}));
      return;
    }
    if(route===DESKTOP_SURFACE_RECEIPT_PATH&&request.method==="POST"){
      if(!auth(request,"x-ordax-surface-report-token",reportKey))
        return reply(response,401,{error:"Surface reporter grant required"});
      if(!jsonContent(request))return reply(response,415,{error:"Expected JSON"});
      void(async()=>{
        const {data,error}=await readBody(request,MAX_COMMAND_BYTES);
        if(error)return reply(response,error,{error:"Invalid Native receipt"});
        if(!strict(data,COMMAND_SCHEMA,["schema","requestId","state","activeAppId"])||
          !REQUEST_ID.test(data.requestId??"")||
          !["applied","unavailable"].includes(data.state)||
          !(data.activeAppId===null||
            typeof data.activeAppId==="string"&&APP_ID.test(data.activeAppId)))
          return reply(response,400,{error:"Invalid Native receipt"});
        const command=pending;
        if(!command||command.id!==data.requestId)
          return reply(response,409,{error:"Stale Native receipt"});
        if(data.state==="applied"&&(!fresh()||
          current.activeAppId!==command.appId||
          data.activeAppId!==command.appId||
          // A timestamp can equal the command time within the same millisecond.
          // Only a newly accepted renderer report can authorize this receipt.
          acceptedReportRevision<=command.startingReportRevision))
          return reply(response,409,{error:"Native activation was not observed"});
        reply(response,200,{ok:true});
        command.settle(data.state);
      })().catch(()=>reply(response,503,{error:"Native receipt unavailable"}));
      return;
    }
    return reply(response,405,{error:"Unsupported Native Surface method"});
  }
  return Object.freeze({middleware});
}
