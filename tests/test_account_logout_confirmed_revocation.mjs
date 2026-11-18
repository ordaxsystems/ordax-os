import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { revokeSupabaseLocalSession } from "../infra/supabase/functions/_shared/account_local_signout.mjs";

const source=readFileSync(
  new URL("../infra/supabase/functions/ordax-account-gateway/index.ts",import.meta.url),"utf8");

function makeLogoutMock({cookie="",bearer="",getSession=async()=>({user:{id:"test"},access:"user-jwt",cookies:[]}),revoke=async()=>true}={}){
  const visited={resolve:0,revoke:[],clear:0};
  const first=source.indexOf("async function logoutCurrentAccountSession(req: Request): Promise<Response> {");
  const last=source.indexOf("\n}\n\nfunction safeAccountDisplayName(",first);
  assert.ok(first>=0 && last>first,"canonical logout routine required");
  const code=source.slice(first,last+2)
    .replace("req: Request): Promise<Response>","req)")
    .replace("sessionCookies: string[] = []","sessionCookies = []");
  const json=(status,value,setCookies=[])=>{
    return {status,value,cookies:setCookies};
  };
  const fn=new Function(
    "parseCookies","bearerUserToken","authenticated","revokeCurrentSession",
    "json","wantsJson","redirectResponse","clearCookies","clearRecoveryCookies",
    "ACCESS_COOKIE","REFRESH_COOKIE","ERROR_SCHEMA",
    code+"\nreturn logoutCurrentAccountSession;",
  )(
    ()=>new Map(cookie.split(";").filter(Boolean).map(x=>x.split("=",2).map(y=>y.trim()))),
    ()=>bearer,
    async()=>{visited.resolve++;return getSession()},
    async(token)=>{visited.revoke.push(token);return revoke(token)},
    json,()=>true,()=>{throw Error("unexpected-redirect")},
    ()=>{visited.clear++;return ["access=expired"]},
    ()=>["recovery=expired"],"ordax_access","ordax_refresh","test-error-schema",
  );
  return {run:()=>fn({}),visited};
}

