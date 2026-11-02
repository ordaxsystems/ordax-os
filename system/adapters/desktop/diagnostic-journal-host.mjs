// Private, durable Windows device diagnostic journal. This is the Desktop
// implementation of the existing Native diagnostic-journal-store/1 port.
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES,
  validateDiagnosticJournalPayload,
} from "../../contracts/diagnostic-journal-store.mjs";

const ROUTE="/__ordax/native/diagnostic-journal";
const FILE="diagnostic-journal.json";
const TOKEN=/^[0-9a-f]{64}$/;
const MAX_BODY_BYTES=MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES*6+64;
const loopback=address=>["127.0.0.1","::1","::ffff:127.0.0.1"].includes(address);

export function createDesktopDiagnosticJournalMiddleware(directory,{token,sessionLocked=null}={}) {
  if(typeof directory!=="string"||!directory||!TOKEN.test(token))
    throw TypeError("Desktop diagnostic journal needs a private folder and host grant");
  const expected=Buffer.from(token,"hex");
  const file=join(directory,FILE);
  let queue=Promise.resolve();
  const serial=operation=>{
    const result=queue.then(operation);
    queue=result.then(()=>{},()=>{});
    return result;
  };
  const checkRoot=async()=>{
    await mkdir(directory,{recursive:true});
    const root=await lstat(directory);
    if(!root.isDirectory()||root.isSymbolicLink())
      throw Error("Untrusted Desktop journal root");
  };
  const checkFile=async()=>{
    try {
      const stat=await lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||
          stat.size>MAX_DIAGNOSTIC_JOURNAL_PAYLOAD_BYTES)
        throw Error("Untrusted Desktop journal file");
      return true;
    } catch(error) {
      if(error?.code==="ENOENT")return false;
      throw error;
    }
  };
  const read=async()=>{
    await checkRoot();
    if(!await checkFile())return null;
    const data=await readFile(file);
    return validateDiagnosticJournalPayload(new TextDecoder("utf-8",{fatal:true}).decode(data));
  };
  const write=async payload=>{
    await checkRoot();
    await checkFile();
    if(payload===null){
      await unlink(file).catch(error=>{if(error?.code!=="ENOENT")throw error;});
      return;
    }
    const temporary=join(directory,"."+FILE+"."+randomUUID());
    let handle=null;
    try {
      handle=await open(temporary,"wx",0o600);
      await handle.writeFile(payload,"utf8");
      await handle.sync();
      await handle.close();
      handle=null;
      await checkFile();
      await rename(temporary,file);
    } finally {
      if(handle)await handle.close();
      await unlink(temporary).catch(error=>{if(error?.code!=="ENOENT")throw error;});
    }
  };
  return function desktopDiagnosticJournal(req,res,next) {
    const path=String(req.url??"").split("?")[0];
    if(path!==ROUTE)return next();
    const respond=(status,body=null)=>{
      res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff"});
      res.end(body===null?"":JSON.stringify(body));
    };
    if(!loopback(req.socket?.remoteAddress))return respond(403);
    if(req.url!==ROUTE)return respond(400);
    if(req.method!=="GET"&&req.method!=="POST")return respond(405);
    const supplied=req.headers["x-ordax-desktop-state-token"];
    if(typeof supplied!=="string"||!TOKEN.test(supplied)||
        !timingSafeEqual(Buffer.from(supplied,"hex"),expected))return respond(401);
    if(req.method==="POST"&&req.headers.origin!==`http://${req.headers.host}`)
      return respond(403);
    if(req.method==="POST"&&!String(req.headers["content-type"]??"").startsWith("application/json"))
      return respond(415);
    void serial(async()=>{
      if(sessionLocked&&await sessionLocked())return respond(423);
      if(req.method==="GET")return respond(200,{payload:await read()});
      let bytes=0;const parts=[];
      for await(const part of req){
        bytes+=part.length;
        if(bytes>MAX_BODY_BYTES)return respond(413);
        parts.push(part);
      }
      let payload;
      try {
        const body=JSON.parse(Buffer.concat(parts).toString("utf8"));
        if(!body||typeof body!=="object"||Array.isArray(body)||
            Object.keys(body).join(",")!=="payload")return respond(400);
        payload=validateDiagnosticJournalPayload(body.payload);
      } catch(error) {
        return respond(error instanceof TypeError||error instanceof SyntaxError?400:503);
      }
      // The PIN can lock while a client is still streaming the POST body.
      // Authorize again at the persistence boundary, not only at request entry.
      if(sessionLocked&&await sessionLocked())return respond(423);
      await write(payload);
      return respond(200,{saved:true});
    }).catch(()=>{if(!res.writableEnded)respond(503);});
  };
}
