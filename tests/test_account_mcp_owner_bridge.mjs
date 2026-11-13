import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {isPublicBridgeRoute,isPublicAccountPreActivationRoute} from "../infra/supabase/functions/_shared/account_transport_admission.mjs";
import {
  ACCOUNT_MCP_DEVICES_PATH, ACCOUNT_MCP_AUTHORITY_PATH, ACCOUNT_MCP_REVOKE_PATH,
  OWNER_MCP_DEVICES_URL, validateAccountOwnerDevices,validateAccountOwnerAuthority,
  readAccountOwnerDevices,readAccountOwnerAuthority,revokeAccountOwnerGrant,parseAccountOwnerRevoke,
  ACCOUNT_MCP_CENTRAL_TARGETS_PATH,ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH,
  readAccountOwnerCentralTargets,readAccountOwnerCentralSelections,
  selectAccountOwnerCentralDevice,parseAccountOwnerCentralSelection,
  ACCOUNT_MCP_PROJECT_ONBOARDING_PATH,ACCOUNT_MCP_PROJECTS_PATH,
  OWNER_PROJECT_ONBOARDING_URL,OWNER_PROJECTS_URL,
  validateAccountOwnerProjectOnboarding,readAccountOwnerProjectOnboarding,
  parseAccountOwnerProjectCreate,createAccountOwnerProject,
} from "../infra/supabase/functions/_shared/account_mcp_owner.mjs";

const device="11111111-1111-4111-8111-111111111111";
const other="44444444-4444-4444-8444-444444444444";
const client="22222222-2222-4222-8222-222222222222";
const group="33333333-3333-4333-8333-333333333333";
const space="55555555-5555-4555-8555-555555555555";
const project="66666666-6666-4666-8666-666666666666";
const access="abcDEFghi.abcDEFghi.abcDEFghi";
const row={device_id:device,name:"OrdaX Desktop",kind:"desktop",
  channel:"development",state:"active",online:true,runtime_ready:true,last_seen_at:null};
const inventory={ok:true,schema:"ordax.owner-mcp-devices/1",count:1,devices:[row]};
const authority={ok:true,device_id:device,clients:[{client_id:client,client_name:"ChatGPT"}],
  grant_groups:[{grant_group_id:group,client_id:client,device_id:device,
    profile_key:"full-computer-control",valid_until:null,client_consent_active:true}]};
const makeResponse=(body,url,status=200)=>{
  const response=new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  Object.defineProperty(response,"url",{value:url});
  return response;
};
const transport=(responses,calls=[])=>async (url,options)=>{
  calls.push({url,options});
  const next=responses.shift();
  if(!next)throw Error("unexpected-upstream");
  return makeResponse(next,url);
};

