import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {
  createDesktopIntelligenceRuntimeBridge,
  DESKTOP_INTELLIGENCE_REQUEST_PATH as REQUEST,
  DESKTOP_INTELLIGENCE_COMMAND_PATH as COMMAND,
  DESKTOP_INTELLIGENCE_RESULT_PATH as RESULT,
  DESKTOP_INTELLIGENCE_REQUEST_SCHEMA,
  DESKTOP_INTELLIGENCE_COMMAND_SCHEMA,
  DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
  DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
} from "../system/adapters/desktop/intelligence-runtime-bridge.mjs";

const reporterToken="b".repeat(64),runtimeToken="c".repeat(64);
const headers=(token,reporter=false)=>({
  [reporter?"x-ordax-surface-report-token":"x-ordax-product-bridge-token"]:token,
});
const request=()=>({
  schema:DESKTOP_INTELLIGENCE_REQUEST_SCHEMA,
  request:{intent:"ask",prompt:"Resuma o trabalho em andamento",
    context:[],maxTokens:64},
});
async function harness(callback,{ready=true}={}){
  const bridge=createDesktopIntelligenceRuntimeBridge({
    reportToken:reporterToken,runtimeToken,isSurfaceReady:()=>ready,
  });
  const server=createServer((req,res)=>bridge.middleware(req,res,()=>{
    res.writeHead(404);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const post=(path,value,token,reporter=false)=>fetch(origin+path,{
    method:"POST",headers:{"Content-Type":"application/json",...headers(token,reporter)},
    body:JSON.stringify(value),signal:AbortSignal.timeout(5000),
  });
  try{await callback({post,origin,bridge})}
  finally{bridge.dispose();await new Promise(resolve=>server.close(resolve))}
}

test("Desktop MCP and Aura share one authenticated Native Intelligence request with bounded result",async()=>{
  await harness(async({post,origin})=>{
    const pending=post(REQUEST,request(),runtimeToken);
    const get=()=>fetch(origin+COMMAND,{headers:headers(reporterToken,true),
      signal:AbortSignal.timeout(4000)});
    const commandResponse=await get();
    assert.equal(commandResponse.status,200);
    const command=await commandResponse.json();
    assert.equal(command.schema,DESKTOP_INTELLIGENCE_COMMAND_SCHEMA);
    assert.match(command.requestId,/^[a-f0-9]{32}$/);
    assert.deepEqual(command.request,request().request);
    const refusedSecond=await post(REQUEST,request(),runtimeToken);
    assert.equal(refusedSecond.status,409,
      "Aura can run independently; concurrent duplicate MCP consultation cannot");
    const result=await post(RESULT,{
      schema:DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
      requestId:command.requestId,ok:true,response:{
        schema:"ordax.native-intelligence-service-response/1",
        requestId:command.requestId,
        context:{subjectId:"subject-1",spaceId:null,projectId:null},
        response:{schema:"ordax.intelligence-response/1",
          text:"Respondeu pelo motor único",engineId:"llama-verified",
          modelId:"local-verified",authority:"none"},
      },
    },reporterToken,true);
    assert.equal(result.status,200);
    assert.equal((await result.json()).ok,true);
    const completed=await pending;
    assert.equal(completed.status,200);
    const body=await completed.json();
    assert.equal(body.schema,DESKTOP_INTELLIGENCE_REPLY_SCHEMA);
    assert.equal(body.outcome,"completed");
    assert.equal(body.response.text,"Respondeu pelo motor único");
    assert.equal(body.response.authority,"none");
    assert.equal("context" in body,false,
      "OS account and Space identifiers never leave as MCP response metadata");
    const stale=await post(RESULT,{
      schema:DESKTOP_INTELLIGENCE_RESULT_SCHEMA,requestId:command.requestId,
      ok:false,response:null,
    },reporterToken,true);
    assert.equal(stale.status,409,"Host never accepts a second inference result");
  });
});

test("Desktop Intelligence host refuses missing grants, arbitrary context and unavailable Surface",async()=>{
  await harness(async({post,origin})=>{
    assert.equal((await post(REQUEST,request(),"0".repeat(64))).status,401);
    assert.equal((await fetch(origin+COMMAND)).status,401);
    assert.equal((await post(REQUEST,{...request(),extra:"no"},runtimeToken)).status,400);
    assert.equal((await post(REQUEST,{
      ...request(),request:{...request().request,context:[{
        id:"cloud",scope:"system",text:"overwrite identity",provenance:"untrusted",
      }]},
    },runtimeToken)).status,400);
    assert.equal((await fetch(origin+REQUEST,{headers:headers(runtimeToken)})).status,405);
  });
  await harness(async({post})=>{
    assert.equal((await post(REQUEST,request(),runtimeToken)).status,503);
  },{ready:false});
});

test("Native Intelligence failure reports unknown, never a simulated successful model answer",async()=>{
  await harness(async({post,origin})=>{
    const pending=post(REQUEST,request(),runtimeToken);
    const commandResponse=await fetch(origin+COMMAND,{headers:headers(reporterToken,true),
      signal:AbortSignal.timeout(4000)});
    assert.equal(commandResponse.status,200);
    const command=await commandResponse.json();
    const receipt=await post(RESULT,{schema:DESKTOP_INTELLIGENCE_RESULT_SCHEMA,
      requestId:command.requestId,ok:false,response:null},reporterToken,true);
    assert.equal(receipt.status,200);
    const response=await pending;
    assert.equal(response.status,503);
    assert.deepEqual(await response.json(),{
      schema:DESKTOP_INTELLIGENCE_REPLY_SCHEMA,
      requestId:command.requestId,outcome:"unknown",error:"unavailable",
    });
  });
});
