import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createDesktopClientDiagnosticsMiddleware} from "../system/adapters/desktop/client-diagnostics-host.mjs";
import {
  projectWindowsDisplayCurrentModes,
  readWindowsDisplayCurrentModes,
  createDesktopDisplayCurrentModeMiddleware,
} from "../system/adapters/desktop/display-current-mode-host.mjs";
import {DISPLAY_OUTPUTS_SCHEMA,validateDisplayOutputsSnapshot} from "../system/contracts/display-outputs.mjs";

const DISPLAY1=String.fromCharCode(92,92,46,92)+"DISPLAY1";
const DISPLAY2=String.fromCharCode(92,92,46,92)+"DISPLAY2";
const TOKEN="e".repeat(64);
const PATH="/__ordax/native/display-outputs";
const fixture=[{Device:DISPLAY1,Mode:"3840,2160,60",Primary:true}];

test("Win32 DEVMODEW reports real physical current pixels and refresh, no alternative preview modes",async()=>{
  const result=projectWindowsDisplayCurrentModes(fixture);
  assert.deepEqual(result,validateDisplayOutputsSnapshot(result));
  assert.equal(result.schema,DISPLAY_OUTPUTS_SCHEMA);
  assert.equal(result.available,true);
  assert.equal(result.reason,null);
  assert.equal(result.preview,null);
  assert.equal(result.outputs[0].id,"DISPLAY1");
  assert.equal(result.outputs[0].currentModeId,"3840x2160@60");
  assert.deepEqual(result.outputs[0].modes,[{
    id:"3840x2160@60",width:3840,height:2160,refreshHz:60,
    current:true,preferred:false,
  }]);
  assert.equal(result.outputs[0].modes.length,1);
  let observed=null;
  const simulated=await readWindowsDisplayCurrentModes({
    platform:"win32",run:async(binary,args,opts)=>{
      observed={binary,args,opts};return{stdout:JSON.stringify(fixture)};
    },
  });
  assert.deepEqual(simulated,result);
  assert.equal(observed.binary,"powershell.exe");
  assert.equal(observed.opts.timeout,12000);
  const source=observed.args.at(-1);
  assert.match(source,/EnumDisplaySettings/);
  assert.match(source,/dmDisplayFrequency/);
  assert.doesNotMatch(source,/ChangeDisplaySettings|SetDisplayConfig|Set-DisplayResolution|Set-WmiInstance/);
});
test("Win32 display sensor rejects ambiguous and fabricated physical modes",()=>{
  const invalid=[
    null,[],Array(9).fill(fixture[0]),
    [{Device:DISPLAY1,Mode:"3840,2160,0",Primary:true}],
    [{Device:DISPLAY1,Mode:"1920,1080,60",Primary:"yes"}],
    [{Device:"DISPLAY1",Mode:"1920,1080,60",Primary:true}],
    [{Device:DISPLAY1,Mode:"100,100,60",Primary:true}],
    [{Device:DISPLAY1,Mode:"1920,1080,9999",Primary:true}],
    [{Device:DISPLAY1,Mode:"1920,1080,60",Primary:true},
     {Device:DISPLAY1,Mode:"1920,1080,60",Primary:false}],
  ];
  for(const raw of invalid)assert.throws(()=>projectWindowsDisplayCurrentModes(raw),TypeError);
  const two=projectWindowsDisplayCurrentModes([...fixture,{Device:DISPLAY2,Mode:"1920,1080,144",Primary:false}]);
  assert.equal(two.outputs.length,2);
  assert.equal(two.outputs[1].currentModeId,"1920x1080@144");
});
test("display Native port rejects localhost no-token and every mutation, even Electron-granted",async()=>{
  const middleware=createDesktopDisplayCurrentModeMiddleware({
    token:TOKEN,read:async()=>projectWindowsDisplayCurrentModes(fixture),
  });
  const server=createServer((req,res)=>middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const fetchLocal=(path,opts={})=>fetch(origin+path,opts);
  try{
    assert.equal((await fetchLocal(PATH)).status,403);
    assert.equal((await fetchLocal(PATH,{headers:{"X-OrdaX-Display-Token":"a".repeat(64)}})).status,403);
    const headers={"X-OrdaX-Display-Token":TOKEN};
    assert.equal((await fetchLocal(PATH+"?extra=1",{headers})).status,400);
    const get=await fetchLocal(PATH,{headers});
    assert.equal(get.status,200);
    assert.equal((await get.json()).outputs[0].currentModeId,"3840x2160@60");
    for(const action of ["preview","confirm","revert"]){
      const result=await fetchLocal(PATH,{method:"POST",headers:{...headers,
        "Content-Type":"application/json"},body:JSON.stringify({action,modeId:"3840x2160@60"})});
      assert.equal(result.status,503,action);
    }
    assert.equal((await fetchLocal("/__ordax/native/audio-outputs",{headers})).status,404);
  } finally {
    server.closeAllConnections();
    await new Promise(done=>server.close(done));
  }
});
test("concurrent display GETs share one real enumeration without caching failures or stale modes",async()=>{
  const pending=[];
  let accepted=0;
  const middleware=createDesktopDisplayCurrentModeMiddleware({
    token:TOKEN,
    read:()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),
  });
  const server=createServer((req,res)=>{
    accepted++;
    middleware(req,res,()=>{res.writeHead(404);res.end();});
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port+PATH;
  const headers={"X-OrdaX-Display-Token":TOKEN};
  const awaitAccepted=async count=>{
    for(let i=0;i<250 && accepted<count;i++)
      await new Promise(resolve=>setTimeout(resolve,4));
    assert.equal(accepted,count,"all concurrent clients reached one Native host");
  };
  try{
    const simultaneous=Array.from({length:6},()=>fetch(origin,{headers}));
    await awaitAccepted(6);
    assert.equal(pending.length,1,"only one physical provider invocation");
    pending[0].resolve(projectWindowsDisplayCurrentModes(fixture));
    const first=await Promise.all(simultaneous);
    assert.ok(first.every(res=>res.status===200));
    assert.ok((await first[0].json()).outputs[0].currentModeId==="3840x2160@60");

    // A later query must read hardware again, not reuse the previous value.
    const afterSuccess=fetch(origin,{headers});
    await awaitAccepted(7);
    assert.equal(pending.length,2);
    pending[1].reject(Error("temporary Win32 failure"));
    assert.equal((await afterSuccess).status,503);

    // An error clears the shared pending promise, so recovery is observable.
    const afterFailure=fetch(origin,{headers});
    await awaitAccepted(8);
    assert.equal(pending.length,3);
    pending[2].resolve(projectWindowsDisplayCurrentModes([
      {Device:DISPLAY1,Mode:"2560,1440,75",Primary:true},
    ]));
    const recovered=await afterFailure;
    assert.equal(recovered.status,200);
    assert.equal((await recovered.json()).outputs[0].currentModeId,"2560x1440@75");
  }finally{
    server.closeAllConnections();
    await new Promise(done=>server.close(done));
  }
});

test("Native session hands display capability only to the authenticated Electron caller",async()=>{
  const root=await mkdtemp(join(tmpdir(),"ordax-display-session-"));
  const diagnostic="a".repeat(64),session="b".repeat(64);
  try{
    assert.throws(()=>createDesktopClientDiagnosticsMiddleware(root,{
      sessionToken:session,diagnosticToken:diagnostic,sourceSha:"f".repeat(40),
      displayToken:session,
    }),/independent diagnostic grants/);
    const host=createDesktopClientDiagnosticsMiddleware(root,{
      sessionToken:session,diagnosticToken:diagnostic,sourceSha:"f".repeat(40),
      displayToken:TOKEN,
    });
    const server=createServer((req,res)=>host.middleware(req,res,()=>{
      res.writeHead(404);res.end();
    }));
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    try{
      const url="http://127.0.0.1:"+server.address().port+"/__ordax/native/session";
      assert.equal((await fetch(url)).status,401);
      const response=await fetch(url,{headers:{"X-OrdaX-Session-Token":session}});
      assert.equal(response.status,200);
      assert.equal((await response.json()).displayOutputsToken,TOKEN);
    }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
  }finally{await rm(root,{recursive:true,force:true});}
});

test("Win32 display API failure or non-Windows host never fabricates an available display",async()=>{
  await assert.rejects(()=>readWindowsDisplayCurrentModes({platform:"linux"}),/requires Windows/);
  await assert.rejects(()=>readWindowsDisplayCurrentModes({
    platform:"win32",run:async()=>({stdout:"not-a-display"}),
  }),/invalid JSON/);
  const middle=createDesktopDisplayCurrentModeMiddleware({token:TOKEN,read:async()=>{throw Error("headless");}});
  const server=createServer((req,res)=>middle(req,res,()=>{}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const url="http://127.0.0.1:"+server.address().port+PATH;
    assert.equal((await fetch(url,{headers:{"X-OrdaX-Display-Token":TOKEN}})).status,503);
  }finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
});
