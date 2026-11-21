import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../public/assets/site.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const portal = readFileSync(new URL("../public/assets/account-portal.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = client.indexOf("    async updateDisplayName(displayName, signal) {");
const end = client.indexOf("\n    },\n    // The verified Account session authorizes read only.", start);
assert.ok(start >= 0 && end > start, "canonical Account profile port missing");
const body = client.slice(start + "    async updateDisplayName(displayName, signal) {".length, end);
function harness(session, loadJson) {
  return new Function("loadJson","initial","let sessionView=initial;return {" +
    "update: async function(displayName,signal) {" + body + "}," +
    "change(next) {sessionView=next} };")(loadJson, session);
}
const ready = {status:"authenticated",profileEditEnabled:true,displayName:"Nome original"};
const updated = {schema:"ordax.account-display-name-update/1",displayName:"Nome novo",updated:true};
test("authenticated Account edits only own display name through bounded same-origin POST",async()=>{
  const calls=[];
  const api=harness(ready,async(...args)=>{calls.push(args);return updated;});
  assert.deepEqual(await api.update("Nome novo"),updated);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/profile/display-name");
  assert.deepEqual(calls[0][2],{maxBytes:2048,method:"POST",jsonBody:{display_name:"Nome novo"}});
});
test("anonymous and unactivated portal never write display name",async()=>{
  for(const session of [{status:"anonymous"},{status:"authenticated",profileEditEnabled:false}]){
    let called=false;
    const api=harness(session,async()=>{called=true;return updated;});
    await assert.rejects(api.update("Nome novo"),/account-profile-edit-unavailable/);
    assert.equal(called,false);
  }
});
test("malformed payload is rejected before any network access",async()=>{
  let called=false;
  const api=harness(ready,async()=>{called=true;return updated;});
  for(const name of ["","  nome  ","x".repeat(121),"controle\ninvalido"]){
    await assert.rejects(api.update(name),/account-display-name-invalid/);
  }
  assert.equal(called,false);
});
test("server must confirm exact mutation receipt",async()=>{
  for(const value of [
    {...updated,updated:false},{...updated,displayName:"outro"},
    {...updated,schema:"wrong"},{...updated,user_id:"spoof"},
  ]){
    await assert.rejects(harness(ready,async()=>value).update("Nome novo"),
      /account-profile-update-unconfirmed/);
  }
});
test("response from superseded session cannot be displayed",async()=>{
  let resolve;
  const waiting=new Promise(r=>resolve=r);
  const api=harness(ready,()=>waiting);
  const pending=api.update("Nome novo");
  api.change({...ready});
  resolve(updated);
  await assert.rejects(pending,/public-account-session-changed/);
});
test("portal renders only escaped verified name, and edit remains gated",()=>{
  assert.match(portal, /session\.displayName \? esc\(session\.displayName\)/);
  assert.match(portal, /session\.profileEditEnabled === true/);
  assert.match(portal, /account\.refreshSession\(\)/);
  assert.match(portal, /session\.displayName !== proposed/);
  assert.match(portal, /if \(profileSaveBusy \|\| !signedIn\(\)/);
  assert.match(client,/profileEditEnabled === true/);
  assert.match(client,/"\/account\/profile\/display-name"/);
});
