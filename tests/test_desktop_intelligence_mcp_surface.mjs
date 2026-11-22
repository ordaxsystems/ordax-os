import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {createDesktopIntelligenceRuntimeBridge,
  DESKTOP_INTELLIGENCE_REQUEST_SCHEMA,DESKTOP_INTELLIGENCE_REQUEST_PATH}
  from "../system/adapters/desktop/intelligence-runtime-bridge.mjs";
import {mountNativeDesktopIntelligenceMcp}
  from "../system/adapters/native/desktop-intelligence-mcp.mjs";
import {IDENTITY_SESSION_SCHEMA} from "../system/contracts/identity-session.mjs";
import {SPACE_SELECTION_SCHEMA} from "../system/contracts/space-selection.mjs";
import {INTELLIGENCE_PORT_SCHEMA,INTELLIGENCE_RESPONSE_SCHEMA}
  from "../system/contracts/intelligence.mjs";

const reporterToken="b".repeat(64),runtimeToken="c".repeat(64);
const testRequest={schema:DESKTOP_INTELLIGENCE_REQUEST_SCHEMA,
  request:{intent:"ask",prompt:"Como está o projeto?",context:[],maxTokens:64}};
function identity(){
  return {schema:IDENTITY_SESSION_SCHEMA,
    getSnapshot:()=>({state:"signed-in",subjectId:"account-7",displayName:"Owner"}),
    subscribe:()=>()=>{}};
}
function space(){
  return {schema:SPACE_SELECTION_SCHEMA,
    getSnapshot:()=>({schema:SPACE_SELECTION_SCHEMA,state:"selected",
      subjectId:"account-7",selectedSpace:{id:"space-7",name:"Dev",
        kind:"work",state:"active",ownerId:"account-7",profilePack:null}}),
    subscribe:()=>()=>{},select(){},clear(){}};
}
test("Desktop MCP and Aura consult the exact same OS Intelligence port and current account/Space",async()=>{
  let calls=0;
  const intelligence={
    schema:INTELLIGENCE_PORT_SCHEMA,
    getSnapshot:()=>({schema:INTELLIGENCE_PORT_SCHEMA,state:"ready",inferenceAvailable:true,
      engineId:"shared-engine",modelId:"shared-model",authority:"none",toolExecution:false}),
    subscribe:()=>()=>{},
    async respond(request){
      calls++;
      assert.equal(request.prompt,"Como está o projeto?");
      return {schema:INTELLIGENCE_RESPONSE_SCHEMA,text:"Aura e MCP utilizam o OS",
        engineId:"shared-engine",modelId:"shared-model",authority:"none"};
    },
  };
  const bridge=createDesktopIntelligenceRuntimeBridge({
    reportToken:reporterToken,runtimeToken,isSurfaceReady:()=>true,
  });
  const server=createServer((req,res)=>bridge.middleware(req,res,()=>{res.writeHead(404);res.end()}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const windowRef={
    fetch(path,options={}){
      return fetch(origin+path,{...options,headers:{
        ...options.headers,"X-OrdaX-Surface-Report-Token":reporterToken,
      }});
    },
    setInterval,clearInterval,
  };
  const renderer=mountNativeDesktopIntelligenceMcp({
    windowRef,intelligencePort:intelligence,identitySessionPort:identity(),
    spaceSelectionPort:space(),
  });
  try{
    const result=await fetch(origin+DESKTOP_INTELLIGENCE_REQUEST_PATH,{
      method:"POST",headers:{"Content-Type":"application/json",
        "X-OrdaX-Product-Bridge-Token":runtimeToken},
      body:JSON.stringify(testRequest),signal:AbortSignal.timeout(5000),
    });
    assert.equal(result.status,200);
    const receipt=await result.json();
    assert.equal(receipt.outcome,"completed");
    assert.equal(receipt.response.text,"Aura e MCP utilizam o OS");
    assert.equal(receipt.response.modelId,"shared-model");
    assert.equal("context" in receipt,false);
    assert.equal(calls,1,"No second Intelligence instance or inference route");
  }finally{
    renderer.dispose();
    bridge.dispose();
    await new Promise(resolve=>server.close(resolve));
  }
});

test("Native service derives current identity and refuses signed-out MCP consultation",async()=>{
  let called=false;
  const service=await import("../system/services/intelligence/native-service.mjs");
  const intelligence={
    schema:INTELLIGENCE_PORT_SCHEMA,
    getSnapshot:()=>({state:"ready",inferenceAvailable:true,
      engineId:"e",modelId:"m",authority:"none",toolExecution:false}),
    subscribe:()=>()=>{},
    async respond(){called=true;throw Error("must not run")},
  };
  const client=service.createNativeIntelligenceService({
    intelligencePort:intelligence,
    identitySessionPort:{...identity(),
      getSnapshot:()=>({state:"signed-out",subjectId:null,displayName:null})},
    spaceSelectionPort:space(),
  });
  assert.throws(()=>client.respondCurrent({
    requestId:"a".repeat(32),request:testRequest.request,
  }),/signed-in identity/);
  assert.equal(called,false);
  client.dispose();
});