test("Only three explicit MCP Owner routes, not publicly preactivated",()=>{
  for(const [method,path] of [["GET",ACCOUNT_MCP_DEVICES_PATH],
                              ["GET",ACCOUNT_MCP_AUTHORITY_PATH],
                              ["POST",ACCOUNT_MCP_REVOKE_PATH]]) {
    assert.equal(isPublicBridgeRoute(method,path),true);
    assert.equal(isPublicAccountPreActivationRoute(method,path),false);
    assert.equal(isPublicBridgeRoute(method==="GET"?"POST":"GET",path),false);
  }
  assert.equal(isPublicBridgeRoute("GET","/account/mcp/devices/other"),false);
  for(const path of [ACCOUNT_MCP_CENTRAL_TARGETS_PATH,ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH]){
    assert.equal(isPublicBridgeRoute("GET",path),true);
    assert.equal(isPublicAccountPreActivationRoute("GET",path),false);
  }
  assert.equal(isPublicBridgeRoute("POST",ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH),true);
  assert.equal(isPublicAccountPreActivationRoute("POST",ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH),false);
  assert.equal(isPublicBridgeRoute("POST",ACCOUNT_MCP_CENTRAL_TARGETS_PATH),false);
  assert.equal(isPublicBridgeRoute("GET",ACCOUNT_MCP_PROJECT_ONBOARDING_PATH),true);
  assert.equal(isPublicAccountPreActivationRoute("GET",ACCOUNT_MCP_PROJECT_ONBOARDING_PATH),false);
  assert.equal(isPublicBridgeRoute("POST",ACCOUNT_MCP_PROJECT_ONBOARDING_PATH),false);
  assert.equal(isPublicBridgeRoute("POST",ACCOUNT_MCP_PROJECTS_PATH),true);
  assert.equal(isPublicAccountPreActivationRoute("POST",ACCOUNT_MCP_PROJECTS_PATH),false);
  assert.equal(isPublicBridgeRoute("GET",ACCOUNT_MCP_PROJECTS_PATH),false);
});
test("Gateway Owner routes keep Supabase cookie authorization and fail-closed rollout",()=>{
  const source=readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts",import.meta.url),"utf8");
  assert.match(source,/ORDAX_MCP_OWNER_ACCOUNT_ENABLED/);
  assert.match(source,/await authenticated\(req\)/);
  assert.match(source,/verifyTrustedPublicRequestContext\(req\)\.ok/);
  assert.doesNotMatch(source,/origin\.host\.toLowerCase\(\) === forwardedHost/);
  assert.match(source,/await revokeAccountOwnerGrant\(session.access, revokeRequest\)/);
  assert.match(source,/mcp-owner-revoke-unconfirmed/);
  assert.match(source,/ORDAX_MCP_OWNER_CENTRAL_SELECTION_ENABLED/);
  assert.match(source,/parseAccountOwnerCentralSelection\(selection\)/);
  assert.match(source,/selectAccountOwnerCentralDevice\(session.access, selection\)/);
  assert.match(source,/mcp-owner-central-selection-unconfirmed/);
  assert.match(source,/ORDAX_MCP_OWNER_PROJECT_ONBOARDING_ENABLED/);
  assert.match(source,/readAccountOwnerProjectOnboarding\(session\.access, deviceIds\[0\]\)/);
  assert.match(source,/parseAccountOwnerProjectCreate\(projectCreate\)/);
  assert.match(source,/createAccountOwnerProject\(session\.access, projectCreate\)/);
  assert.match(source,/mcp-owner-project-create-unconfirmed/);
  assert.doesNotMatch(source,/x-ordax-owner-token/);
});
test("Authenticated public bridge carries the verified origin, never mutable forwarded host",()=>{
  const outer=readFileSync(new URL("../infra/supabase/functions/ordax-public-account-gateway/index.ts",import.meta.url),"utf8");
  const inner=readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts",import.meta.url),"utf8");
  assert.match(outer,/upstreamHeaders\(req, bridgeKey, requestContext\.origin, requestContext\.host\)/);
  assert.match(outer,/headers\.set\("x-ordax-public-origin", trustedOrigin\)/);
  assert.match(outer,/headers\.set\("x-ordax-public-host", trustedHost\)/);
  assert.match(inner,/if \(publicSiteRequest\(req\)\) return !verifyTrustedPublicRequestContext\(req\)\.ok;/);
  assert.match(inner,/if \(!publicSiteRequest\(req\) \|\| !verifyTrustedPublicRequestContext\(req\)\.ok\)/);
  assert.doesNotMatch(inner,/origin\.host\.toLowerCase\(\) === forwardedHost/);
});

