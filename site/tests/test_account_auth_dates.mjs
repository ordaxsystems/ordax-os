import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client=readFileSync(new URL("../public/assets/site.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8").replace(/\r\n/g, "\n");
const start=client.indexOf("  function validAuthSessionDate(value) {");
const end=client.indexOf("\n  }\n\n  function validSessionReadiness(value)",start);
assert.ok(start>=0&&end>start,"single session date validator missing");
const fn=new Function(client.slice(start,end+4)+"\nreturn validAuthSessionDate;")();

test("only canonical ISO UTC timestamps enter the authenticated presentation snapshot",()=>{
  assert.equal(fn("2025-01-20T12:00:00.000Z"),true);
  for(const bad of [
    null,undefined,"",10,"2025-01-20","2025-01-20T12:00:00Z",
    "2025-01-20T12:00:00+00:00","not-a-date","2100-01-01T00:00:00.000Z",
    "1970-01-01T00:00:00.000Z",
  ])assert.equal(fn(bad),false);
});
test("Auth dates are read from the existing owner session, never browser-stored claims",()=>{
  assert.match(client,/value\.registeredAt === undefined \|\| validAuthSessionDate\(value\.registeredAt\)/);
  assert.match(client,/value\.lastSignInAt === undefined \|\| validAuthSessionDate\(value\.lastSignInAt\)/);
  assert.match(client,/session\.authenticated && typeof session\.registeredAt === "string"/);
  assert.match(client,/session\.authenticated && typeof session\.lastSignInAt === "string"/);
  assert.doesNotMatch(client,/localStorage\.setItem\([^)]*(?:registeredAt|lastSignInAt)/);
});
test("overview shows registered date and security explicitly distinguishes last login from full history",()=>{
  assert.match(portal,/authDateLabel\("registeredAt"\)/);
  assert.match(portal,/authDateLabel\("lastSignInAt", true\)/);
  assert.match(portal,/Último login registrado/);
  assert.match(portal,/Histórico de segurança não disponível/);
  assert.doesNotMatch(portal, /id === "accessEvents" && /);
});
test("anonymous and preview views cannot show previous session timestamps",()=>{
  const begin=portal.indexOf("  function authDateLabel(field, includeTime = false) {");
  const finish=portal.indexOf("\n  }\n\n  function overview()",begin);
  assert.ok(begin>=0 && finish>begin);
  const snippet=portal.slice(begin,finish+4);
  const make = (signedIn,session)=>{
    return new Function("signedIn","session","i18n","tx","esc",snippet+"\nreturn authDateLabel;")(
      ()=>signedIn,session,{getLocale:()=>"pt-BR"}, x=>x,x=>String(x));
  };
  assert.equal(make(false,{registeredAt:"2024-01-01T00:00:00.000Z"})("registeredAt"),"Não disponível");
  assert.equal(make(true,{registeredAt:""})("registeredAt"),"Não disponível");
  assert.notEqual(make(true,{registeredAt:"2024-01-01T00:00:00.000Z"})("registeredAt"),"Não disponível");
});
