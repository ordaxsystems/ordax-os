import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { createDesktopDiagnosticJournalMiddleware } from "../system/adapters/desktop/diagnostic-journal-host.mjs";

const route="/__ordax/native/diagnostic-journal";
const token="a".repeat(64);
async function harness(t,{sessionLocked=null}={}) {
  const directory=await mkdtemp(join(tmpdir(),"ordax-journal-win-"));
  const create=()=>{
    const middleware=createDesktopDiagnosticJournalMiddleware(directory,{token,sessionLocked});
    const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
    return server;
  };
  let server=create();
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  let origin="http://127.0.0.1:"+server.address().port;
  t.after(async()=>{
    await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  });
  const request=(options={})=>fetch(origin+route,{
    ...options,
    headers:{...(options.method==="POST"?{"Origin":origin}:{}),
      "x-ordax-desktop-state-token":token,...(options.headers??{}),},
  });
  const save=(payload,options={})=>request({
    method:"POST",
    headers:{"Content-Type":"application/json",...(options.headers??{})},
    body:JSON.stringify({payload}),
  });
  return {directory,request,save,server,origin,create,
    async restart(){
      await new Promise(resolve=>server.close(resolve));
      server=create();
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      origin="http://127.0.0.1:"+server.address().port;
    },
  };
}
test("Desktop diagnostic journal round-trips and survives Native host restart",async t=>{
  const h=await harness(t);
  const raw=JSON.stringify({$schema:"ordax.diagnostic-journal-state/1",events:[]});
  assert.equal((await h.request()).status,200);
  assert.deepEqual(await (await h.request()).json(),{payload:null});
  assert.equal((await h.save(raw)).status,200);
  assert.equal(await readFile(join(h.directory,"diagnostic-journal.json"),"utf8"),raw);
  assert.deepEqual(await (await h.request()).json(),{payload:raw});
  await h.restart();
  assert.deepEqual(await (await h.request()).json(),{payload:raw});
  assert.equal((await h.save(null)).status,200);
  assert.deepEqual(await (await h.request()).json(),{payload:null});
});
test("Desktop journal requires host grant, same-origin writes, valid method and body",async t=>{
  const h=await harness(t);
  assert.equal((await fetch(h.origin+route)).status,401);
  assert.equal((await h.request({headers:{"x-ordax-desktop-state-token":"b".repeat(64)}})).status,401);
  assert.equal((await h.request({method:"DELETE"})).status,405);
  assert.equal((await fetch(h.origin+route+"?foo=1",{headers:{"x-ordax-desktop-state-token":token}})).status,400);
  assert.equal((await h.request({method:"POST",headers:{"Content-Type":"application/json","Origin":"https://foreign.example"},body:'{"payload":"x"}'})).status,403);
  assert.equal((await h.request({method:"POST",headers:{"Content-Type":"text/plain"},body:"x"})).status,415);
  assert.equal((await h.request({method:"POST",headers:{"Content-Type":"application/json"},body:'{"payload":{}}'})).status,400);
  assert.equal((await h.request({method:"POST",headers:{"Content-Type":"application/json"},body:'{"wrong":"x"}'})).status,400);
  assert.equal((await h.request({method:"POST",headers:{"Content-Type":"application/json"},body:'{'})).status,400);
});
test("Desktop journal refuses linked files and preserves external data",async t=>{
  const h=await harness(t);
  const out=await mkdtemp(join(tmpdir(),"ordax-journal-outside-"));
  t.after(async()=>rm(out,{recursive:true,force:true}));
  const target=join(out,"sentinel.txt");
  await writeFile(target,"external unchanged");
  // Trusted caller creates the root; never allow a linked journal file.
  assert.equal((await h.request()).status,200);
  try {await symlink(target,join(h.directory,"diagnostic-journal.json"),"file");}
  catch(error){
    if(["EPERM","EACCES","UNKNOWN","ENOSYS"].includes(error?.code)){t.skip("Symlink permissions unavailable");return;}
    throw error;
  }
  assert.equal((await h.request()).status,503);
  assert.equal((await h.save("safe")).status,503);
  assert.equal(await readFile(target,"utf8"),"external unchanged");
});
test("Desktop journal locks device diagnostics and does not persist blocked writes",async t=>{
  const h=await harness(t,{sessionLocked:async()=>true});
  assert.equal((await h.request()).status,423);
  assert.equal((await h.save("blocked")).status,423);
  await assert.rejects(()=>readFile(join(h.directory,"diagnostic-journal.json"),"utf8"),{code:"ENOENT"});
});
test("Desktop journal serializes concurrent changes and validates size",async t=>{
  const h=await harness(t);
  const large="x".repeat(4*1024*1024+1);
  assert.equal((await h.save(large)).status,400);
  const responses=await Promise.all(["one","two","three"].map(x=>h.save(x)));
  assert.deepEqual(responses.map(x=>x.status),[200,200,200]);
  assert.equal((await h.request()).status,200);
  assert.equal(typeof (await (await h.request()).json()).payload,"string");
  assert.equal((await h.save(null)).status,200);
});

test("Desktop journal rejects a write when PIN locks during streamed request", async t => {
  let locked=false;
  let inspected;
  const checked=new Promise(resolve => { inspected=resolve; });
  const h=await harness(t, {sessionLocked: async () => {
    if (!locked) inspected();
    return locked;
  }});
  const body=JSON.stringify({payload:"should never reach disk"});
  const responseStatus=new Promise((resolve,reject) => {
    const request=httpRequest(h.origin+route,{
      method:"POST",
      headers:{
        Origin:h.origin,
        "Content-Type":"application/json",
        "Content-Length":Buffer.byteLength(body),
        "x-ordax-desktop-state-token":token,
      },
    },response => {
      response.resume();
      response.once("end",()=>resolve(response.statusCode));
    });
    request.once("error",reject);
    request.write(body.slice(0,9));
    void checked.then(() => {
      locked=true;
      request.end(body.slice(9));
    }).catch(reject);
  });
  assert.equal(await responseStatus,423);
  await assert.rejects(
    () => readFile(join(h.directory,"diagnostic-journal.json"),"utf8"),
    {code:"ENOENT"},
  );
});
