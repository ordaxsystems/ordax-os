import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client=readFileSync(new URL("../public/assets/site.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const start=client.indexOf("    async updateOptionalCommunications(choices, signal) {");
const end=client.indexOf("\n    },\n    // The verified Account session authorizes read only.",start);
assert.ok(start>0&&end>start,"canonical optional communication port missing");
const body=client.slice(start+"    async updateOptionalCommunications(choices, signal) {".length,end);
function harness(session,loader){
  return new Function("loadJson","initial",
    "let sessionView=initial;return {update:async function(choices,signal){"+body+"},change(next){sessionView=next;}};")(loader,session);
}
const authenticated={status:"authenticated",communicationsPreferenceEditEnabled:true};
const choices={productDigest:false,news:true};
const receipt={schema:"ordax.account-optional-communications-update/1",productDigest:false,news:true,updated:true};

test("an explicit authenticated action writes exactly two optional preferences and no identity fields",async()=>{
  const calls=[];
  const h=harness(authenticated,async(...a)=>{calls.push(a);return receipt});
  assert.deepEqual(await h.update(choices),receipt);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/preferences/communications");
  assert.deepEqual(calls[0][2],{
    maxBytes:2048,method:"POST",
    jsonBody:{product_digest:false,news:true},
  });
  assert.doesNotMatch(body,/localStorage|user_id|sendEmail|service_role|marketingConsent/);
});
test("anonymous, unavailable and gate-disabled sessions never write",async()=>{
  for(const state of [
    {status:"anonymous",communicationsPreferenceEditEnabled:true},
    {status:"checking",communicationsPreferenceEditEnabled:true},
    {status:"authenticated",communicationsPreferenceEditEnabled:false},
  ]){
    let called=false;
    await assert.rejects(harness(state,async()=>{called=true;return receipt}).update(choices),
      /account-communications-edit-unavailable/);
    assert.equal(called,false);
  }
});
test("untrusted or nonboolean choices cannot be submitted",async()=>{
  let called=false;
  for(const invalid of [
    null,{},[],{productDigest:false},{news:true},
    {news:"true",productDigest:false},{...choices,securityAlerts:false},
    {news:1,productDigest:false},
  ]){
    await assert.rejects(harness(authenticated,async()=>{called=true;return receipt}).update(invalid),
      /account-communications-invalid/);
  }
  assert.equal(called,false);
});
test("unconfirmed response and extra claims fail closed",async()=>{
  for(const forged of [
    null,{...receipt,updated:false},{...receipt,news:false},
    {...receipt,schema:"unknown"},{...receipt,sent:true},
  ])await assert.rejects(harness(authenticated,async()=>forged).update(choices),
    /account-communications-update-unconfirmed/);
});
test("an in-flight mutation cannot complete in a different account session",async()=>{
  let resolve;
  const pending=new Promise(r=>resolve=r);
  const h=harness(authenticated,()=>pending);
  const write=h.update(choices);
  h.change({...authenticated});
  resolve(receipt);
  await assert.rejects(write,/public-account-session-changed/);
});
test("session accepts only exact, paired boolean fields; no token or role is cached",()=>{
  assert.match(client,/value\.optionalCommunications === undefined \|\| \(/);
  assert.match(client,/Object\.keys\(value\.optionalCommunications\)\.sort\(\)\.join\(","\) === "news,productDigest"/);
  assert.match(client,/typeof value\.optionalCommunications\.news === "boolean"/);
  assert.match(client,/typeof value\.optionalCommunications\.productDigest === "boolean"/);
  assert.match(client,/session\.authenticated && session\.communicationsPreferenceEditEnabled === true/);
});
test("UI keeps essential security separate and never claims to send messages",()=>{
  assert.match(portal,/Alertas essenciais pertencem ao serviço de identidade/);
  assert.match(portal,/Nenhum envio é ativado por esta escolha/);
  assert.match(portal,/Nenhuma preferência opcional confirmada/);
  assert.match(portal,/data-communication-choice/);
  assert.match(portal,/communicationsPreferenceEditEnabled === true/);
  assert.match(portal,/await account\.updateOptionalCommunications\(choices\)/);
  assert.match(portal,/await account\.refreshSession\(\)/);
  assert.match(portal,/session\.optionalCommunications\?\.productDigest !== choices\.productDigest/);
  assert.match(portal,/session\.optionalCommunications\?\.news !== choices\.news/);
  assert.doesNotMatch(portal,/data-communication-choice="securityAlerts"/);
});
