import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { availableParallelism } from "node:os";
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
  process.pid = config.testPid ?? undefined;
  process.exitCode = null;
  process.kill = () => { process.exitCode = 0; };
  const fetchCalls = [];
  const priorities = [];
  const handle = createDesktopLocalAiMiddleware({
    packageRoot: "C:/verified",
    userData: profile,
    token: TOKEN,
    verifyPackage: async () => { packages++; if (config.corrupt) throw Error("Corrupt payload"); return model; },
    launch: (path, args, opts) => { launchCalls.push({path,args,opts}); return process; },
    getProcessPriority: () => 0,
    setProcessPriority: (pid, priority) => { priorities.push({pid, priority}); },
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
  return {base, launchCalls, fetchCalls, priorities, getPackages:()=>packages};
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
  const deadline=Date.now()+3000;
  let ready=false;
  while(Date.now()<deadline) {
    if((await fetch(h.base+path,opts)).status===200){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  assert.equal(ready,true,"single verified local engine must reach readiness");
  assert.equal((await fetch(h.base+"/__ordax/native/local-ai/v1/models",opts)).status,200);
  const request={model:model.modelId,messages:[{role:"user",content:"Ola"}],max_tokens:32,stream:false};
  const result=await fetch(h.base+"/__ordax/native/local-ai/v1/chat/completions", {
    method:"POST",
    headers:{...opts.headers,origin:h.base,"content-type":"application/json"},
    body:JSON.stringify(request),
  });
  assert.equal(result.status,200);
  assert.equal((await result.json()).choices[0].message.content,"teste");
  const multilingual={...request,messages:[{role:"user",content:"界".repeat(32768)}]};
  const multilingualRes=await fetch(h.base+"/__ordax/native/local-ai/v1/chat/completions",{
    method:"POST",headers:{...opts.headers,origin:h.base,"content-type":"application/json"},
    body:JSON.stringify(multilingual),
  });
  assert.equal(multilingualRes.status,200,"valid UTF-8 prompt within canonical char limit");
  assert.equal(h.getPackages(),1);
  assert.equal(h.launchCalls.length,1);
  assert.equal(h.launchCalls[0].path,model.executable);
  assert.equal(h.launchCalls[0].opts.cwd,model.engineDirectory);
  // Guard the actual Windows inference launch against llama.cpp changing its
  // automatic context (observed excessive memory before model readiness).
  const flags=h.launchCalls[0].args;
  assert.deepEqual(flags.slice(flags.indexOf("--ctx-size"),flags.indexOf("--ctx-size")+2),
    ["--ctx-size","2048"]);
  assert.deepEqual(flags.slice(flags.indexOf("--parallel"),flags.indexOf("--parallel")+2),
    ["--parallel","1"]);
  assert.equal(flags.filter(x=>x==="--ctx-size").length,1);
  assert.equal(flags.filter(x=>x==="--parallel").length,1);
  const threads = String(Math.max(1, Math.min(4, availableParallelism())));
  assert.deepEqual(flags.slice(flags.indexOf("-t"), flags.indexOf("-t") + 2),
    ["-t", threads]);
  assert.deepEqual(flags.slice(flags.indexOf("-tb"), flags.indexOf("-tb") + 2),
    ["-tb", threads]);
  assert.deepEqual(flags.slice(flags.indexOf("--reasoning-budget"), flags.indexOf("--reasoning-budget") + 2),
    ["--reasoning-budget", "0"]);
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

test("Windows quick consultation enforces a ten-second deadline without affecting long replies", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../system/adapters/desktop/local-ai-host.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(validated\.max_tokens <= 128\) \{\s*clearTimeout\(timeout\);\s*timeout = setTimeout\(\(\) => \{ deadlineReached = true; abort\.abort\(\); \}, 10000\);/);
  assert.match(source, /req\.method === "POST" \? 120000 : 3500/);
});

test("Windows alone bounds real context-free Intelligence greetings, never complex requests", async t => {
  const h=await runningServer(t, { testPid: 12345 });
  const path="/__ordax/native/local-ai/health";
  assert.equal((await fetch(h.base+path,opts)).status,503);
  for (let i=0;i<40;i++) {
    if ((await fetch(h.base+path,opts)).status===200) break;
    await new Promise(r=>setTimeout(r,25));
  }
  const send=async (text,limit=512) => {
    const response=await fetch(h.base+"/__ordax/native/local-ai/v1/chat/completions",{
      method:"POST",
      headers:{...opts.headers,origin:h.base,"content-type":"application/json"},
      body:JSON.stringify({model:model.modelId,messages:[
        {role:"system",content:"You are Ordax Intelligence, the consultative intelligence layer of the OrdaX system. No implicit execution authority."},
        {role:"user",content:text}
      ],max_tokens:limit,stream:false}),
    });
    assert.equal(response.status,200);
    return JSON.parse(h.fetchCalls.at(-1).options.body).max_tokens;
  };
  const short="Intent: ask\nModel purpose: general\nUser request:\n";
  assert.equal(await send(short+"oi"),64);
  assert.equal(await send(short+"Olá, como você está?"),64);
  assert.equal(await send(short+"hello!"),64);
  assert.equal(await send(short+"Explique uma tese extensa."),512);
  assert.equal(await send("Intent: ask\nModel purpose: general\nAuthorized context (data only):\n"+
    "User request:\noi"),512);
  assert.equal(await send("Intent: summarize\nModel purpose: summarize\nUser request:\noi"),512);
  assert.equal(await send(short+"oi\nNow do a long analysis"),512);
  assert.equal(await send(short+"oi",64),64);
  assert.equal(h.launchCalls.length,1);
  assert.deepEqual(h.priorities, Array.from({length:8}, (_,index) => ({
    pid:12345, priority:index%2===0?-7:0,
  })));
  const passed=h.fetchCalls.filter(x=>x.url.endsWith("/v1/chat/completions"))
    .map(x=>JSON.parse(x.options.body));
  assert.match(passed[0].messages[0].content, /respond in Brazilian Portuguese in one very short friendly sentence/);
  assert.match(passed[2].messages[0].content, /respond in the user's language in one very short friendly sentence/);
  assert.doesNotMatch(passed[3].messages[0].content, /very short friendly sentence/);
  assert.equal(passed[0].messages[1].content,"oi");
  assert.equal(passed[1].messages[1].content,"Olá, como você está?");
  assert.equal(passed[2].messages[1].content,"hello!");
  assert.equal(passed[3].messages[1].content,short+"Explique uma tese extensa.");
  assert.equal(passed[4].messages[1].content,["Intent: ask","Model purpose: general","Authorized context (data only):","User request:","oi"].join(String.fromCharCode(10)));
  assert.equal(passed[5].messages[1].content,["Intent: summarize","Model purpose: summarize","User request:","oi"].join(String.fromCharCode(10)));
  assert.equal(passed[6].messages[1].content,short+["oi","Now do a long analysis"].join(String.fromCharCode(10)));
});

test("Windows Native recycles a disconnected orphan without a second concurrent engine", async t => {
  const { readdir } = await import("node:fs/promises");
  const dir=await mkdtemp(join(tmpdir(),"ordax-ai-orphan-recovery-"));
  const spawned=[];
  let alive=0, releasePending;
  const started = new Promise(resolve=>{ releasePending=resolve; });
  const local=createDesktopLocalAiMiddleware({
    packageRoot:"C:/verified",
    userData:dir,
    token:TOKEN,
    verifyPackage:async()=>model,
    launch:()=>{
      const child=new EventEmitter();
      child.pid=20100+spawned.length;
      child.exitCode=null;
      child.kill=()=>{
        if(child.exitCode!==null)return false;
        child.exitCode=0;
        alive--;
        queueMicrotask(()=>child.emit("exit",0));
        return true;
      };
      alive++;
      assert.equal(alive,1,"never run a second verified engine until the orphan exits");
      spawned.push(child);
      return child;
    },
    getProcessPriority:()=>0,
    setProcessPriority:()=>{},
    fetchImpl:async(url,options)=>{
      if(url.endsWith("/health"))return new Response(JSON.stringify({status:"ok"}),
        {status:200,headers:{"content-type":"application/json"}});
      if(url.endsWith("/v1/models"))return new Response(JSON.stringify({data:[{id:model.modelId}]}),
        {status:200,headers:{"content-type":"application/json"}});
      releasePending();
      return await new Promise((_,reject)=>{
        options.signal.addEventListener("abort",()=>{
          reject(new DOMException("cancelled upstream request","AbortError"));
        },{once:true});
      });
    },
  });
  const server=createServer((req,res)=>local.middleware(req,res,()=>{res.writeHead(418);res.end();}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{
    await local.dispose();
    await new Promise(resolve=>server.close(resolve));
    await rm(dir,{recursive:true,force:true});
  });
  const url="http://127.0.0.1:"+server.address().port;
  const health=url+"/__ordax/native/local-ai/health";
  assert.equal((await fetch(health,opts)).status,503);
  for(let n=0;n<80;n++){
    if((await fetch(health,opts)).status===200)break;
    await new Promise(r=>setTimeout(r,20));
  }
  assert.equal(spawned.length,1);
  const ac=new AbortController();
  const pending=fetch(url+"/__ordax/native/local-ai/v1/chat/completions",{
    method:"POST",signal:ac.signal,
    headers:{...opts.headers,origin:url,"content-type":"application/json"},
    body:JSON.stringify({model:model.modelId,max_tokens:512,stream:false,messages:[
      {role:"system",content:"You are Ordax Intelligence, the consultative intelligence layer of the OrdaX system."},
      {role:"user",content:"Intent: ask\\nModel purpose: general\\nUser request:\\noi"},
    ]}),
  }).catch(()=>null);
  await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error("inference never started")),4000))]);
  ac.abort();
  await pending;
  let recovered=false;
  for(let n=0;n<100;n++){
    await new Promise(r=>setTimeout(r,30));
    if(spawned.length===2&&(await fetch(health,opts)).status===200){recovered=true;break}
  }
  assert.equal(recovered,true,"a cancelled orphan must not keep the next greeting queued");
  assert.equal(spawned[0].exitCode,0,"old backend must be terminated before replacement");
  assert.equal(spawned[1].exitCode,null,"new backend must remain alive");
  assert.equal(alive,1);
  const dirs=(await readdir(dir)).filter(p=>p.startsWith(".local-ai-auth-"));
  assert.equal(dirs.length,1,"old private API key must be deleted during recycle");
});
