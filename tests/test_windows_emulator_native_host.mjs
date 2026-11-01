import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdtemp,rm,writeFile,readFile,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createEmulatorNativeHost} from "../tools/windows-emulator/native-host.mjs";
import {createNativePreferenceStore} from "../system/adapters/native/preferences.mjs";
import {createNativeFirstRunStateStore} from "../system/adapters/native/first-run-state.mjs";
import {createWebIdentitySession} from "../system/adapters/web/identity.mjs";
import {createSameOriginIdentityCredentials} from "../system/adapters/web/identity-credentials.mjs";
import {completeFirstRunState,createInitialFirstRunState} from "../system/services/state/first-run.mjs";
import {createSystemTermsAcceptance} from "../system/contracts/system-terms.mjs";
// The existing Windows CI suite also runs the DPAPI Desktop account regressions.
import "./test_windows_desktop_account_vault.mjs";
import "./test_windows_desktop_local_session.mjs";
import "./test_windows_desktop_client_diagnostics.mjs";
import "./test_windows_desktop_device_profile.mjs";
import "./test_windows_desktop_state_grants.mjs";
import "./test_windows_desktop_wifi_radio.mjs";
import "./test_windows_desktop_observation_grants.mjs";
import "./test_windows_desktop_display_current_modes.mjs";

