// Windows Native client diagnostics, using the same vetted four-field report
// as the Linux Native Host. A localhost process never receives a host session.
// No arbitrary messages, stack traces, secret values or user paths are stored.
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, open, lstat, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

const SHA=/^[0-9a-f]{40}$/;
const TOKEN=/^[0-9a-f]{64}$/;
const STAGE=/^[a-z][a-z0-9.-]{0,63}$/;
const ERROR_NAME=/^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SOURCE=/^(?:|[A-Za-z0-9_.-]+\.mjs:[1-9][0-9]{0,5}:[1-9][0-9]{0,5})$/;
const JOURNAL="desktop-client-diagnostic.json";
const MAX_BODY=512;
const MAX_FILE=1024;

function matchSecret(provided, expected) {
  return typeof provided==="string" && TOKEN.test(provided) &&
    timingSafeEqual(Buffer.from(provided,"hex"),expected);
}
function validatedReport(input, sha) {
  if(!input || typeof input!=="object" || Array.isArray(input) ||
     Object.keys(input).sort().join(",")!=="errorName,source,sourceSha,stage" ||
     input.sourceSha!==sha ||
     typeof input.stage!=="string" || !STAGE.test(input.stage) ||
     typeof input.errorName!=="string" || !ERROR_NAME.test(input.errorName) ||
     typeof input.source!=="string" || !SOURCE.test(input.source)){
    throw TypeError("Invalid Native client diagnostic report");
  }
  return {
    sourceSha:input.sourceSha,stage:input.stage,
    errorName:input.errorName,source:input.source,
    observedEpoch:Math.max(0,Math.floor(Date.now()/1000)),
  };
}
async function assertRegularOrAbsent(file) {
  try {
    const stat=await lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.size<1 || stat.size>MAX_FILE)
      throw Error("Untrusted Desktop diagnostic journal");
    const stored=JSON.parse(await readFile(file,"utf8"));
    const fields=Object.keys(stored??{}).sort().join(",");
    if(fields!=="errorName,observedEpoch,source,sourceSha,stage" ||
       typeof stored.sourceSha!=="string" || !SHA.test(stored.sourceSha) ||
       typeof stored.stage!=="string" || !STAGE.test(stored.stage) ||
       typeof stored.errorName!=="string" || !ERROR_NAME.test(stored.errorName) ||
       typeof stored.source!=="string" || !SOURCE.test(stored.source) ||
       !Number.isSafeInteger(stored.observedEpoch) || stored.observedEpoch<0){
      throw Error("Untrusted Desktop diagnostic journal record");
    }
  } catch(e) {
    if(e?.code==="ENOENT")return;
    throw Error("Untrusted Desktop diagnostic journal");
  }
}
function loopback(ip) {
  return ip==="127.0.0.1" || ip==="::1" || ip==="::ffff:127.0.0.1";
}
export function createDesktopClientDiagnosticsMiddleware(userData,{
  sessionToken,diagnosticToken,sourceSha,networkToken=null,displayToken=null,
}={}) {
  if(typeof userData!=="string" || !userData ||
     !TOKEN.test(sessionToken) || !TOKEN.test(diagnosticToken) ||
     sessionToken===diagnosticToken || !SHA.test(sourceSha) ||
     (networkToken!==null && (!TOKEN.test(networkToken) ||
       [sessionToken,diagnosticToken].includes(networkToken))) ||
     (displayToken!==null && (!TOKEN.test(displayToken) ||
       [sessionToken,diagnosticToken,networkToken].includes(displayToken)))){
    throw TypeError("Verified Desktop source and independent diagnostic grants are required");
  }
  const expectedSession=Buffer.from(sessionToken,"hex");
  const expectedDiagnostic=Buffer.from(diagnosticToken,"hex");
  const file=join(userData,JOURNAL);
  let queue=Promise.resolve();
  const write=async report=>{
    const pending=queue.then(async()=>{
      await mkdir(userData,{recursive:true});
      await assertRegularOrAbsent(file);
      const temp=join(userData,"."+JOURNAL+"."+randomUUID());
      let handle=null;
      try {
        handle=await open(temp,"wx",0o600);
        await handle.writeFile(JSON.stringify(report)+"\n","utf8");
        await handle.sync();
        await handle.close();
        handle=null;
        await rename(temp,file);
      } finally {
        if(handle)await handle.close();
        await unlink(temp).catch(e=>{if(e.code!=="ENOENT")throw e;});
      }
    });
    queue=pending.then(()=>{},()=>{});
    return pending;
  };
  return Object.freeze({
    // Testing/diagnostic readback only: never exposed on HTTP.
    async readLastReport() {
      await queue;
      try {
        await assertRegularOrAbsent(file);
        return JSON.parse(await readFile(file,"utf8"));
      } catch(e) {
        if(e?.code==="ENOENT")return null;
        throw e;
      }
    },
    middleware(req,res,next) {
      const path=String(req.url??"").split("?")[0];
      const isSession=path==="/__ordax/native/session";
      const isReport=path==="/__ordax/native/client-diagnostic";
      if(!isSession && !isReport)return next();
      const respond=(status,data=null)=>{
        res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",
          "X-Content-Type-Options":"nosniff"});
        res.end(data===null?"":JSON.stringify(data));
      };
      if(!loopback(req.socket?.remoteAddress))return respond(403);
      if(req.url!==path)return respond(400);
      if(isSession){
        if(req.method!=="GET")return respond(405);
        if(!matchSecret(req.headers["x-ordax-session-token"],expectedSession))return respond(401);
        // Explicitly omit unrelated power/network/install grants. The other
        // adapters must remain unavailable until Windows owns real services.
        return respond(200,{
          diagnosticToken,...(networkToken===null?{}:{networkToken}),
          ...(displayToken===null?{}:{displayOutputsToken:displayToken}),productMode:"desktop",
          nativeInstallAvailable:false,profileActivationAvailable:false,
          componentSlotReadAvailable:false,supportedActions:[],
        });
      }
      if(req.method!=="POST")return respond(405);
      if(!matchSecret(req.headers["x-ordax-diagnostic-token"],expectedDiagnostic))return respond(403);
      if(req.headers.origin!==`http://${req.headers.host}`)return respond(403);
      if(req.headers["content-type"]!=="application/json")return respond(415);
      void (async()=>{
        let bytes=0;const chunks=[];
        for await(const chunk of req){
          bytes+=chunk.length;
          if(bytes>MAX_BODY)return respond(413);
          chunks.push(chunk);
        }
        let data;
        try { data=JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch{return respond(400);}
        let report;
        try{report=validatedReport(data,sourceSha);}
        catch{return respond(400);}
        await write(report);
        respond(204);
      })().catch(()=>{if(!res.writableEnded)respond(503);});
    },
  });
}