test("Owner inventory is bounded, typed, deduplicated, and projected",()=>{
  assert.deepEqual(validateAccountOwnerDevices(inventory),inventory);
  for(const bad of [{...inventory,count:2},{...inventory,devices:[row,row],count:2},
    {...inventory,devices:[{...row,online:"true"}]},
    {...inventory,devices:[{...row,device_id:"evil"}]},
    {...inventory,schema:"other"}])assert.equal(validateAccountOwnerDevices(bad),null);
});
test("Only fixed HTTPS Owner endpoint receives a server-side bearer",async()=>{
  const calls=[];
  const result=await readAccountOwnerDevices(access,transport([inventory],calls));
  assert.deepEqual(result,inventory);
  assert.equal(calls[0].url,OWNER_MCP_DEVICES_URL);
  assert.equal(calls[0].options.headers.Authorization,"Bearer "+access);
  assert.equal(calls[0].options.redirect,"error");
  assert.ok(!JSON.stringify(result).includes(access));
  await assert.rejects(readAccountOwnerDevices("bad",transport([inventory])),/access-invalid/);
  await assert.rejects(readAccountOwnerDevices(access,async()=>new Response(JSON.stringify(inventory))),/upstream-unavailable/);
});
test("Authority read ties every group to the requested device",async()=>{
  const result=validateAccountOwnerAuthority(authority,device);
  assert.equal(result.schema,"ordax.owner-mcp-authority-view/1");
  assert.equal(result.grant_groups[0].client_consent_active,true);
  assert.equal(validateAccountOwnerAuthority({...authority,device_id:other},device),null);
  assert.equal(validateAccountOwnerAuthority({...authority,grant_groups:[{...authority.grant_groups[0],device_id:other}]},device),null);
  assert.equal(validateAccountOwnerAuthority({...authority,grant_groups:[authority.grant_groups[0],authority.grant_groups[0]]},device),null);
  assert.deepEqual(await readAccountOwnerAuthority(access,device,transport([authority])),result);
});
test("Project onboarding projects only bounded canonical state and exact Owner mutations",async()=>{
  const state={ok:true,device_id:device,
    spaces:[{space_id:space,name:"Owner",kind:"work",state:"active",secret:"drop"}],
    projects:[{project_id:project,space_id:space,name:"Platform",kind:"development",
      state:"active",github_connection_count:0,repository_full_name:null,
      space_device_execute:false,project_device_bound:false,
      next_state:"needs_github_installation",installation_id:99}],
    next_state:null,owner_user_id:other};
  const projected=validateAccountOwnerProjectOnboarding(state,device);
  assert.equal(projected.schema,"ordax.owner-project-onboarding-view/1");
  assert.equal(projected.spaces.length,1);
  assert.equal(projected.projects[0].next_state,"needs_github_installation");
  assert.equal("installation_id" in projected.projects[0],false);
  assert.equal("owner_user_id" in projected,false);
  const calls=[];
  assert.deepEqual(await readAccountOwnerProjectOnboarding(access,device,transport([state],calls)),projected);
  assert.equal(calls[0].url,OWNER_PROJECT_ONBOARDING_URL+"?device_id="+device);

  const input={space_id:space,name:" Platform ",kind:"development",confirm:"create_project"};
  assert.deepEqual(parseAccountOwnerProjectCreate(input),
    {space_id:space,name:"Platform",kind:"development",confirm:"create_project"});
  for(const bad of [
    {...input,repository_id:123},{...input,installation_id:456},
    {...input,repository_full_name:"ordaxsystems/ordax-platform"},
    {...input,grant_profile:"project-native-terminal"},{...input,device_id:device},
    {...input,confirm:"yes"}
  ]) assert.equal(parseAccountOwnerProjectCreate(bad),null);

  const createCalls=[];
  const response={ok:true,project_id:project,space_id:space,state:"active",
    next_state:"needs_github_installation",created_by_user_id:other};
  const created=await createAccountOwnerProject(access,input,async(url,options)=>{
    createCalls.push({url,options});
    return makeResponse(response,url,201);
  });
  assert.deepEqual(created,{ok:true,schema:"ordax.owner-project-created/1",
    project_id:project,space_id:space,state:"active",next_state:"needs_github_installation"});
  assert.equal(createCalls.length,1);
  assert.equal(createCalls[0].url,OWNER_PROJECTS_URL);
  assert.equal(createCalls[0].options.method,"POST");
  assert.deepEqual(JSON.parse(createCalls[0].options.body),
    {space_id:space,name:"Platform",kind:"development",confirm:"create_project"});
});

test("Project onboarding rejects ambiguous state instead of inventing readiness",()=>{
  const base={ok:true,device_id:device,
    spaces:[{space_id:space,name:"Owner",kind:"work",state:"active"}],
    projects:[],next_state:"needs_project"};
  assert.ok(validateAccountOwnerProjectOnboarding(base,device));
  for(const bad of [
    {...base,device_id:other},
    {...base,next_state:null},
    {...base,projects:[{project_id:project,space_id:space,name:"Platform",kind:"development",
      state:"active",github_connection_count:1,repository_full_name:null,
      space_device_execute:false,project_device_bound:false,next_state:"needs_github_installation"}]},
  ]) assert.equal(validateAccountOwnerProjectOnboarding(bad,device),null);
});

