import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createDesktopDeviceProfileMiddleware} from "../system/adapters/desktop/device-profile-host.mjs";
import {createNativeDeviceProfile} from "../system/adapters/native/device-profile.mjs";

const TOKEN="9".repeat(64);
const PATH="/__ordax/native/device-profile";

async function host(userData,{locked=()=>false}={}){
  const adapter=createDesktopDeviceProfileMiddleware(userData,{token:TOKEN,sessionLocked:locked});
  const server=createServer((req,res)=>adapter.middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(done=>server.listen(0,"127.0.0.1",done));
  const origin="http://127.0.0.1:"+server.address().port;
  const request=(path,options={})=>fetch(origin+path,{...options,headers:{
    "X-OrdaX-Device-Profile-Token":TOKEN,
    ...options.headers,Origin:options.headers?.Origin??origin,
  }});
  return {request,origin,port:()=>createNativeDeviceProfile({fetch:request}),close:async()=>{
    server.closeAllConnections();await new Promise(done=>server.close(done));
  }};
}

test("Windows Native device profile survives restart, reuses Linux identity format, confirms rename",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"ordax-device-profile-"));
  let h;
  try{
    h=await host(directory);
    assert.equal((await fetch(h.origin+PATH)).status,401);
    assert.equal((await h.request(PATH,{headers:{"X-OrdaX-Device-Profile-Token":"a".repeat(64)}})).status,401);
    const port=await h.port();
    const first=port.getSnapshot();
    assert.equal(first.schema,"ordax.device-profile/1");
    assert.match(first.devicePublicId,/^ordax-[0-9a-f]{32}$/);
    assert.equal(first.displayName,"Meu OrdaX");
    assert.equal((await port.rename("  OrdaX   Desenvolvimento ")).displayName,"OrdaX Desenvolvimento");
    assert.equal(port.getSnapshot().displayName,"OrdaX Desenvolvimento");
    const raw=await readFile(join(directory,"desktop-device-profile.json"),"utf8");
    assert.equal(JSON.parse(raw).devicePublicId,first.devicePublicId);
    assert.equal(JSON.parse(raw).displayName,"OrdaX Desenvolvimento");
    await h.close();h=null;
    h=await host(directory);
    const reopened=await h.port();
    assert.deepEqual(reopened.getSnapshot(),port.getSnapshot());
    assert.equal((await h.request(PATH,{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://attacker.example"},body:JSON.stringify({displayName:"attack"})})).status,403);
    assert.equal((await h.request(PATH,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:"Updated",devicePublicId:"fake"})})).status,400);
    assert.equal((await h.request(PATH,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:"   "})})).status,400);
    assert.equal((await h.request(PATH,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:"x".repeat(1300)})})).status,413);
    assert.equal((await (await h.request(PATH)).json()).devicePublicId,first.devicePublicId);
  }finally{if(h)await h.close();await rm(directory,{recursive:true,force:true});}
});

test("Windows device profile refuses locked and damaged data without resetting identity",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"ordax-device-lock-"));
 let h;
 try{
   let locked=false;
   h=await host(directory,{locked:()=>locked});
   const first=(await (await h.request(PATH)).json()).devicePublicId;
   locked=true;
   assert.equal((await h.request(PATH)).status,423);
   assert.equal((await h.request(PATH,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:"Bypass"})})).status,423);
   locked=false;
   await writeFile(join(directory,"desktop-device-profile.json"),"{corrupt","utf8");
   assert.equal((await h.request(PATH)).status,503);
   assert.equal((await h.request(PATH,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:"Do not reset"})})).status,503);
   assert.equal(await readFile(join(directory,"desktop-device-profile.json"),"utf8"),"{corrupt");
   assert.match(first,/^ordax-/);
 }finally{if(h)await h.close();await rm(directory,{recursive:true,force:true});}
});