test("emulator development controls stay hidden unless explicitly requested",async()=>{
  const [html,main]=await Promise.all([
    readFile(new URL("../tools/windows-emulator/index.html",import.meta.url),"utf8"),
    readFile(new URL("../tools/windows-emulator/main.mjs",import.meta.url),"utf8"),
  ]);
  assert.match(html,/<details class="ordax-emulator-controls" data-emulator-controls hidden>/);
  assert.match(html,/body\[data-emulator-controls="visible"\] #ordax-emulator-surface \{grid-row:2;\}/);
  assert.doesNotMatch(html,/Emulador · sem kernel/);
  assert.match(main,/new URLSearchParams\(window\.location\.search\)\.get\("dev-controls"\) === "1"/);
  assert.match(main,/developmentControls\.hidden = !showDevelopmentControls/);
});

test("emulator persists through the real Native adapters and never grants hardware authority",async()=>{
  const prefix=join(tmpdir(),"ordax-emulator-host-");
  const directory=await mkdtemp(prefix);
  let middleware=createEmulatorNativeHost({stateDirectory:directory});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const request=(path,options={})=>fetch(origin+path,{...options,headers:{Origin:origin,...options.headers}});
  const windowRef={fetch:request};
  try {
    const firstRun=await createNativeFirstRunStateStore(windowRef);
    assert.equal(firstRun.load().completed,false);
    const preferences=await createNativePreferenceStore(windowRef);
    assert.equal(await preferences.save({"regional.locale":"en-US","regional.time-zone":"America/Manaus"}),true);
    const receipt=completeFirstRunState({locale:"en-US",timeZone:"America/Manaus",accountMode:"local-only",
      systemTerms:createSystemTermsAcceptance(true)});
    assert.equal(await firstRun.save(receipt),true);
    middleware=createEmulatorNativeHost({stateDirectory:directory});
    assert.deepEqual((await createNativeFirstRunStateStore(windowRef)).load(),receipt);
    assert.equal((await createNativePreferenceStore(windowRef)).load()["regional.time-zone"],"America/Manaus");
    const post=(path,body,headers={})=>request(path,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
    assert.equal((await post("/__ordax/native/first-run",createInitialFirstRunState())).status,409);
    assert.equal((await post("/__ordax/native/preferences",{}, {Origin:"https://untrusted.example"})).status,403);
    assert.equal((await post("/__ordax/native/first-run",{password:"never-accepted"})).status,400);
    for(const path of ["network-management","power-actions","app-data","local-session","product-device"])
      assert.equal((await request("/__ordax/native/"+path)).status,503);
    const unavailableSession=await request("/auth/session");
    assert.equal(unavailableSession.status,200);
    assert.equal((await unavailableSession.json()).provider,"unconfigured");
    assert.equal((await request("/__ordax/emulator/reset-first-run",{method:"POST"})).status,200);
    assert.equal((await createNativeFirstRunStateStore(windowRef)).load().completed,false);
    assert.equal((await createNativePreferenceStore(windowRef)).load()["regional.locale"],"en-US");
    await writeFile(join(directory,"native-state.json"),"{corrupt","utf8");
    assert.equal((await request("/__ordax/native/preferences")).status,503);
    assert.equal((await post("/__ordax/native/preferences",{})).status,503);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.ok(directory.startsWith(prefix));
    await rm(directory,{recursive:true,force:true});
  }
});

test("emulator account uses the configured HTTPS gateway without exposing or persisting session cookies",async()=>{
  const prefix=join(tmpdir(),"ordax-emulator-account-");
  const directory=await mkdtemp(prefix);
  const gatewayOrigin="https://account.example.test/functions/v1/ordax-account-gateway";
  let loginCalls=0;
  let registrationCalls=0;
  const fetchImpl=async(url,options={})=>{
    const path=new URL(url).pathname;
    const cookie=options.headers?.Cookie??"";
    if(path.endsWith("/auth/session")){
      const authenticated=cookie.includes("ordax_access=access-token");
      return Response.json(authenticated?{
        $schema:"prototype-ordax.public-identity-session/1",
        authenticated:true,status:"authenticated",provider:"supabase",
        subject:"subject-1",email:"pessoa@example.com",displayName:"Washington Silva",accountCloseEnabled:false,
      }:{
        $schema:"prototype-ordax.public-identity-session/1",
        authenticated:false,status:"anonymous",provider:"supabase",
      });
    }
    if(path.endsWith("/auth/login")){
      loginCalls+=1;
      assert.equal(options.method,"POST");
      assert.match(options.body,/email=pessoa%40example\.com/);
      const headers=new Headers();
      headers.append("set-cookie","ordax_access=access-token; Path=/; HttpOnly; Secure");
      headers.append("set-cookie","ordax_refresh=refresh-token; Path=/; HttpOnly; Secure");
      return new Response(null,{status:303,headers});
    }
    if(path.endsWith("/auth/registration-policy")){
      return Response.json({
        $schema:"prototype-ordax.registration-legal-policy/1",active:true,
        registrationEnabled:true,policyId:"123e4567-e89b-42d3-a456-426614174000",
        privacy:{version:"1",effectiveDate:"2026-10-01",sha256:"a".repeat(64),url:"https://ordax.com.br/privacidade/"},
        terms:{version:"1",effectiveDate:"2026-10-01",sha256:"b".repeat(64),url:"https://ordax.com.br/termos/"},
      });
    }
    if(path.endsWith("/auth/register"))registrationCalls+=1;
    return new Response(null,{status:404});
  };
  const middleware=createEmulatorNativeHost({stateDirectory:directory,accountGatewayOrigin:gatewayOrigin,fetchImpl});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const browserResponses=[];
  const request=async(path,options={})=>{
    const response=await fetch(origin+path,{...options,headers:{Origin:origin,...options.headers}});
    browserResponses.push({path,response});
    return response;
  };
  const windowRef={fetch:request};
  const identity=createWebIdentitySession(windowRef);
  const credentials=createSameOriginIdentityCredentials(windowRef);
  try{
    await identity.refresh();
    assert.equal(identity.getSnapshot().state,"signed-out");
    assert.equal((await credentials.registrationPolicy()).registrationEnabled,true);
    await credentials.signIn({email:"pessoa@example.com",password:"nao-e-credencial-real"});
    await identity.refresh();
    assert.deepEqual(identity.getSnapshot(),{
      state:"signed-in",subjectId:"subject-1",displayName:"Washington Silva",email:"pessoa@example.com",
    });
    assert.equal(loginCalls,1);
    const loginResponse=browserResponses.find(entry=>entry.path==="/auth/login")?.response;
    assert.ok(loginResponse);
    assert.equal(loginResponse.headers.get("set-cookie"),null);
    const sessionResponse=await request("/auth/session");
    assert.equal(sessionResponse.headers.get("set-cookie"),null);
    const sessionBody=await sessionResponse.text();
    assert.doesNotMatch(sessionBody,/access-token|refresh-token/);
    const registration=await request("/auth/register",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"email=pessoa%40example.com&password=senha&legal_acceptance=accepted",
    });
    assert.equal(registration.status,404);
    assert.equal(registrationCalls,1);
    assert.deepEqual(await readdir(directory),[]);
  }finally{
    identity.dispose();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    assert.ok(directory.startsWith(prefix));
    await rm(directory,{recursive:true,force:true});
  }
});

test("emulator registration reflects gateway policy and preserves email-confirmation semantics",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"ordax-emulator-register-"));
  let enabled=false;
  let calls=0;
  const fetchImpl=async(url,options={})=>{
    const path=new URL(url).pathname;
    if(path.endsWith("/auth/registration-policy"))return Response.json({
      $schema:"prototype-ordax.registration-legal-policy/1",
      active:true,registrationEnabled:enabled,policyId:"123e4567-e89b-42d3-a456-426614174000",
      privacy:{version:"1",effectiveDate:"2026-10-01",sha256:"a".repeat(64),url:"https://ordax.com.br/privacidade/"},
      terms:{version:"1",effectiveDate:"2026-10-01",sha256:"b".repeat(64),url:"https://ordax.com.br/termos/"},
    });
    if(path.endsWith("/auth/register")){
      calls++;
      assert.match(options.body,/legal_acceptance=accepted/);
      assert.match(options.body,/email=pessoa%40example\.com/);
      return new Response(null,{status:enabled?202:503});
    }
    if(path.endsWith("/auth/session"))return Response.json({
      $schema:"prototype-ordax.public-identity-session/1",
      authenticated:false,status:"anonymous",provider:"supabase",
    });
    return new Response(null,{status:404});
  };
  const middleware=createEmulatorNativeHost({
    stateDirectory:directory,
    accountGatewayOrigin:"https://account.example.test/functions/v1/ordax-account-gateway",
    fetchImpl,
  });
  const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const origin="http://127.0.0.1:"+server.address().port;
  const credentials=createSameOriginIdentityCredentials({fetch:(path,options={})=>
    fetch(origin+path,{...options,headers:{Origin:origin,...options.headers}})});
  try{
    assert.equal((await credentials.registrationPolicy()).registrationEnabled,false);
    await assert.rejects(()=>credentials.register({
      email:"pessoa@example.com",password:"longa-senha-apenas-para-teste",legalAccepted:true,
    }),/503/);
    assert.equal(calls,1);
    enabled=true;
    assert.equal((await credentials.registrationPolicy()).registrationEnabled,true);
    assert.deepEqual(await credentials.register({
      email:"pessoa@example.com",password:"longa-senha-apenas-para-teste",legalAccepted:true,
    }),{authenticated:false,confirmationRequired:true});
    assert.equal(calls,2);
    assert.deepEqual(await readdir(directory),[]);
  }finally{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