test("Old grant with withdrawn OAuth consent is still visible to Owner for revocation",()=>{
  const result=validateAccountOwnerAuthority({...authority,clients:[],
    grant_groups:[{...authority.grant_groups[0],client_consent_active:false}]},device);
  assert.equal(result.grant_groups.length,1);
  assert.equal(result.grant_groups[0].client_consent_active,false);
});
test("Explicit revoke targets exactly one group, checks authority before and after",async()=>{
  const input={device_id:device,client_id:client,grant_group_id:group,confirm:"revogar"};
  assert.deepEqual(parseAccountOwnerRevoke(input),
    {device_id:device,client_id:client,grant_group_id:group});
  assert.equal(parseAccountOwnerRevoke({...input,confirm:"yes"}),null);
  assert.equal(parseAccountOwnerRevoke({...input,owner_id:device}),null);
  const calls=[];
  const result=await revokeAccountOwnerGrant(access,input,
    transport([authority,{ok:true},{...authority,grant_groups:[]}],calls));
  assert.equal(result.revoked,true);
  assert.deepEqual(calls.map(call=>call.options.method),["GET","DELETE","GET"]);
  assert.equal(calls[1].url,
    "https://mcp.ordax.com.br/v3/owner/remote-grant-groups/"+group+"?client_id="+client);
});
test("Isolated revoke proves every unrelated grant survives, including another OAuth client",async()=>{
  const input={device_id:device,client_id:client,grant_group_id:group,confirm:"revogar"};
  const otherClient="66666666-6666-4666-8666-666666666666";
  const extraSame={...authority.grant_groups[0],
    grant_group_id:"55555555-5555-4555-8555-555555555555",profile_key:"mcp-discovery"};
  const extraOther={...authority.grant_groups[0],
    grant_group_id:"77777777-7777-4777-8777-777777777777",
    client_id:otherClient,profile_key:"mcp-discovery"};
  const before={...authority,grant_groups:[authority.grant_groups[0],extraSame,extraOther]};
  const after={...before,grant_groups:[extraSame,extraOther]};
  const successCalls=[];
  const confirmed=await revokeAccountOwnerGrant(access,input,
    transport([before,{ok:true},after],successCalls));
  assert.equal(confirmed.revoked,true);
  assert.equal(successCalls.filter(call=>call.options.method==="DELETE").length,1);

  for(const invalidAfter of [
    {...after,grant_groups:[extraSame]},
    {...after,grant_groups:[{...extraSame,profile_key:"full-computer-control"},extraOther]},
    {...after,grant_groups:[extraSame,{...extraOther,client_id:client}]},
    {...after,grant_groups:[{...extraSame,valid_until:"2026-12-01T10:00:00.000Z"},extraOther]},
    {...after,grant_groups:[extraSame,{...extraOther,client_consent_active:false}]},
  ]){
    const calls=[];
    await assert.rejects(revokeAccountOwnerGrant(access,input,
      transport([before,{ok:true},invalidAfter],calls)),/revoke-isolation-unverified/);
    assert.equal(calls.filter(call=>call.options.method==="DELETE").length,1);
  }
  const reused={...after,grant_groups:[...after.grant_groups,
    {...authority.grant_groups[0],client_id:otherClient}]};
  await assert.rejects(revokeAccountOwnerGrant(access,input,
    transport([before,{ok:true},reused])),/revoke-unconfirmed/);
});

test("Stale and cross-device groups fail before DELETE",async()=>{
  const input={device_id:device,client_id:client,grant_group_id:group,confirm:"revogar"};
  for(const invalid of [{...authority,grant_groups:[]},{...authority,device_id:other}]){
    const calls=[];
    await assert.rejects(revokeAccountOwnerGrant(access,input,transport([invalid],calls)));
    assert.equal(calls.length,1);
  }
});
test("Ambiguous or unverifiable revocation does not replay DELETE",async()=>{
  const input={device_id:device,client_id:client,grant_group_id:group,confirm:"revogar"};
  const calls=[];
  await assert.rejects(revokeAccountOwnerGrant(access,input,
    transport([authority,{ok:true},authority],calls)),/revoke-unconfirmed/);
  assert.equal(calls.filter(call=>call.options.method==="DELETE").length,1);
});

