// OrdaX Desktop peer transport into the SAME composed Intelligence port as Aura.
// All identity, Space, model routing and Memory decisions remain with the OS.
import {createNativeIntelligenceService}
  from "../../services/intelligence/native-service.mjs";
import {
  DESKTOP_INTELLIGENCE_COMMAND_PATH,
  DESKTOP_INTELLIGENCE_RESULT_PATH,
  DESKTOP_INTELLIGENCE_COMMAND_SCHEMA,
  DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
} from "../../contracts/desktop-intelligence.mjs";

const REQUEST_ID=/^[a-f0-9]{32}$/;
const POLL_INTERVAL_MS=500;

export function mountNativeDesktopIntelligenceMcp({
  windowRef,intelligencePort,identitySessionPort,spaceSelectionPort,
}={}) {
  if(typeof windowRef?.fetch!=="function" ||
     typeof windowRef?.setInterval!=="function" ||
     typeof windowRef?.clearInterval!=="function")
    throw new TypeError("Mounted Native Desktop Intelligence transport required");
  const service=createNativeIntelligenceService({
    intelligencePort,identitySessionPort,spaceSelectionPort,
  });
  let disposed=false,polling=false;
  const abort=new AbortController();

  const poll=async()=>{
    if(disposed||polling)return;
    polling=true;
    try{
      const commandResponse=await windowRef.fetch(DESKTOP_INTELLIGENCE_COMMAND_PATH,{
        method:"GET",credentials:"same-origin",cache:"no-store",
        signal:abort.signal,
      });
      if(disposed||commandResponse.status!==200)return;
      const command=await commandResponse.json();
      if(disposed||!command||command.schema!==DESKTOP_INTELLIGENCE_COMMAND_SCHEMA||
         !REQUEST_ID.test(command.requestId??"")||
         !command.request||typeof command.request!=="object")return;
      let response=null,ok=false;
      try{
        // Caller supplies a bounded prompt only; the service reads the current
        // signed-in OS identity and Space before consulting Aura's port.
        response=await service.respondCurrent({
          requestId:command.requestId,request:command.request,
        });
        ok=true;
      }catch{
        // Never claim that inference did not run or retry a model request.
        // The host records the canonical unknown outcome once.
      }
      if(disposed)return;
      await windowRef.fetch(DESKTOP_INTELLIGENCE_RESULT_PATH,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        signal:abort.signal,
        body:JSON.stringify({schema:DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
          requestId:command.requestId,ok,response}),
      });
    }catch{
      // The Host may be absent, locked or restarting. Never synthesize model
      // availability or replay a command after a transport failure.
    }finally{polling=false}
  };
  const timer=windowRef.setInterval(()=>{void poll()},POLL_INTERVAL_MS);
  void poll();
  return Object.freeze({dispose(){
    if(disposed)return;
    disposed=true;
    abort.abort();
    windowRef.clearInterval(timer);
    service.dispose();
  }});
}
