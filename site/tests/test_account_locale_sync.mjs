import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const client=readFileSync(new URL("../public/assets/site.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const begin=client.indexOf("    async updatePreferredLocale(locale, signal) {");
const end=client.indexOf("\n    },\n    // The verified Account session authorizes read only.",begin);
assert.ok(begin>=0&&end>begin,"canonical Account locale port required");
const body=client.slice(begin+"    async updatePreferredLocale(locale, signal) {".length,end);
function harness(session,transport){
  return new Function("loadJson","initial",
    "let sessionView=initial;return {update:async function(locale,signal) {"+body+"},"+
    "replaceSession(next){sessionView=next;}};")(transport,session);
}
const authenticated={status:"authenticated",localePreferenceEditEnabled:true,preferredLocale:"pt-BR"};
const confirmed={schema:"ordax.account-preferred-locale-update/1",preferredLocale:"en-US",updated:true};

test("explicit authorized Account save uses one exact same-origin POST, never user metadata",async()=>{
  const calls=[];
  const port=harness(authenticated,async (...a)=>{calls.push(a);return confirmed});
  assert.deepEqual(await port.update("en-US"),confirmed);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/preferences/locale");
  assert.deepEqual(calls[0][2],{
    maxBytes:2048,method:"POST",jsonBody:{preferred_locale:"en-US"},
  });
  assert.match(client,/\"\/account\/preferences\/locale\"/);
  assert.doesNotMatch(body,/localStorage|user_id|service_role|raw_user_meta_data/);
});
test("anonymous and public-disabled sessions cannot write locale",async()=>{
  for(const session of [
    {status:"anonymous",localePreferenceEditEnabled:true},
    {status:"authenticated",localePreferenceEditEnabled:false},
    {status:"checking",localePreferenceEditEnabled:false},
  ]){
    let wrote=false;
    const port=harness(session,async()=>{wrote=true;return confirmed});
    await assert.rejects(port.update("en-US"),/account-locale-edit-unavailable/);
    assert.equal(wrote,false);
  }
});
test("invalid locales are rejected client-side without network work",async()=>{
  let wrote=false;
  const port=harness(authenticated,async()=>{wrote=true;return confirmed});
  for(const locale of ["","en","pt","es-ES","pt-br",null,1,{},["pt-BR"]]){
    await assert.rejects(port.update(locale),/account-locale-invalid/);
  }
  assert.equal(wrote,false);
});
test("malformed, foreign or unconfirmed receipts are never accepted",async()=>{
  for(const forged of [
    null,{...confirmed,updated:false},{...confirmed,preferredLocale:"pt-BR"},
    {...confirmed,schema:"unknown"},{...confirmed,token:"leak"},
  ]){
    await assert.rejects(harness(authenticated,async()=>forged).update("en-US"),
      /account-locale-update-unconfirmed/);
  }
});
test("late result from another session is discarded, even with matching locale",async()=>{
  let resolve;
  const pendingTransport=new Promise(r=>resolve=r);
  const port=harness(authenticated,()=>pendingTransport);
  const pending=port.update("en-US");
  port.replaceSession({...authenticated});
  resolve(confirmed);
  await assert.rejects(pending,/public-account-session-changed/);
});
test("session preserves optional verified locale but never uses it as authentication",()=>{
  assert.match(client,/value\.preferredLocale === undefined \|\| value\.preferredLocale === "pt-BR"/);
  assert.match(client,/value\.localePreferenceEditEnabled === undefined \|\| typeof value\.localePreferenceEditEnabled === "boolean"/);
  assert.match(client,/session\.authenticated && session\.localePreferenceEditEnabled === true/);
  assert.match(client,/session\.authenticated && typeof session\.preferredLocale === "string"/);
});
test("local language still works without account; account readback is required for success",()=>{
  assert.match(portal,/event\.target\.id === "account-locale"/);
  assert.match(portal,/i18n\.setLocale\(event\.target\.value\)/);
  assert.match(portal,/account\.updatePreferredLocale\(locale\)/);
  assert.match(portal,/await account\.refreshSession\(\)/);
  assert.match(portal,/session\.preferredLocale !== locale/);
  assert.match(portal,/localeFromAccountApplied = true/);
  assert.match(portal,/session\.preferredLocale === "pt-BR" \|\| session\.preferredLocale === "en-US"/);
  assert.match(portal,/data-account-save-locale/);
  assert.match(portal,/localePreferenceEditEnabled === true/);
});