test("Owner central preflight projects Platform eligibility and tickets without claiming attestation",async()=>{
  const ticket="99999999-9999-4999-8999-999999999999";
  const expiry=new Date(Date.now()+120000).toISOString();
  const targets={ok:true,client_id:client,eligible_device_count:1,
    state:"single_granted_target",targets:[{device_id:device,reported_online:true,
      runtime_ready:true}],attested:false,dispatch_authorized:false,owner_choice_performed:false};
  const waiting={ok:true,count:1,pending_selections:[{challenge_id:ticket,
    created_at:new Date(Date.now()-1000).toISOString(),expires_at:expiry}],
    attested:false,dispatch_authorized:false};
  assert.equal((await readAccountOwnerCentralTargets(access,client,
    transport([targets]))).targets[0].device_id,device);
  const offlineProjection=await readAccountOwnerCentralTargets(access,client,
    transport([{...targets,targets:[{...targets.targets[0],reported_online:false,
      runtime_ready:false}]}]));
  assert.equal(offlineProjection.targets[0].device_id,device);
  assert.equal(offlineProjection.targets[0].reported_online,false,
    "offline is availability only; it must not rewrite the Owner target");
  assert.equal((await readAccountOwnerCentralSelections(access,client,
    transport([waiting]))).pending_selections[0].challenge_id,ticket);
  const input={client_id:client,device_id:device,challenge_id:ticket,confirm:"selecionar"};
  assert.deepEqual(parseAccountOwnerCentralSelection(input),
    {client_id:client,device_id:device,challenge_id:ticket});
  for(const bad of [{...input,confirm:"yes"},{...input,device_id:other},
    {...input,extra:"x"},{...input,challenge_id:"bad"}]){
    if(bad.device_id===other)continue; // separately prove cross-device selection below
    assert.equal(parseAccountOwnerCentralSelection(bad),null);
  }
  const calls=[];
  const chosen=await selectAccountOwnerCentralDevice(access,input,
    transport([targets,waiting,{ok:true,status:"pending",device_id:device,
      challenge_id:ticket,expires_at:expiry,attested:false,dispatch_authorized:false}],calls));
  assert.equal(chosen.status,"pending");
  assert.equal(chosen.attested,false);
  assert.equal(chosen.dispatch_authorized,false);
  assert.equal(calls.filter(x=>x.options.method==="POST").length,1);
  assert.equal(calls[2].url,
    "https://mcp.ordax.com.br/v3/owner/central-session-selections");
  assert.deepEqual(JSON.parse(calls[2].options.body),{client_id:client,
    challenge_id:ticket,device_id:device});
  const ownerSource=readFileSync(new URL("../infra/supabase/functions/_shared/account_mcp_owner.mjs",import.meta.url),"utf8");
  assert.match(ownerSource,/Only a pending Owner challenge is time-bounded/);
  assert.match(ownerSource,/binding is persistent Platform state/);
  assert.doesNotMatch(ownerSource,/sliding lease|30-minute|heartbeat.*renew/i);
});

test("Owner central selection refuses ambiguous, expired, wrong target and unverifiable POST",async()=>{
  const ticket="99999999-9999-4999-8999-999999999999";
  const expiry=new Date(Date.now()+120000).toISOString();
  const targets={ok:true,client_id:client,eligible_device_count:1,
    state:"single_granted_target",targets:[{device_id:device,reported_online:true,
      runtime_ready:true}],attested:false,dispatch_authorized:false,owner_choice_performed:false};
  const pending={ok:true,count:1,pending_selections:[{
    challenge_id:ticket,created_at:new Date(Date.now()-1000).toISOString(),
    expires_at:expiry}],attested:false,dispatch_authorized:false};
  const input={client_id:client,challenge_id:ticket,device_id:device,confirm:"selecionar"};
  for(const [a,b,attempt] of [
    [targets,{...pending,count:0,pending_selections:[]},input],
    [targets,{...pending,count:2,pending_selections:[
      ...pending.pending_selections,{...pending.pending_selections[0],
        challenge_id:"77777777-7777-4777-8777-777777777777"}]},input],
    [targets,{...pending,pending_selections:[{...pending.pending_selections[0],
      expires_at:"2020-01-01T00:00:00Z"}]},input],
    [targets,pending,{...input,device_id:other}],
    [{...targets,targets:[{...targets.targets[0],reported_online:false}]},pending,input],
  ]){
    const calls=[];
    await assert.rejects(selectAccountOwnerCentralDevice(access,attempt,
      transport([a,b],calls)));
    assert.equal(calls.some(call=>call.options.method==="POST"),false);
  }
  const calls=[];
  await assert.rejects(selectAccountOwnerCentralDevice(access,input,
    transport([targets,pending,{ok:true,status:"bound",device_id:device,
      challenge_id:ticket,expires_at:expiry,attested:true,
      dispatch_authorized:true}],calls)),/unconfirmed/);
  assert.equal(calls.filter(x=>x.options.method==="POST").length,1,
    "an ambiguous POST may never be retried");
  for(const bad of [
    {...targets,eligible_device_count:2}, {...targets,client_id:other},
    {...targets,attested:true}, {...targets,targets:[{...targets.targets[0],runtime_ready:"yes"}]}
  ])await assert.rejects(readAccountOwnerCentralTargets(access,client,transport([bad])));
  await assert.rejects(readAccountOwnerCentralSelections(access,client,
    transport([{...pending,count:2}])));
});

