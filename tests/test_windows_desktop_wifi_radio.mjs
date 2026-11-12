import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDesktopWlanMiddleware,readWindowsWlanPresence } from "../system/adapters/desktop/wifi-radio-host.mjs";
import { createDesktopClientDiagnosticsMiddleware } from "../system/adapters/desktop/client-diagnostics-host.mjs";
import { createNativeNetworkManagement } from "../system/adapters/native/network-management.mjs";
import { validateNetworkManagementSnapshot } from "../system/contracts/network-management.mjs";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const networkToken="a".repeat(64),sessionToken="b".repeat(64),diagToken="c".repeat(64);
const uri="/__ordax/native/network-management";

async function host(present,{locked=()=>false,fail=false}={}){
  const dir=await mkdtemp(join(tmpdir(),"ordax-radio-"));
  const diagnostic=createDesktopClientDiagnosticsMiddleware(dir,{
    sessionToken,diagnosticToken:diagToken,networkToken,sourceSha:"f".repeat(40),
  });
  const wlan=createDesktopWlanMiddleware({token:networkToken,sessionLocked:locked,
    readPresence:async()=>{if(fail)throw Error("host probe failure");return present;}});
  const server=createServer((req,res)=>diagnostic.middleware(req,res,()=>
    wlan(req,res,()=>{res.writeHead(404);res.end();})));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const direct=(path,options={})=>fetch(base+path,{...options,headers:{Origin:base,...options.headers}});
  const client={fetch:(path,options={})=>direct(path,{
    ...options,headers:{
      ...options.headers,
      ...(path==="/__ordax/native/session"?{"X-OrdaX-Session-Token":sessionToken}:{}),
    },
  })};
  const stop=async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));await rm(dir,{recursive:true,force:true});};
  return {direct,client,stop};
}
test("canonical network-management/1 represents no WLAN without invented SSID or Wi-Fi",()=>{
  const empty=validateNetworkManagementSnapshot({
    wifiInterface:null,currentSsid:null,savedSsid:null,networks:[],
    unavailableReason:"no-wlan-interface",
  });
  assert.deepEqual(empty,{
    wifiInterface:null,currentSsid:null,savedSsid:null,networks:[],
    unavailableReason:"no-wlan-interface",
  });
  assert.ok(Object.isFrozen(empty));
  assert.throws(()=>validateNetworkManagementSnapshot({wifiInterface:null,networks:[],currentSsid:null,savedSsid:null}),/Absent/);
  assert.throws(()=>validateNetworkManagementSnapshot({wifiInterface:null,networks:[{ssid:"fake"}],currentSsid:null,savedSsid:null,unavailableReason:"no-wlan-interface"}),/Absent/);
  assert.throws(()=>validateNetworkManagementSnapshot({wifiInterface:"wlan0",networks:[],unavailableReason:"no-wlan-interface"}),/wifiInterface/);
  const linux=validateNetworkManagementSnapshot({wifiInterface:"wlan0",currentSsid:"Casa",savedSsid:null,networks:[]});
  assert.equal("unavailableReason" in linux,false);
});
test("host WLAN provider inspects real .NET type 71 without scans, settings or credentials",async()=>{
  let observed;
  const run=async(binary,args,options)=>{observed={binary,args,options};return{stdout:"absent"};};
  assert.equal(await readWindowsWlanPresence({platform:"win32",run}),false);
  assert.equal(observed.binary,"powershell.exe");
  assert.equal(observed.options.timeout,7000);
  assert.match(observed.args.at(-1),/NetworkInterfaceType/);
  assert.match(observed.args.at(-1),/GetAllNetworkInterfaces/);
  assert.doesNotMatch(observed.args.at(-1),/netsh|Connect|Disconnect|Set-NetAdapter|Enable-NetAdapter/);
  assert.equal(await readWindowsWlanPresence({platform:"win32",run:async()=>({stdout:"present"})}),true);
  await assert.rejects(()=>readWindowsWlanPresence({platform:"win32",run:async()=>({stdout:"invalid"})}),/invalid/);
  await assert.rejects(()=>readWindowsWlanPresence({platform:"linux"}),/requires Windows/);
});
test("no WLAN returns real unavailable snapshot, denies localhost and all management writes",async()=>{
  const h=await host(false);
  try {
    assert.equal((await h.direct(uri)).status,403);
    assert.equal((await h.direct(uri,{headers:{"X-OrdaX-Network-Token":"0".repeat(64)}})).status,403);
    const session=await (await h.client.fetch("/__ordax/native/session")).json();
    assert.equal(session.networkToken,networkToken);
    const response=await h.direct(uri,{headers:{"X-OrdaX-Network-Token":session.networkToken}});
    assert.equal(response.status,200);
    assert.equal((await response.json()).unavailableReason,"no-wlan-interface");
    for(const action of ["scan","connect","disconnect","forget","reconnect"]){
      const reply=await h.direct(uri,{method:"POST",headers:{"X-OrdaX-Network-Token":networkToken,
        "Content-Type":"application/json"},body:JSON.stringify({action})});
      assert.equal(reply.status,503,action);
    }
    await assert.rejects(createNativeNetworkManagement(h.client),/no WLAN interface/);
  }finally{await h.stop();}
});
test("real WLAN detected, failed OS API and locked OrdaX session never advertise Wi-Fi controls",async()=>{
  for(const flags of [{present:true},{present:false,fail:true},{present:false,locked:true}]){
    const h=await host(flags.present,{fail:flags.fail,locked:()=>Boolean(flags.locked)});
    try{
      const response=await h.direct(uri,{headers:{"X-OrdaX-Network-Token":networkToken}});
      assert.equal(response.status,flags.locked?423:503);
      assert.equal((await h.direct(uri,{method:"POST",headers:{"X-OrdaX-Network-Token":networkToken},body:"{}"})).status,503);
    }finally{await h.stop();}
  }
});
