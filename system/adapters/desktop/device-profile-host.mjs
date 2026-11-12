// Windows host implementation of the canonical ordax.device-profile/1 port.
// The identity belongs to this OrdaX installation, not the Windows hostname.
// No identity or rename operation is fabricated by the renderer.
import {randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {mkdir,lstat,readFile,open,rename,unlink} from "node:fs/promises";
import {join} from "node:path";
import {
  DEVICE_PROFILE_SCHEMA,validateDeviceDisplayName,validateDeviceProfile,
} from "../../contracts/device-profile.mjs";

const ENDPOINT="/__ordax/native/device-profile";
const FILENAME="desktop-device-profile.json";
const HEADER="x-ordax-device-profile-token";
const TOKEN=/^[0-9a-f]{64}$/;
const MAX_FILE=1024;
const MAX_BODY=1024;
const isLoopback=ip=>ip==="127.0.0.1"||ip==="::1"||ip==="::ffff:127.0.0.1";

async function regularOrAbsent(file){
  try {
    const info=await lstat(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>MAX_FILE)
      throw Error("Untrusted Desktop device profile");
    return true;
  }catch(error){
    if(error?.code==="ENOENT")return false;
    throw error;
  }
}

export function createDesktopDeviceProfileMiddleware(userData,{
  token,sessionLocked=null,
}={}){
  if(typeof userData!=="string"||!userData||!TOKEN.test(token) ||
    (sessionLocked!==null&&typeof sessionLocked!=="function"))
    throw TypeError("Desktop device profile requires private userData and Electron grant");
  const expected=Buffer.from(token,"hex");
  const file=join(userData,FILENAME);
  let queue=Promise.resolve();
  const serial=fn=>{
    const result=queue.then(fn);
    queue=result.then(()=>{},()=>{});
    return result;
  };
  const persist=async value=>{
    const profile=validateDeviceProfile(value);
    await mkdir(userData,{recursive:true});
    await regularOrAbsent(file);
    const temp=join(userData,"."+FILENAME+"."+randomUUID());
    let handle=null;
    try {
      handle=await open(temp,"wx",0o600);
      await handle.writeFile(JSON.stringify(profile)+"\n","utf8");
      await handle.sync();
      await handle.close();handle=null;
      await rename(temp,file);
    }finally{
      if(handle)await handle.close();
      await unlink(temp).catch(e=>{if(e?.code!=="ENOENT")throw e;});
    }
    return profile;
  };
  const load=async()=>{
    if(!await regularOrAbsent(file)){
      // Exactly the same initial identity shape and naming as Linux Native.
      return persist({
        schema:DEVICE_PROFILE_SCHEMA,
        devicePublicId:"ordax-"+randomBytes(16).toString("hex"),
        displayName:"Meu OrdaX",
      });
    }
    const parsed=JSON.parse(await readFile(file,"utf8"));
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
       Object.keys(parsed).sort().join(",")!=="devicePublicId,displayName,schema")
      throw Error("Desktop device profile has an untrusted shape");
    return validateDeviceProfile(parsed);
  };
  const middleware=(req,res,next)=>{
    const path=String(req.url??"").split("?")[0];
    if(path!==ENDPOINT)return next();
    const respond=(status,body=null)=>{
      res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store",
        "X-Content-Type-Options":"nosniff"});
      res.end(JSON.stringify(body??{error:"Desktop device profile request denied"}));
    };
    const supplied=req.headers[HEADER];
    if(!isLoopback(req.socket?.remoteAddress)||typeof supplied!=="string"||
      !TOKEN.test(supplied)||!timingSafeEqual(expected,Buffer.from(supplied,"hex")))
      return respond(401);
    if(req.url!==path)return respond(400);
    if(req.method!=="GET"&&req.method!=="POST")return respond(405);
    if(req.method==="POST"&&req.headers.origin!==`http://${req.headers.host}`)
      return respond(403);
    if(req.method==="POST"&&req.headers["content-type"]!=="application/json")
      return respond(415);
    void serial(async()=>{
      if(sessionLocked&&await sessionLocked())return {status:423};
      if(req.method==="GET")return {status:200,body:await load()};
      let bytes=0;const chunks=[];
      for await(const chunk of req){
        bytes+=chunk.length;
        if(bytes>MAX_BODY)return {status:413};
        chunks.push(chunk);
      }
      let body;
      try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
      catch{return {status:400};}
      if(!body||typeof body!=="object"||Array.isArray(body)||
         Object.keys(body).join(",")!=="displayName")return {status:400};
      let displayName;
      try{displayName=validateDeviceDisplayName(body.displayName);}
      catch{return {status:400};}
      const current=await load();
      return {status:200,body:await persist({...current,displayName})};
    }).then(result=>respond(result.status,result.body),()=>respond(503));
  };
  return Object.freeze({middleware});
}