test("local scope calls existing Supabase Auth /logout with verified JWT only",async()=>{
  const called=[];
  const ok=await revokeSupabaseLocalSession({
    url:"https://jhfphsjptrpmtnzkpwud.supabase.co",
    key:"public-publishable-key",
    accessToken:"verified-jwt-test",
    send:async(u,o)=>{called.push({u,o});return new Response(null,{status:204});},
  });
  assert.equal(ok,true);
  assert.equal(called.length,1);
  assert.equal(called[0].u,
    "https://jhfphsjptrpmtnzkpwud.supabase.co/auth/v1/logout?scope=local");
  assert.equal(called[0].o.method,"POST");
  assert.equal(called[0].o.headers.apikey,"public-publishable-key");
  assert.equal(called[0].o.headers.authorization,"Bearer verified-jwt-test");
  assert.equal(called[0].o.redirect,"manual");
  assert.equal(called[0].o.cache,"no-store");
  assert.ok(called[0].o.signal instanceof AbortSignal);
  assert.equal(called[0].o.body,undefined);
});
test("unknown origins, HTTP remote, secrets with injection and invalid configuration never send",async()=>{
  let calls=0;
  const send=async()=>{calls++;return new Response(null,{status:204})};
  for(const opts of [
    {url:"http://example.com",key:"anon",accessToken:"jwt"},
    {url:"https://example.com/subpath",key:"anon",accessToken:"jwt"},
    {url:"https://user:pass@example.com",key:"anon",accessToken:"jwt"},
    {url:"https://example.com?x=y",key:"anon",accessToken:"jwt"},
    {url:"https://example.com",key:"abc\ninject",accessToken:"jwt"},
    {url:"https://example.com",key:"anon",accessToken:"jwt\r\nother"},
    {url:"https://example.com",key:"",accessToken:"jwt"},
  ]) assert.equal(await revokeSupabaseLocalSession({...opts,send}),false);
  assert.equal(calls,0);
});
test("remote Auth failures and redirects cannot be mistaken for signed out",async()=>{
  for(const outcome of [
    new Response(null,{status:400}),
    new Response(null,{status:401}),
    new Response(null,{status:403}),
    new Response(null,{status:404}),
    new Response(null,{status:500}),
    new Response(null,{status:302,headers:{location:"https://evil.example"}}),
  ]){
    assert.equal(await revokeSupabaseLocalSession({
      url:"https://jhfphsjptrpmtnzkpwud.supabase.co",key:"anon",accessToken:"verified-token",
      send:async()=>outcome.clone(),
    }),false);
  }
  assert.equal(await revokeSupabaseLocalSession({
    url:"https://jhfphsjptrpmtnzkpwud.supabase.co",key:"anon",accessToken:"verified-token",
    send:async()=>{throw Error("network-down")},
  }),false);
});
test("anonymous logout remains idempotent without making a revoke request",async()=>{
  const h=makeLogoutMock();
  const r=await h.run();
  assert.equal(r.status,200);
  assert.equal(r.value.signedOut,true);
  assert.equal(h.visited.resolve,0);
  assert.equal(h.visited.revoke.length,0);
  assert.equal(h.visited.clear,1);
});
test("current access session requires real remote acknowledgment",async()=>{
  const h=makeLogoutMock({cookie:"ordax_access=stale-cookie",getSession:async()=>({
    user:{id:"test"},access:"validated-token",cookies:[],
  })});
  const r=await h.run();
  assert.equal(r.status,200);
  assert.equal(r.value.signedOut,true);
  assert.deepEqual(h.visited.revoke,["validated-token"]);
});
test("refresh-only session rotates then revokes verified renewed access token",async()=>{
  const h=makeLogoutMock({cookie:"ordax_refresh=old",getSession:async()=>({
    user:{id:"test"},access:"new-access-token",cookies:["ordax_refresh=new"],
  })});
  const r=await h.run();
  assert.equal(r.status,200);
  assert.deepEqual(h.visited.revoke,["new-access-token"]);
  assert.equal(r.value.signedOut,true);
});
test("revoke failure never returns signedOut or clears cookies; rotated session survives for retry",async()=>{
  const h=makeLogoutMock({cookie:"ordax_refresh=old",getSession:async()=>({
    user:{id:"test"},access:"rotated-token",cookies:["ordax_refresh=fresh"],
  }),revoke:async()=>false});
  const r=await h.run();
  assert.equal(r.status,503);
  assert.equal(r.value.error,"account-logout-revocation-unconfirmed");
  assert.equal(r.value.signedOut,undefined);
  assert.deepEqual(r.cookies,["ordax_refresh=fresh"]);
  assert.equal(h.visited.clear,0);
  assert.deepEqual(h.visited.revoke,["rotated-token"]);
});
test("unverified or unavailable identity cannot claim logout success",async()=>{
  for(const getSession of [
    async()=>({user:null,access:"",cookies:["ordax_access=expired"]}),
    async()=>{throw Error("Auth-unavailable")},
  ]){
    const h=makeLogoutMock({cookie:"ordax_access=old",getSession});
    const r=await h.run();
    assert.equal(r.status,503);
    assert.equal(r.value.signedOut,undefined);
    assert.equal(h.visited.clear,0);
    assert.equal(h.visited.revoke.length,0);
  }
});
test("existing public and Native logout paths share the strict handler",()=>{
  assert.equal(source.split('return logoutCurrentAccountSession(req);').length,3);
  assert.doesNotMatch(source,/client\(access\)\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(source,/revokeSupabaseLocalSession\(\{ url, key, accessToken \}\)/);
  assert.match(source,/hasCredential = Boolean\([\s\S]{0,130}bearerUserToken\(req\)/);
});
