// A transport projection of the OS-owned Native Intelligence service.
// No second model, router, Memory, inference client or action executor lives here.
import {randomBytes, timingSafeEqual} from "node:crypto";
import {validateIntelligenceRequest,validateIntelligenceResponse}
  from "../../contracts/intelligence.mjs";
import {NATIVE_INTELLIGENCE_SERVICE_RESPONSE_SCHEMA}
  from "../../services/intelligence/native-service.mjs";

import {
  DESKTOP_INTELLIGENCE_REQUEST_PATH,
  DESKTOP_INTELLIGENCE_COMMAND_PATH,
  DESKTOP_INTELLIGENCE_RESULT_PATH,
  DESKTOP_INTELLIGENCE_REQUEST_SCHEMA,
  DESKTOP_INTELLIGENCE_COMMAND_SCHEMA,
  DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
  DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
} from "../../contracts/desktop-intelligence.mjs";
export {
  DESKTOP_INTELLIGENCE_REQUEST_PATH, DESKTOP_INTELLIGENCE_COMMAND_PATH,
  DESKTOP_INTELLIGENCE_RESULT_PATH, DESKTOP_INTELLIGENCE_REQUEST_SCHEMA,
  DESKTOP_INTELLIGENCE_COMMAND_SCHEMA, DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
  DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
} from "../../contracts/desktop-intelligence.mjs";

const TOKEN=/^[a-f0-9]{64}$/;
const ID=/^[a-f0-9]{32}$/;
const LOOPBACK=new Set(["127.0.0.1","::1","::ffff:127.0.0.1"]);
const COMMAND_WAIT_MS=1300;
const CONSULT_DEADLINE_MS=125000;
function exact(value,keys) {
  return value!==null && typeof value==="object" && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(key=>key in value);
}

