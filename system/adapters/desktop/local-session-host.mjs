// Real Windows implementation of the existing ordax.local-session/1 contract.
// The lock guards the OrdaX Surface session, not the underlying Windows disk.
// A per-launch authorization token belongs exclusively to the Electron host.
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  validateLocalSessionSecret, validateLocalSessionSnapshot,
} from "../../contracts/local-session.mjs";

const scrypt = promisify(scryptCallback);
const SCHEMA = "ordax.desktop-local-session/1";
const FILE = "desktop-local-session.json";
const MAX_BYTES = 1024;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_16 = /^[0-9a-f]{32}$/;
const TOKEN_HEADER = "x-ordax-local-session-token";

function validateRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schema !== SCHEMA ||
      (value.state !== "unlocked" && value.state !== "locked")) {
    throw Error("Untrusted Desktop local session record");
  }
  const empty = value.salt === null && value.verifier === null;
  const configured = typeof value.salt === "string" && HEX_16.test(value.salt) &&
    typeof value.verifier === "string" && HEX_32.test(value.verifier);
  if ((!empty && !configured) || (value.state === "locked" && !configured))
    throw Error("Inconsistent Desktop local credential");
  return { schema: SCHEMA, state: value.state, salt: value.salt, verifier: value.verifier };
}
const initialRecord = () => validateRecord({ schema: SCHEMA, state: "unlocked", salt: null, verifier: null });
const configured = record => record.salt !== null;
function snapshot(record, sessionUnlocked = false) {
  return validateLocalSessionSnapshot({
    state: configured(record) && !sessionUnlocked ? "locked" : "unlocked",
    credentialConfigured: configured(record),
    protectionScope: "surface-session-not-storage-encryption",
  });
}
async function requireRegularOrMissing(file) {
  try {
    const stat=await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
      throw Error("Untrusted Desktop local session file");
    return true;
  } catch(error) {
    if(error?.code==="ENOENT") return false;
    throw error;
  }
}
async function hashSecret(secret, salt) {
  return scrypt(secret, Buffer.from(salt,"hex"), 32, { N:16384, r:8, p:1, maxmem:32*1024*1024 });
}
async function verifySecret(record, secret) {
  const provided=await hashSecret(secret,record.salt);
  return timingSafeEqual(provided,Buffer.from(record.verifier,"hex"));
}
function isLoopback(value) {
  return ["127.0.0.1","::1","::ffff:127.0.0.1"].includes(value);
}

