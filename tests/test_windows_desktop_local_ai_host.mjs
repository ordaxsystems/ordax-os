import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopLocalAiMiddleware } from "../system/adapters/desktop/local-ai-host.mjs";

const TOKEN = "b".repeat(64);
const model = Object.freeze({
  executable: "C:/verified/engine/llama-server.exe",
  engineDirectory: "C:/verified/engine",
  modelFile: "C:/verified/models/model.gguf",
  modelId: "qwen3.5-0.8b-q4_0",
});

async function runningServer(t, config = {}) {
  const profile = await mkdtemp(join(tmpdir(), "ordax-local-ai-host-"));
  const launchCalls = [];
  let packages = 0;
  const process = new EventEmitter();
  process.exitCode = null;
  process.kill = () => { process.exitCode = 0; };
  const fetchCalls = [];
  const handle = createDesktopLocalAiMiddleware({
    packageRoot: "C:/verified",
    userData: profile,
    token: TOKEN,
    verifyPackage: async () => { packages++; if (config.corrupt) throw Error("Corrupt payload"); return model; },
    launch: (path, args, opts) => { launchCalls.push({path,args,opts}); return process; },
    fetchImpl: async (url, options) => {
      fetchCalls.push({url,options});
      if (url.endsWith("/health")) return new Response(JSON.stringify({status:"ok"}),
        {status:200,headers:{"content-type":"application/json"}});
      if (url.endsWith("/v1/models")) return new Response(JSON.stringify({data:[{id:model.modelId}]}),
        {status:200,headers:{"content-type":"application/json"}});
      return new Response(JSON.stringify({model:model.modelId,
        choices:[{message:{role:"assistant",content:"teste"}}]}),
        {status:200,headers:{"content-type":"application/json"}});
    },
    sessionLocked: config.locked ? async () => true : null,
  });
  const server = createServer((req,res) => handle.middleware(req,res,() => {
    res.writeHead(418);res.end();
  }));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=> {
    await handle.dispose();
    await new Promise(resolve=>server.close(resolve));
    await rm(profile,{force:true,recursive:true});
  });
  const base = "http://127.0.0.1:" + server.address().port;
  return {base, launchCalls, fetchCalls, getPackages:()=>packages};
}
const opts = {headers:{"x-ordax-local-ai-token":TOKEN}};
test("Local AI Windows host denies other processes and refuses missing real payload", async t => {
  const h = await runningServer(t, {corrupt:true});
  const path="/__ordax/native/local-ai/health";
  assert.equal((await fetch(h.base+path)).status,401);
  assert.equal((await fetch(h.base+path,opts)).status,503);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await fetch(h.base+path,opts)).status,503);
  assert.equal(h.launchCalls.length,0);
  assert.equal(h.getPackages(),1);
});
test("single supervised engine, fixed model, authenticated same-origin inference", async t => {
  const h=await runningServer(t);
  const path="/__ordax/native/local-ai/health";
  assert.equal((await fetch(h.base+path,opts)).status,503);
  await new Promise(resolve=>setTimeout(resolve,35));
  assert.equal((await fetch(h.base+path,opts)).status,200);
  assert.equal((await fetch(h.base+"/__ordax/native/local-ai/v1/models",opts)).status,200);
  const request={model:model.modelId,messages:[{role:"user",content:"Ola"}],max_tokens:32,stream:false};
  const result=await fetch(h.base+"/__ordax/native/local-ai/v1/chat/completions", {
    method:"POST",
    headers:{...opts.headers,origin:h.base,"content-type":"application/json"},
    body:JSON.stringify(request),
  });
  assert.equal(result.status,200);
  assert.equal((await result.json()).choices[0].message.content,"teste");
  assert.equal(h.getPackages(),1);
  assert.equal(h.launchCalls.length,1);
  assert.equal(h.launchCalls[0].path,model.executable);
  assert.equal(h.launchCalls[0].opts.cwd,model.engineDirectory);
  assert.ok(h.launchCalls[0].opts.env.LLAMA_ARG_API_KEY_FILE);
  assert.ok(h.fetchCalls.every(v=>v.options.headers.Authorization.startsWith("Bearer ")));
  assert.ok(h.fetchCalls.every(v=>v.url.startsWith("http://127.0.0.1:")));
  const dangerous={...request,tools:[{type:"function",function:{name:"run"}}]};
  const bad=await fetch(h.base+"/__ordax/native/local-ai/v1/chat/completions",{
    method:"POST",headers:{...opts.headers,origin:h.base,"content-type":"application/json"},
    body:JSON.stringify(dangerous),
  });
  assert.equal(bad.status,400);
});
test("Local AI blocks session-locked requests without starting a backend",async t=>{
  const h=await runningServer(t,{locked:true});
  assert.equal((await fetch(h.base+"/__ordax/native/local-ai/health",opts)).status,423);
  assert.equal(h.launchCalls.length,0);
});