export function createDesktopIntelligenceRuntimeBridge({
  reportToken,runtimeToken,isSurfaceReady,now=Date.now,
  randomBytesImpl=randomBytes,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,
}={}) {
  if(!TOKEN.test(reportToken??"") || !TOKEN.test(runtimeToken??"") ||
     reportToken===runtimeToken || typeof isSurfaceReady!=="function" ||
     typeof now!=="function" || typeof randomBytesImpl!=="function")
    throw new TypeError("OrdaX Intelligence requires distinct current Native Surface and Product grants");
  const reporterKey=Buffer.from(reportToken,"hex");
  const productKey=Buffer.from(runtimeToken,"hex");
  let pending=null,waitingPoll=null,disposed=false;

  const reply=(res,status,body)=>{
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    res.end(JSON.stringify(body));
  };
  const authenticated=(req,header,expected)=>{
    const raw=req.headers[header];
    return typeof raw==="string"&&TOKEN.test(raw)&&
      timingSafeEqual(Buffer.from(raw,"hex"),expected);
  };
  const readBody=async(req,limit=35000)=>{
    let size=0;const chunks=[];
    for await(const chunk of req){
      size+=chunk.length;
      if(size>limit)throw new RangeError("Bounded Intelligence request exceeded");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  const settle=(command,status,body)=>{
    if(pending!==command)return false;
    pending=null;
    clearTimeoutImpl(command.timeout);
    command.response.off("close",command.onClose);
    reply(command.response,status,body);
    return true;
  };
  const issueCommand=()=>{
    const command=pending;
    if(!command||command.claimed)return null;
    command.claimed=true;
    return {schema:DESKTOP_INTELLIGENCE_COMMAND_SCHEMA,
      requestId:command.id,request:command.request};
  };

  function middleware(req,res,next){
    const route=String(req.url??"").split("?")[0];
    if(![DESKTOP_INTELLIGENCE_REQUEST_PATH,DESKTOP_INTELLIGENCE_COMMAND_PATH,
      DESKTOP_INTELLIGENCE_RESULT_PATH].includes(route))return next();
    if(disposed||req.url!==route||!LOOPBACK.has(req.socket?.remoteAddress))
      return reply(res,403,{error:"Native Intelligence transport denied"});
    const isProduct=route===DESKTOP_INTELLIGENCE_REQUEST_PATH;
    if(!authenticated(req,isProduct?"x-ordax-product-bridge-token":
      "x-ordax-surface-report-token",isProduct?productKey:reporterKey))
      return reply(res,401,{error:"Current Native grant required"});
    if(isProduct){
      if(req.method!=="POST")return reply(res,405,{error:"Unsupported method"});
      if(!String(req.headers["content-type"]??"").toLowerCase().startsWith("application/json"))
        return reply(res,415,{error:"Expected JSON"});
      if(!isSurfaceReady())return reply(res,503,{error:"Native Surface is not ready"});
      if(pending)return reply(res,409,{error:"Native Intelligence already processing an MCP request"});
      void(async()=>{
        let body;
        try{body=await readBody(req)}
        catch{return reply(res,400,{error:"Invalid bounded Intelligence request"})}
        if(!exact(body,["schema","request"])||
           body.schema!==DESKTOP_INTELLIGENCE_REQUEST_SCHEMA ||
           !exact(body.request,["intent","prompt","context","maxTokens"])||
           !Array.isArray(body.request.context)||body.request.context.length!==0)
          return reply(res,400,{error:"Native Intelligence request contract invalid"});
        let request;
        try{request=validateIntelligenceRequest(body.request)}
        catch{return reply(res,400,{error:"Native Intelligence request contract invalid"})}
        if(pending)return reply(res,409,{error:"Native Intelligence already processing an MCP request"});
        let id;
        try{id=randomBytesImpl(16).toString("hex")}catch{}
        if(!ID.test(id??""))return reply(res,503,{error:"Native Intelligence correlation unavailable"});
        const command={id,request,response:res,claimed:false,timeout:null,onClose:null};
        pending=command;
        command.onClose=()=>{if(pending===command&&!res.writableEnded){
          pending=null;clearTimeoutImpl(command.timeout);
        }};
        res.once("close",command.onClose);
        command.timeout=setTimeoutImpl(()=>settle(command,504,{
          schema:DESKTOP_INTELLIGENCE_REPLY_SCHEMA,requestId:id,
          outcome:"unknown",error:"unavailable",
        }),CONSULT_DEADLINE_MS);
        command.timeout?.unref?.();
        if(waitingPoll)waitingPoll(200,issueCommand());
      })().catch(()=>reply(res,503,{error:"Native Intelligence unavailable"}));
      return;
    }
    if(route===DESKTOP_INTELLIGENCE_COMMAND_PATH){
      if(req.method!=="GET")return reply(res,405,{error:"Unsupported method"});
      const command=issueCommand();
      if(command)return reply(res,200,command);
      if(waitingPoll)return reply(res,204,{state:"busy"});
      let timer=null;
      const onClose=()=>{clearTimeoutImpl(timer);if(waitingPoll===complete)waitingPoll=null};
      const complete=(code,body)=>{onClose();res.off("close",onClose);reply(res,code,body)};
      waitingPoll=complete;res.once("close",onClose);
      timer=setTimeoutImpl(()=>complete(204,{state:"empty"}),COMMAND_WAIT_MS);
      timer?.unref?.();
      return;
    }
    if(req.method!=="POST")return reply(res,405,{error:"Unsupported method"});
    if(!String(req.headers["content-type"]??"").toLowerCase().startsWith("application/json"))
      return reply(res,415,{error:"Expected JSON"});
    void(async()=>{
      let body;
      try{body=await readBody(req,150000)}
      catch{return reply(res,400,{error:"Invalid Native Intelligence result"})}
      if(!exact(body,["schema","requestId","ok","response"])||
         body.schema!==DESKTOP_INTELLIGENCE_RESULT_SCHEMA||
         !ID.test(body.requestId??"")||typeof body.ok!=="boolean")
        return reply(res,400,{error:"Invalid Native Intelligence result"});
      const command=pending;
      if(!command||!command.claimed||command.id!==body.requestId)
        return reply(res,409,{error:"Stale Native Intelligence result"});
      if(body.ok){
        const envelope=body.response;
        if(!exact(envelope,["schema","requestId","context","response"])||
           envelope.schema!==NATIVE_INTELLIGENCE_SERVICE_RESPONSE_SCHEMA||
           envelope.requestId!==command.id)
          return reply(res,400,{error:"Native Intelligence result contract invalid"});
        let answer;
        try{answer=validateIntelligenceResponse(envelope.response)}
        catch{return reply(res,400,{error:"Native Intelligence result contract invalid"})}
        settle(command,200,{schema:DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
          requestId:command.id,outcome:"completed",response:answer});
      }else{
        if(body.response!==null)return reply(res,400,{error:"Invalid Native Intelligence failure"});
        settle(command,503,{schema:DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
          requestId:command.id,outcome:"unknown",error:"unavailable"});
      }
      return reply(res,200,{ok:true});
    })().catch(()=>reply(res,503,{error:"Native Intelligence result unavailable"}));
  }
  return Object.freeze({middleware,dispose(){
    if(disposed)return;disposed=true;
    if(waitingPoll)waitingPoll(503,{error:"Native Intelligence stopped"});
    if(pending)settle(pending,503,{schema:DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
      requestId:pending.id,outcome:"unknown",error:"unavailable"});
  }});
}
