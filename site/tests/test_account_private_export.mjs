import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src=readFileSync(new URL("../public/assets/site.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const start=src.indexOf("    async readPrivateDataExport(signal) {");
const end=src.indexOf("\n    },\n    // Read-only account data",start);
assert.ok(start>0&&end>start,"canonical data-export port is required");
const body=src.slice(start+"    async readPrivateDataExport(signal) {".length,end);
function harness(session,transport){
  return new Function("loadJson","initial",
    "let sessionView=initial;return {read:async function(signal){"+body+"},"+
    "change(next){sessionView=next;}};")(transport,session);
}
const subject="8bce09bf-963b-4ccb-8f67-e1b02e44a873";
const archive={
  $schema:"prototype-ordax.account-export/1",
  subject,exported_at:"2026-11-18T09:00:00.000Z",
  account:{user_id:subject,display_name:"A",created_at:"2026-11-18T09:00:00Z",updated_at:"2026-11-18T09:00:00Z"},
  spaces:[],memberships:[],space_profile_packs:[],entitlements:[],
  projects:[],devices:[],project_connections:[],memory_items:[],sync_objects:[],
};
test("only activated authenticated session may request a sensitive export",async()=>{
  let called=0;
  for(const session of [
    {status:"anonymous",dataExportEnabled:true},
    {status:"authenticated",dataExportEnabled:false},
    {status:"checking",dataExportEnabled:false},
  ]){
    await assert.rejects(harness(session,async()=>{called++;return archive;}).read(),/account-export-not-authorized/);
  }
  assert.equal(called,0);
});
test("reads only exact owner endpoint with bounded no-store JSON transport",async()=>{
  const calls=[];
  const h=harness({status:"authenticated",dataExportEnabled:true},async (...args)=>{
    calls.push(args);return archive;
  });
  assert.deepEqual(await h.read(),archive);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/export");
  assert.deepEqual(calls[0][2],{maxBytes:2097152});
});
test("untrusted export contract and foreign account identifiers fail closed",async()=>{
  for(const forged of [
    {...archive,$schema:"unknown"},{...archive,subject:"not-a-subject"},
    {...archive,account:{user_id:"33f58c01-65f2-4e2f-b3cd-179b76a5469b"}},
    {...archive,spaces:"fake"}, {...archive,memory_items:null},
    {...archive,exported_at:"not-a-date"},
    {...archive,providerToken:"sensitive"},
  ]){
    await assert.rejects(harness({status:"authenticated",dataExportEnabled:true},
      async()=>forged).read(),/account-export-contract-invalid/);
  }
});
test("superseded session cannot receive an in-flight private archive",async()=>{
  let resolve;
  const waiting=new Promise(r=>resolve=r);
  const h=harness({status:"authenticated",dataExportEnabled:true},()=>waiting);
  const pending=h.read();
  h.change({status:"authenticated",dataExportEnabled:true});
  resolve(archive);
  await assert.rejects(pending,/public-account-session-changed/);
});
test("privacy interface only offers an explicit action and never auto-fetches",()=>{
  assert.match(portal,/if \(!signedIn\(\) \|\| session\.dataExportEnabled !== true \|\| accountExportBusy\) return/);
  assert.match(portal,/account\.readPrivateDataExport\(\)/);
  assert.match(portal,/control\.matches\("\[data-account-export\]"\)/);
  assert.match(portal,/new Blob\(\[serialized\], \{ type: "application\/json;charset=utf-8" \}\)/);
  assert.match(portal,/URL\.revokeObjectURL/);
  assert.doesNotMatch(portal,/localStorage\.setItem\([^)]*export/);
});


const budgetStart=src.indexOf("  async function readJsonBytes(response, maxBytes = MAX_PUBLIC_JSON_BYTES) {");
const budgetEnd=src.indexOf("\n  function parseJsonBytes(bytes)",budgetStart);
assert.ok(budgetStart>=0&&budgetEnd>budgetStart,"canonical bounded transport required");
const budgetedRead=new Function("const MAX_PUBLIC_JSON_BYTES=256*1024;\n"+
  src.slice(budgetStart,budgetEnd)+"\nreturn readJsonBytes;")();

test("browser transport enforces the Public Edge 2 MiB limit even for chunked responses", async()=>{
  const limit=2*1024*1024;
  function response(size, withLength=false) {
    return new Response(new ReadableStream({
      start(controller){
        controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    }),{
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        ...(withLength?{"Content-Length":String(size)}:{}),
      },
    });
  }
  const exact=await budgetedRead(response(limit),limit);
  assert.equal(exact.byteLength,limit);
  await assert.rejects(budgetedRead(response(limit+1),limit),/public-json-too-large/);
  await assert.rejects(budgetedRead(response(limit+1,true),limit),/invalid-public-json-response/);
});
test("export client never claims a larger budget than the Public Edge contract",()=>{
  assert.match(src,/loadJson\("\/account\/export", signal, \{ maxBytes: 2 \* 1024 \* 1024 \}\)/);
  assert.doesNotMatch(src,/loadJson\("\/account\/export", signal, \{ maxBytes: 4 \* 1024 \* 1024 \}\)/);
  assert.match(portal,/O transporte admite até 2 MiB/);
});