test("Vercel forwards only exact device UUID for authority or project onboarding",async()=>{
  const {forwardOwnerMcpAuthorityQuery}=await import("../lib/account-proxy-core.mjs");
  const params=(v)=>new URLSearchParams(v);
  for(const path of ["/account/mcp/authority",ACCOUNT_MCP_PROJECT_ONBOARDING_PATH]) {
    assert.equal(forwardOwnerMcpAuthorityQuery(path,params({device_id:device})),
      path+"?device_id="+device);
    assert.equal(forwardOwnerMcpAuthorityQuery(path+"?device_id="+device,
      params({ordax_path:path+"?device_id="+device})),path+"?device_id="+device);
    assert.equal(forwardOwnerMcpAuthorityQuery(path,params({device_id:device,owner_id:other})),null);
    assert.equal(forwardOwnerMcpAuthorityQuery(path+"?device_id="+device+"&device_id="+other,
      params({ordax_path:path})),null);
  }
});

test("Vercel forwards only exact Owner client UUID for either central GET",async()=>{
  const {forwardOwnerMcpCentralQuery}=await import("../lib/account-proxy-core.mjs");
  const base="/account/mcp/central-targets";
  const second="/account/mcp/central-selections";
  const params=(v)=>new URLSearchParams(v);
  assert.equal(forwardOwnerMcpCentralQuery(base,params({client_id:client})),
    base+"?client_id="+client);
  assert.equal(forwardOwnerMcpCentralQuery(second+"?client_id="+client,
    params({ordax_path:second+"?client_id="+client})),second+"?client_id="+client);
  for(const bad of [
    params({client_id:"evil"}),
    params({client_id:client,owner_id:other}),
    params({client_id:"A2222222-2222-4222-8222-222222222222"}),
  ]) assert.equal(forwardOwnerMcpCentralQuery(base,bad),null);
  assert.equal(forwardOwnerMcpCentralQuery("/auth/session",params({client_id:client})),null);
  assert.equal(forwardOwnerMcpCentralQuery(base+"?client_id="+client,
    params({client_id:other})),null);
});

test("Production gateway releases require an explicit manual exact-SHA approval",()=>{
  for(const [filename,confirmation,deployedFunction] of [
    ["ordax-account-gateway-destination.yml","DEPLOY_ACCOUNT_GATEWAY_PRODUCTION","ordax-account-gateway"],
    ["ordax-public-account-gateway-destination.yml","DEPLOY_PUBLIC_ACCOUNT_GATEWAY_PRODUCTION","ordax-public-account-gateway"],
  ]){
    const workflow=readFileSync(new URL("../.github/workflows/"+filename,import.meta.url),"utf8");
    assert.match(workflow,/^on:\s*$/m);
    assert.match(workflow,/^  workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow,/^  push:\s*$/m,"No merge-to-main production deploy");
    assert.match(workflow,/^      approved_sha:\s*$/m);
    assert.match(workflow,/^      release_confirmation:\s*$/m);
    assert.match(workflow,/github\.event_name == 'workflow_dispatch'/);
    assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
    assert.match(workflow,/inputs\.approved_sha == github\.sha/);
    assert.ok(workflow.includes("inputs.release_confirmation == '"+confirmation+"'"));
    assert.match(workflow,/test "\$\{ACTUAL\}" = "\$\{GITHUB_SHA\}"/);
    assert.match(workflow,/test "\$\{CURRENT\}" = "\$\{GITHUB_SHA\}"/);
    assert.ok(workflow.includes("supabase functions deploy "+deployedFunction));
  }
});