export function createDesktopLocalSessionMiddleware(userData, {token}={}) {
  if(typeof userData!=="string" || !userData || typeof token!=="string" || !HEX_32.test(token))
    throw TypeError("Desktop local session requires a user profile and fresh 256-bit token");
  const expected=Buffer.from(token,"hex");
  const file=join(userData,FILE);
  let queue=Promise.resolve();
  // Serialize all reads and mutations. Corrupted data always fails closed.
  const transaction=operation=>{
    const result=queue.then(operation);
    queue=result.then(()=>{},()=>{});
    return result;
  };
  // The durable record never grants an unlocked session. Only this exact
  // Native host instance can hold the transient successful-PIN decision.
  let sessionUnlocked=false;
  const load=async()=>{
    if(!await requireRegularOrMissing(file))return initialRecord();
    let parsed;
    try { parsed=JSON.parse(await readFile(file,"utf8")); }
    catch { throw Error("Untrusted Desktop local session JSON"); }
    const record=validateRecord(parsed);
    if(configured(record) && record.state==="unlocked"){
      // Upgrade existing development records without discarding the verifier.
      // Refuse service if a durable re-lock cannot be persisted.
      const locked={...record,state:"locked"};
      await persist(locked);
      return locked;
    }
    return record;
  };
  const persist=async record=>{
    await mkdir(userData,{recursive:true});
    await requireRegularOrMissing(file);
    const temporary=join(userData,"."+FILE+"."+randomUUID());
    let handle=null;
    try{
      handle=await open(temporary,"wx",0o600);
      await handle.writeFile(JSON.stringify(validateRecord(record)),"utf8");
      await handle.sync();
      await handle.close();
      handle=null;
      await rename(temporary,file);
    } finally {
      if(handle)await handle.close();
      await unlink(temporary).catch(e=>{if(e?.code!=="ENOENT")throw e;});
    }
  };
  let failures=0,retryAfter=0;
  const action=async(payload)=>{
    if(!payload || typeof payload!=="object" || Array.isArray(payload))
      return {status:400};
    const kind=payload.action;
    const keys=Object.keys(payload).sort().join(",");
    if(!["configure-credential","remove-credential","lock","unlock"].includes(kind) ||
      keys !== (kind==="lock"?"action":"action,secret"))
      return {status:400};
    let secret;
    if(kind!=="lock"){
      try {secret=validateLocalSessionSecret(payload.secret);}catch{return {status:400};}
    }
    const record=await load();
    if(kind==="configure-credential"){
      if(configured(record) || record.state==="locked")return {status:409};
      const salt=randomBytes(16).toString("hex");
      const verifier=(await hashSecret(secret,salt)).toString("hex");
      const next={schema:SCHEMA,state:"locked",salt,verifier};
      await persist(next);
      sessionUnlocked=true;
      failures=0;retryAfter=0;
      return {status:200,data:snapshot(next,sessionUnlocked)};
    }
    if(!configured(record))return {status:409};
    if(kind==="lock"){
      // No disk mutation: the saved credential is already fail-closed.
      sessionUnlocked=false;
      return {status:200,data:snapshot(record,sessionUnlocked)};
    }
    if(kind==="remove-credential" && !sessionUnlocked)return {status:423};
    if(Date.now()<retryAfter)return {status:429};
    if(!await verifySecret(record,secret)){
      failures=Math.min(8,failures+1);
      retryAfter=Date.now()+Math.min(30000,(2**Math.min(5,failures)-1)*1000);
      return {status:401};
    }
    if(kind==="unlock"){
      sessionUnlocked=true;
      failures=0;retryAfter=0;
      return {status:200,data:snapshot(record,sessionUnlocked)};
    }
    const next=initialRecord();
    await persist(next);
    sessionUnlocked=false;
    failures=0;retryAfter=0;
    return {status:200,data:snapshot(next,sessionUnlocked)};
  };
  const middleware=(req,res,next)=>{
    const path=String(req.url??"").split("?")[0];
    if(path!=="/__ordax/native/local-session")return next();
    const claimed=req.headers[TOKEN_HEADER];
    const bytes=typeof claimed==="string" && HEX_32.test(claimed)?Buffer.from(claimed,"hex"):null;
    const reply=(status,data=null)=>{
      res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
      res.end(JSON.stringify(data??{error:status===401?"Desktop session authorization required":"Desktop local session unavailable"}));
    };
    if(!isLoopback(req.socket?.remoteAddress) || !bytes ||
       !timingSafeEqual(expected,bytes))return reply(401);
    if(req.url!==path)return reply(400);
    if(req.method==="GET"){
      void transaction(async()=>snapshot(await load(),sessionUnlocked)).then(data=>reply(200,data),()=>reply(503));
      return;
    }
    if(req.method!=="POST")return reply(405);
    if(req.headers.origin!==`http://${req.headers.host}`)return reply(403);
    if(!String(req.headers["content-type"]??"").startsWith("application/json"))return reply(415);
    void transaction(async()=>{
      let total=0;const chunks=[];
      for await(const chunk of req){
        total+=chunk.length;
        if(total>2048)return {status:413};
        chunks.push(chunk);
      }
      let payload;
      try{payload=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
      catch{return {status:400};}
      return action(payload);
    }).then(result=>reply(result.status,result.data),()=>reply(503));
  };
  return Object.freeze({middleware,readLocked:()=>transaction(async()=>configured(await load()) && !sessionUnlocked)});
}
