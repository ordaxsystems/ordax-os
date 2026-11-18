import test from "node:test";
import assert from "node:assert/strict";
import {
  RELEASE_NEGATIVE_CASES,
  proveAccountGatewayNegativeBoundary,
} from "../tools/account/prove_gateway_negative_boundary.mjs";

const ref = "jhfphsjptrpmtnzkpwud";

function mock(mode, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      $schema: "prototype-ordax.error/1",
      error: mode === "internal"
        ? "native-account-session-required"
        : "public-proxy-authentication-required",
      message: "Not authorized",
    }), {
      status: mode === "internal" ? 401 : 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
}

test("release checks every Account mutation and read without ever supplying valid mutation input",async()=>{
  for(const mode of ["internal","public"]){
    const calls=[];
    const result=await proveAccountGatewayNegativeBoundary({
      mode,projectRef:ref,request:mock(mode,calls),
    });
    assert.equal(result.status,"pass");
    assert.equal(result.cases,RELEASE_NEGATIVE_CASES[mode].length);
    assert.equal(result.authenticated_requests,0);
    assert.equal(result.mutation_payloads_valid,false);
    assert.equal(result.user_identifiers_collected,false);
    assert.equal(calls.length,result.cases);
    for(let i=0;i<calls.length;i++){
      const {url,options}=calls[i];
      assert.equal(url,"https://"+ref+".supabase.co/functions/v1/"
        +(mode==="internal"?"ordax-account-gateway":"ordax-public-account-gateway")
        +RELEASE_NEGATIVE_CASES[mode][i][1]);
      assert.equal(options.method,RELEASE_NEGATIVE_CASES[mode][i][0]);
      assert.equal(options.redirect,"manual");
      assert.equal(options.credentials,"omit");
      assert.equal(options.cache,"no-store");
      assert.equal(options.headers.authorization,undefined);
      assert.equal(options.headers.cookie,undefined);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.body,options.method==="POST"?"{}":undefined);
    }
  }
});

test("bad project ref or mode never performs network work",async()=>{
  let calls=0;
  const request=async()=>{calls++;throw Error("unexpected-network")};
  for(const input of [
    {mode:"public",projectRef:"../../evil"},
    {mode:"internal",projectRef:""},
    {mode:"other",projectRef:ref},
    {mode:"internal",projectRef:"fake.example.com"},
  ]) await assert.rejects(proveAccountGatewayNegativeBoundary({ ...input,request }));
  assert.equal(calls,0);
});

test("unauthenticated 200, 400, redirect and missing boundary code must fail closed",async()=>{
  for(const response of [
    new Response(JSON.stringify({error:"native-account-session-required"}),{
      status:200,headers:{"content-type":"application/json"},
    }),
    new Response(JSON.stringify({error:"invalid-communications"}),{
      status:400,headers:{"content-type":"application/json"},
    }),
    new Response(null,{status:302,headers:{location:"https://example.net"}}),
    new Response(JSON.stringify({error:"other"}),{
      status:401,headers:{"content-type":"application/json"},
    }),
    new Response(JSON.stringify({error:"native-account-session-required",subject:"leak"}),{
      status:401,headers:{"content-type":"application/json"},
    }),
  ]) await assert.rejects(proveAccountGatewayNegativeBoundary({
    mode:"internal",projectRef:ref,request:async()=>response.clone(),
  }));
});

test("public OIDC boundary rejects forged success and missing body",async()=>{
  for(const response of [
    new Response(JSON.stringify({error:"not-authorized"}),{
      status:403,headers:{"content-type":"application/json"},
    }),
    new Response(null,{status:403,headers:{"content-type":"application/json"}}),
    new Response("not json",{status:403,headers:{"content-type":"application/json"}}),
  ]) await assert.rejects(proveAccountGatewayNegativeBoundary({
    mode:"public",projectRef:ref,request:async()=>response.clone(),
  }));
});

test("no change to release authorizations or public Account rollout flags",()=>{
  assert.equal(RELEASE_NEGATIVE_CASES.internal.some(([method,path])=>
    method==="POST"&&path==="/account/preferences/communications"),true);
  assert.equal(RELEASE_NEGATIVE_CASES.public.some(([method,path])=>
    method==="POST"&&path==="/account/preferences/locale"),true);
});
