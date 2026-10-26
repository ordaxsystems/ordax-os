import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDesktopNativeServer, createDesktopStaticMiddleware } from "./desktop-native-server.mjs";

const tokens={
  ORDAX_DESKTOP_FILE_TOKEN:"a".repeat(64),
  ORDAX_DESKTOP_LOCAL_SESSION_TOKEN:"b".repeat(64),
  ORDAX_DESKTOP_NATIVE_SESSION_TOKEN:"c".repeat(64),
  ORDAX_DESKTOP_DIAGNOSTIC_TOKEN:"d".repeat(64),
  ORDAX_DESKTOP_DEVICE_PROFILE_TOKEN:"e".repeat(64),
  ORDAX_DESKTOP_STATE_TOKEN:"f".repeat(64),
  ORDAX_DESKTOP_NETWORK_TOKEN:"1".repeat(64),
  ORDAX_DESKTOP_OBSERVATION_TOKEN:"2".repeat(64),
  ORDAX_DESKTOP_DISPLAY_TOKEN:"3".repeat(64),
  ORDAX_DESKTOP_RENDERED_SOURCE_SHA:"a".repeat(40),
};

test("standalone installed Native host serves verified bundle and existing privileged routes",async t=>{
  const root=resolve(import.meta.dirname,"../..");
  const dir=mkdtempSync(join(tmpdir(),"ordax-no-vite-"));
  const built=join(dir,"built");
  mkdirSync(join(built,"system","composition","native"),{recursive:true});
  mkdirSync(join(built,"assets"));
  writeFileSync(join(built,"system","composition","native","index.html"),
    "<!doctype html><title>Verified compiled Native</title>");
  writeFileSync(join(built,"assets","index-aBc123.js"),"export const ready = true;");
  const previous={};
  for(const [k,v] of Object.entries({...tokens,
    ORDAX_DESKTOP_HOST:"1",ORDAX_DESKTOP_UPDATE_USER_DATA:dir,
    ORDAX_DESKTOP_ASSETS_ROOT:built})){
    previous[k]=process.env[k];process.env[k]=v;
  }
  t.after(()=>{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    rmSync(dir,{recursive:true,force:true});
  });
  const host=createDesktopNativeServer({root,stateDirectory:join(dir,"state"),
    accountGatewayOrigin:"https://example.invalid"});
  await new Promise(resolve=>host.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>host.close(resolve)));
  const base="http://127.0.0.1:"+host.address().port;
  const html=await fetch(base+"/system/composition/native/index.html");
  assert.equal(html.status,200);
  assert.match(await html.text(),/Verified compiled Native/);
  const js=await fetch(base+"/__ordax/desktop-assets/assets/index-aBc123.js");
  assert.equal(js.status,200);
  assert.match(await js.text(),/ready = true/);
  const contract=await fetch(base+"/system/contracts/network-status.mjs");
  assert.equal(contract.status,200);
  assert.match(await contract.text(),/validateNetworkStatusSnapshot/);
  assert.equal((await fetch(base+"/system/contracts/network-status.mjs",{method:"POST"})).status,405);
  assert.equal((await fetch(base+"/system/services/account/gateway-base-url")).status,404);
  assert.equal((await fetch(base+"/system/contracts/%2e%2e%2fsecret.mjs")).status,404);
  assert.equal((await fetch(base+"/__ordax/native/network-status")).status,401);
  assert.equal((await fetch(base+"/__ordax/native/first-run")).status,401);
  const first=await fetch(base+"/__ordax/native/first-run",{
    headers:{"x-ordax-desktop-state-token":tokens.ORDAX_DESKTOP_STATE_TOKEN}});
  assert.equal(first.status,200);
  assert.equal(typeof(await first.json()).completed,"boolean");
  // A missing Linux service is not fabricated by the standalone host.
  assert.equal((await fetch(base+"/__ordax/native/keyboard-layout")).status,503);
  const recovery=await fetch(base+"/__ordax/desktop/recovery",{
    headers:{"x-ordax-observation-token":tokens.ORDAX_DESKTOP_OBSERVATION_TOKEN}});
  assert.equal(recovery.status,200);
  assert.equal((await recovery.json()).platform,"windows");
});

test("source-only system middleware denies path escapes and unsupported files", async t=>{
  const temp=mkdtempSync(join(tmpdir(),"ordax-native-static-"));
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  mkdirSync(join(temp,"system","contracts"),{recursive:true});
  writeFileSync(join(temp,"system","contracts","proof.json"),'{"ok":true}');
  writeFileSync(join(temp,"system","contracts","private.key"),"DO_NOT_SERVE");
  const middleware=createDesktopStaticMiddleware(temp);
  const server=createServer((req,res)=>middleware(req,res,()=>{
    res.writeHead(418);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base="http://127.0.0.1:"+server.address().port;
  assert.equal((await fetch(base+"/system/contracts/proof.json")).status,200);
  assert.equal((await fetch(base+"/system/contracts/private.key")).status,404);
  assert.equal((await fetch(base+"/system/contracts/.env")).status,404);
  assert.equal((await fetch(base+"/system/contracts/%5c..%5cproof.json")).status,404);
  assert.equal((await fetch(base+"/__ordax/native/update")).status,418);
});

test("installed shell selects standalone Native only for previously verified build",()=>{
  const shell=readFileSync(new URL("../windows-desktop/host.cjs",import.meta.url),"utf8");
  assert.match(shell,/const staticHost=Boolean\(builtAssetsRoot && existsSync\(installedNative\)\)/);
  assert.match(shell,/const entry=staticHost\?installedNative:/);
  assert.match(shell,/http-ready after/);
});
