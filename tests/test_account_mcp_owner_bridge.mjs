import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {isPublicBridgeRoute,isPublicAccountPreActivationRoute} from "../infra/supabase/functions/_shared/account_transport_admission.mjs";
import {
  ACCOUNT_MCP_DEVICES_PATH, ACCOUNT_MCP_AUTHORITY_PATH, ACCOUNT_MCP_REVOKE_PATH,
  ACCOUNT_MCP_PROJECT_GRANTS_PATH,
  OWNER_MCP_DEVICES_URL, validateAccountOwnerDevices,validateAccountOwnerAuthority,
  readAccountOwnerDevices,readAccountOwnerAuthority,revokeAccountOwnerGrant,parseAccountOwnerRevoke,
  parseAccountOwnerProjectGrant,createAccountOwnerProjectGrant,
  ACCOUNT_MCP_CENTRAL_TARGETS_PATH,ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH,
  readAccountOwnerCentralTargets,readAccountOwnerCentralSelections,
  selectAccountOwnerCentralDevice,parseAccountOwnerCentralSelection,
  ACCOUNT_MCP_PROJECT_ONBOARDING_PATH,ACCOUNT_MCP_PROJECTS_PATH,
  ACCOUNT_MCP_PROJECT_BINDING_INTENTS_PATH,
  OWNER_PROJECT_ONBOARDING_URL,OWNER_PROJECTS_URL,OWNER_PROJECT_BINDING_INTENTS_URL,
  validateAccountOwnerProjectOnboarding,readAccountOwnerProjectOnboarding,
  parseAccountOwnerProjectCreate,createAccountOwnerProject,
  parseAccountOwnerProjectBindingIntent,createAccountOwnerProjectBindingIntent,
  ACCOUNT_MCP_GITHUB_CHALLENGES_PATH,ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
  ACCOUNT_MCP_GITHUB_CANDIDATES_PATH,ACCOUNT_MCP_GITHUB_SELECTIONS_PATH,
  OWNER_GITHUB_CHALLENGES_URL,OWNER_GITHUB_COMPLETIONS_URL,
  OWNER_GITHUB_CANDIDATES_URL,OWNER_GITHUB_SELECTIONS_URL,
  parseAccountOwnerGithubAuthorizationStart,startAccountOwnerGithubAuthorization,
  parseAccountOwnerGithubCallback,completeAccountOwnerGithubAuthorization,
  readAccountOwnerGithubCandidates,parseAccountOwnerGithubSelection,
  selectAccountOwnerGithubRepository,
} from "../infra/supabase/functions/_shared/account_mcp_owner.mjs";

const device="11111111-1111-4111-8111-111111111111";
const other="44444444-4444-4444-8444-444444444444";
const client="22222222-2222-4222-8222-222222222222";
const group="33333333-3333-4333-8333-333333333333";
const space="55555555-5555-4555-8555-555555555555";
const project="66666666-6666-4666-8666-666666666666";
const challenge="77777777-7777-4777-8777-777777777777";
const connection="88888888-8888-4888-8888-888888888888";
const githubState=challenge+"."+"A".repeat(43);
const githubCode="oauth-code-123456";
const access="abcDEFghi.abcDEFghi.abcDEFghi";
const row={device_id:device,name:"OrdaX Desktop",kind:"desktop",
  channel:"development",state:"active",online:true,runtime_ready:true,last_seen_at:null};
const inventory={ok:true,schema:"ordax.owner-mcp-devices/1",count:1,devices:[row]};
const authority={ok:true,device_id:device,clients:[{client_id:client,client_name:"ChatGPT"}],
  grant_groups:[{grant_group_id:group,client_id:client,device_id:device,
    profile_key:"full-computer-control",scope_kind:"device",space_id:null,project_id:null,
    valid_until:null,client_consent_active:true}]};
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

test("MCP Owner routes remain exact and never publicly preactivated",()=>{
  for(const [method,path] of [["GET",ACCOUNT_MCP_DEVICES_PATH],
                              ["GET",ACCOUNT_MCP_AUTHORITY_PATH],
                              ["POST",ACCOUNT_MCP_REVOKE_PATH],
                              ["POST",ACCOUNT_MCP_PROJECT_GRANTS_PATH]]) {
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
  assert.equal(isPublicBridgeRoute("POST",ACCOUNT_MCP_PROJECT_BINDING_INTENTS_PATH),true);
  assert.equal(isPublicAccountPreActivationRoute("POST",ACCOUNT_MCP_PROJECT_BINDING_INTENTS_PATH),false);
  assert.equal(isPublicBridgeRoute("GET",ACCOUNT_MCP_PROJECT_BINDING_INTENTS_PATH),false);
  for(const [method,path] of [
    ["POST",ACCOUNT_MCP_GITHUB_CHALLENGES_PATH],
    ["GET",ACCOUNT_MCP_GITHUB_CALLBACK_PATH],
    ["GET",ACCOUNT_MCP_GITHUB_CANDIDATES_PATH],
    ["POST",ACCOUNT_MCP_GITHUB_SELECTIONS_PATH],
  ]){
    assert.equal(isPublicBridgeRoute(method,path),true);
    assert.equal(isPublicAccountPreActivationRoute(method,path),false);
    assert.equal(isPublicBridgeRoute(method==="GET"?"POST":"GET",path),false);
  }
});
test("Gateway Owner routes keep Supabase cookie authorization and fail-closed rollout",()=>{
  const source=readFileSync(new URL("../infra/supabase/functions/ordax-account-gateway/index.ts",import.meta.url),"utf8");
  assert.match(source,/ORDAX_MCP_OWNER_ACCOUNT_ENABLED/);
  assert.match(source,/await authenticated\(req\)/);
  assert.match(source,/verifyTrustedPublicRequestContext\(req\)\.ok/);
  assert.doesNotMatch(source,/origin\.host\.toLowerCase\(\) === forwardedHost/);
  assert.match(source,/await revokeAccountOwnerGrant\(session.access, revokeRequest\)/);
  assert.match(source,/mcp-owner-revoke-unconfirmed/);
  assert.match(source,/ORDAX_MCP_OWNER_PROJECT_GRANT_ENABLED/);
  assert.match(source,/parseAccountOwnerProjectGrant\(grantRequest\)/);
  assert.match(source,/createAccountOwnerProjectGrant\(/);
  assert.match(source,/mcp-owner-project-grant-unconfirmed/);
  assert.match(source,/ORDAX_MCP_OWNER_CENTRAL_SELECTION_ENABLED/);
  assert.match(source,/parseAccountOwnerCentralSelection\(selection\)/);
  assert.match(source,/selectAccountOwnerCentralDevice\(session.access, selection\)/);
  assert.match(source,/mcp-owner-central-selection-unconfirmed/);
  assert.match(source,/ORDAX_MCP_OWNER_PROJECT_ONBOARDING_ENABLED/);
  assert.match(source,/readAccountOwnerProjectOnboarding\(session\.access, deviceIds\[0\]\)/);
  assert.match(source,/parseAccountOwnerProjectCreate\(projectCreate\)/);
  assert.match(source,/createAccountOwnerProject\(session\.access, projectCreate\)/);
  assert.match(source,/mcp-owner-project-create-unconfirmed/);
  assert.match(source,/ORDAX_MCP_OWNER_PROJECT_DEVICE_BINDING_ENABLED/);
  assert.match(source,/parseAccountOwnerProjectBindingIntent\(bindingRequest\)/);
  assert.match(source,/createAccountOwnerProjectBindingIntent\(/);
  assert.match(source,/mcp-owner-project-binding-intent-unconfirmed/);
  assert.doesNotMatch(source,/ACCOUNT_MCP_PROJECT_BINDING_CONFIRM|local_project_ref.*bindingRequest/);
  assert.match(source,/ORDAX_MCP_OWNER_GITHUB_AUTHORIZATION_ENABLED/);
  assert.match(source,/completeAccountOwnerGithubAuthorization\(session\.access,callback\)/);
  assert.match(source,/readAccountOwnerGithubCandidates/);
  assert.match(source,/selectAccountOwnerGithubRepository/);
  assert.match(source,/githubCallbackRedirect/);
  assert.match(source,/referrer-policy", "no-referrer"/);
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
  assert.deepEqual({
    scope_kind:result.grant_groups[0].scope_kind,
    space_id:result.grant_groups[0].space_id,
    project_id:result.grant_groups[0].project_id,
  },{scope_kind:"device",space_id:null,project_id:null});
  assert.equal(validateAccountOwnerAuthority({...authority,device_id:other},device),null);
  assert.equal(validateAccountOwnerAuthority({...authority,grant_groups:[{...authority.grant_groups[0],device_id:other}]},device),null);
  assert.equal(validateAccountOwnerAuthority({...authority,grant_groups:[authority.grant_groups[0],authority.grant_groups[0]]},device),null);
  assert.equal(validateAccountOwnerAuthority({...authority,grant_groups:[{
    ...authority.grant_groups[0],scope_kind:"project",space_id:null,project_id:null,
  }]},device),null);
  assert.equal(validateAccountOwnerAuthority({...authority,grant_groups:[{
    ...authority.grant_groups[0],scope_kind:"device",space_id:space,project_id:project,
  }]},device),null);
  assert.deepEqual(await readAccountOwnerAuthority(access,device,transport([authority])),result);
});
test("Project grant parser is explicit, bounded and limited to canonical Native Project profiles",()=>{
  const now=Date.parse("2026-11-13T23:00:00.000Z");
  const input={device_id:device,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-process",valid_until:"2026-11-14T12:00:00Z",
    confirm:"authorize_project"};
  assert.deepEqual(parseAccountOwnerProjectGrant(input,now),{
    ...input,valid_until:"2026-11-14T12:00:00.000Z",
  });
  assert.deepEqual(parseAccountOwnerProjectGrant({...input,
    profile_key:"project-native-terminal",valid_until:null},now),{
      ...input,profile_key:"project-native-terminal",valid_until:null,
    });
  for(const bad of [
    {...input,profile_key:"full-computer-control"},
    {...input,profile_key:"project-browser-automation"},
    {...input,profile_key:"project-workspace-read"},
    {...input,profile_key:"project-continuity"},
    {...input,confirm:"yes"},
    {...input,valid_until:"2020-01-01T00:00:00Z"},
    {...input,valid_until:"2028-01-01T00:00:00Z"},
    {...input,valid_until:""},
    {...input,device_id:other},
    {...input,space_id:"bad"},
    {...input,project_id:"bad"},
    {...input,local_project_ref:"project-1"},
    {...input,path:"C:/repo"},
    {...input,capabilities:["terminal.exec"]},
    {...input,access_mode:"write"},
  ]) {
    if (bad.device_id===other) continue; // cross-device is structurally valid; authority checks it server-side.
    assert.equal(parseAccountOwnerProjectGrant(bad,now),null,JSON.stringify(bad));
  }
});

test("Project grant creation requires ready binding, one POST and exact scoped read-back",async()=>{
  const now=Date.parse("2026-11-13T23:00:00.000Z");
  const validUntil="2026-11-14T12:00:00.000Z";
  const input={device_id:device,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-process",valid_until:validUntil,confirm:"authorize_project"};
  const onboarding={ok:true,device_id:device,
    spaces:[{space_id:space,name:"Owner",kind:"work",state:"active"}],
    projects:[{project_id:project,space_id:space,name:"Platform",kind:"development",
      state:"active",github_connection_count:1,
      repository_full_name:"ordaxsystems/ordax-platform",
      space_device_execute:true,project_device_bound:true,next_state:"ready_without_grants"}],
    next_state:null};
  const newGroup="99999999-9999-4999-8999-999999999999";
  const after={...authority,grant_groups:[...authority.grant_groups,{
    grant_group_id:newGroup,client_id:client,device_id:device,
    profile_key:"project-native-process",scope_kind:"project",
    space_id:space,project_id:project,valid_until:"2026-11-14T12:00:00+00:00",
    client_consent_active:true,
  }]};
  const calls=[];
  const result=await createAccountOwnerProjectGrant(access,input,
    transport([onboarding,authority,{ok:true,grant_group_id:newGroup,
      capability_count:6,scope_kind:"project"},after],calls),now);
  assert.deepEqual(result,{ok:true,schema:"ordax.owner-project-grant/1",
    grant_group_id:newGroup,device_id:device,client_id:client,space_id:space,
    project_id:project,profile_key:"project-native-process",valid_until:validUntil});
  assert.deepEqual(calls.map(call=>call.options.method),["GET","GET","POST","GET"]);
  assert.equal(calls[2].url,"https://mcp.ordax.com.br/v3/owner/remote-grant-groups");
  assert.deepEqual(JSON.parse(calls[2].options.body),{
    client_id:client,device_id:device,profile_key:"project-native-process",
    project_id:project,space_id:space,valid_until:validUntil,
  });
  assert.equal("confirm" in JSON.parse(calls[2].options.body),false);
  assert.equal(calls.filter(call=>call.options.method==="POST").length,1);
});

test("Project grant creation fails closed before mutation unless binding and OAuth client are canonical",async()=>{
  const now=Date.parse("2026-11-13T23:00:00.000Z");
  const input={device_id:device,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:null,confirm:"authorize_project"};
  const ready={ok:true,device_id:device,
    spaces:[{space_id:space,name:"Owner",kind:"work",state:"active"}],
    projects:[{project_id:project,space_id:space,name:"Platform",kind:"development",
      state:"active",github_connection_count:1,
      repository_full_name:"ordaxsystems/ordax-platform",
      space_device_execute:true,project_device_bound:true,next_state:"ready_without_grants"}],
    next_state:null};

  for(const projectState of [
    {...ready.projects[0],next_state:"needs_device_binding",
      space_device_execute:false,project_device_bound:false},
    {...ready.projects[0],space_device_execute:false},
    {...ready.projects[0],project_device_bound:false},
    {...ready.projects[0],repository_full_name:null,github_connection_count:0},
  ]) {
    const calls=[];
    await assert.rejects(createAccountOwnerProjectGrant(access,input,
      transport([{...ready,projects:[projectState]}],calls),now),/scope-not-ready/);
    assert.deepEqual(calls.map(call=>call.options.method),["GET"]);
  }

  const noClient={...authority,clients:[]};
  const calls=[];
  await assert.rejects(createAccountOwnerProjectGrant(access,input,
    transport([ready,noClient],calls),now),/client-not-consented/);
  assert.deepEqual(calls.map(call=>call.options.method),["GET","GET"]);
});

test("Project grant mutation is never replayed and exact read-back must preserve unrelated grants",async()=>{
  const now=Date.parse("2026-11-13T23:00:00.000Z");
  const input={device_id:device,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:null,confirm:"authorize_project"};
  const ready={ok:true,device_id:device,
    spaces:[{space_id:space,name:"Owner",kind:"work",state:"active"}],
    projects:[{project_id:project,space_id:space,name:"Platform",kind:"development",
      state:"active",github_connection_count:1,
      repository_full_name:"ordaxsystems/ordax-platform",
      space_device_execute:true,project_device_bound:true,next_state:"ready_without_grants"}],
    next_state:null};

  let postCalls=0;
  const uncertain=async(url,options)=>{
    if(options.method==="GET") {
      const value=url.includes("project-onboarding")?ready:authority;
      return makeResponse(value,url);
    }
    postCalls++;
    throw Error("uncertain");
  };
  await assert.rejects(createAccountOwnerProjectGrant(access,input,uncertain,now));
  assert.equal(postCalls,1,"uncertain grant POST must never be replayed");

  const newGroup="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const changedUnrelated={...authority.grant_groups[0],profile_key:"computer-observe"};
  const badAfter={...authority,grant_groups:[changedUnrelated,{
    grant_group_id:newGroup,client_id:client,device_id:device,
    profile_key:"project-native-terminal",scope_kind:"project",
    space_id:space,project_id:project,valid_until:null,client_consent_active:true,
  }]};
  await assert.rejects(createAccountOwnerProjectGrant(access,input,
    transport([ready,authority,{ok:true,grant_group_id:newGroup,
      capability_count:1,scope_kind:"project"},badAfter]),now),
    /isolation-unverified/);

  for(const receipt of [
    {ok:true,grant_group_id:"bad",capability_count:1,scope_kind:"project"},
    {ok:true,grant_group_id:newGroup,capability_count:2,scope_kind:"project"},
    {ok:true,grant_group_id:newGroup,capability_count:1,scope_kind:"device"},
  ]) {
    await assert.rejects(createAccountOwnerProjectGrant(access,input,
      transport([ready,authority,receipt]),now),/grant-unconfirmed/);
  }
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

test("Project binding intent accepts only Owner project/device confirmation and never local Runtime authority",async()=>{
  const input={project_id:project,device_id:device,confirm:"bind_project_device"};
  assert.deepEqual(parseAccountOwnerProjectBindingIntent(input),input);
  for(const bad of [
    {...input,local_project_ref:"project-1"},
    {...input,allowed_capabilities:["terminal.exec"]},
    {...input,repository_id:"123456789"},
    {...input,repository_full_name:"ordaxsystems/ordax-platform"},
    {...input,installation_id:"9001"},
    {...input,grant_profile:"project-native-terminal"},
    {...input,space_id:space},
    {...input,path:"/Documentos/Projeto"},
    {...input,metadata:{}},
    {...input,confirm:"yes"},
  ]) assert.equal(parseAccountOwnerProjectBindingIntent(bad),null);

  const intent="99999999-9999-4999-8999-999999999999";
  const upstream={ok:true,schema:"ordax.owner-project-device-binding-intent/1",
    intent_id:intent,project_id:project,device_id:device,
    expires_at:"2026-11-14T00:10:00Z",
    next_state:"awaiting_device_confirmation",
    local_project_ref:"drop",allowed_capabilities:["drop"],grant_id:"drop"};
  const calls=[];
  const result=await createAccountOwnerProjectBindingIntent(access,input,async(url,options)=>{
    calls.push({url,options});
    return makeResponse(upstream,url,201);
  });
  assert.deepEqual(result,{ok:true,schema:"ordax.owner-project-device-binding-intent/1",
    intent_id:intent,project_id:project,device_id:device,
    expires_at:"2026-11-14T00:10:00Z",
    next_state:"awaiting_device_confirmation"});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,OWNER_PROJECT_BINDING_INTENTS_URL);
  assert.equal(calls[0].options.method,"POST");
  assert.deepEqual(JSON.parse(calls[0].options.body),input);
  assert.equal(calls[0].options.headers.Authorization,"Bearer "+access);
  assert.equal("local_project_ref" in result,false);
  assert.equal("allowed_capabilities" in result,false);
  assert.equal("grant_id" in result,false);

  let uncertainCalls=0;
  await assert.rejects(createAccountOwnerProjectBindingIntent(access,input,async()=>{
    uncertainCalls+=1;
    throw Error("uncertain");
  }));
  assert.equal(uncertainCalls,1,"an uncertain binding-intent POST must never be replayed");

  for(const invalid of [
    {...upstream,intent_id:"bad"},
    {...upstream,project_id:other},
    {...upstream,device_id:other},
    {...upstream,expires_at:"bad"},
    {...upstream,next_state:"ready_without_grants"},
    {...upstream,schema:"other"},
  ]) {
    await assert.rejects(createAccountOwnerProjectBindingIntent(access,input,
      async(url)=>makeResponse(invalid,url,201)),/unconfirmed/);
  }
});

test("GitHub start accepts only Project confirmation and projects a fixed provider destination",async()=>{
  const input={project_id:project,confirm:"connect_github"};
  assert.deepEqual(parseAccountOwnerGithubAuthorizationStart(input),input);
  for(const bad of [
    {...input,installation_id:"1"},
    {...input,repository_id:"2"},
    {...input,repository_full_name:"ordaxsystems/ordax-platform"},
    {...input,device_id:device},
    {...input,grant_profile:"terminal"},
    {...input,confirm:"yes"},
  ]) assert.equal(parseAccountOwnerGithubAuthorizationStart(bad),null);

  const authorization=new URL("https://github.com/login/oauth/authorize");
  authorization.searchParams.set("client_id","Iv1.1234567890abcdef");
  authorization.searchParams.set("redirect_uri","https://ordax.com.br/account/mcp/github/callback");
  authorization.searchParams.set("state",githubState);
  authorization.searchParams.set("code_challenge","B".repeat(43));
  authorization.searchParams.set("code_challenge_method","S256");
  authorization.searchParams.set("allow_signup","false");
  authorization.searchParams.set("prompt","select_account");
  const upstream={ok:true,challenge_id:challenge,project_id:project,
    authorization_url:authorization.toString(),
    install_url:"https://github.com/apps/ordax/installations/new",
    expires_at:"2026-11-14T00:00:00Z",installation_id:"drop"};
  const calls=[];
  const result=await startAccountOwnerGithubAuthorization(access,input,async(url,options)=>{
    calls.push({url,options});
    return makeResponse(upstream,url,201);
  });
  assert.equal(result.schema,"ordax.owner-github-authorization-challenge/1");
  assert.equal(result.challenge_id,challenge);
  assert.equal("installation_id" in result,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,OWNER_GITHUB_CHALLENGES_URL);
  assert.equal(calls[0].options.method,"POST");
  assert.deepEqual(JSON.parse(calls[0].options.body),input);
  assert.equal(calls[0].options.headers.Authorization,"Bearer "+access);

  for(const mutate of [
    u=>{u.hostname="evil.invalid";},
    u=>{u.searchParams.set("redirect_uri","https://evil.invalid/callback");},
    u=>{u.searchParams.set("state",other+"."+"A".repeat(43));},
    u=>{u.searchParams.set("installation_id","1");},
  ]){
    const bad=new URL(authorization);
    mutate(bad);
    await assert.rejects(startAccountOwnerGithubAuthorization(access,input,
      async(url)=>makeResponse({...upstream,authorization_url:bad.toString()},url,201)),
      /start-unconfirmed/);
  }
});

test("GitHub callback is exact, one-shot, and never returns provider identity",async()=>{
  const input={code:githubCode,state:githubState};
  assert.deepEqual(parseAccountOwnerGithubCallback(input),input);
  for(const bad of [
    {...input,installation_id:"123"},
    {...input,repository_id:"456"},
    {...input,state:"bad"},
    {...input,code:"x"},
  ]) assert.equal(parseAccountOwnerGithubCallback(bad),null);

  const upstream={ok:true,challenge_id:challenge,project_id:project,candidate_count:2,
    next_state:"needs_repository_selection",
    install_url:"https://github.com/apps/ordax/installations/new",
    expires_at:"2026-11-14T00:00:00Z",github_user_id:"drop",access_token:"drop"};
  const calls=[];
  const result=await completeAccountOwnerGithubAuthorization(access,input,async(url,options)=>{
    calls.push({url,options});
    return makeResponse(upstream,url);
  });
  assert.deepEqual(result,{ok:true,schema:"ordax.owner-github-authorization-completed/1",
    challenge_id:challenge,project_id:project,candidate_count:2,
    next_state:"needs_repository_selection",
    install_url:"https://github.com/apps/ordax/installations/new",
    expires_at:"2026-11-14T00:00:00Z"});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,OWNER_GITHUB_COMPLETIONS_URL);
  assert.deepEqual(JSON.parse(calls[0].options.body),input);
  assert.equal(JSON.stringify(result).includes("access_token"),false);
  await assert.rejects(completeAccountOwnerGithubAuthorization(access,input,async()=>{
    throw Error("uncertain");
  }));
});

test("GitHub candidates expose only repository choice and selection POST is preflighted once",async()=>{
  const candidates={ok:true,challenge_id:challenge,project_id:project,
    repositories:[{repository_id:"123456789",repository_full_name:"ordaxsystems/ordax-platform",
      default_branch:"main",installation_account_login:"ordaxsystems",
      installation_id:"9001",github_user_id:"drop"}],
    expires_at:"2026-11-14T00:00:00Z"};
  const readCalls=[];
  const projected=await readAccountOwnerGithubCandidates(access,challenge,
    transport([candidates],readCalls));
  assert.equal(projected.schema,"ordax.owner-github-repository-candidates/1");
  assert.deepEqual(projected.repositories,[{repository_id:"123456789",
    repository_full_name:"ordaxsystems/ordax-platform",default_branch:"main",
    installation_account_login:"ordaxsystems"}]);
  assert.equal("installation_id" in projected.repositories[0],false);
  assert.equal(readCalls[0].url,OWNER_GITHUB_CANDIDATES_URL+"?challenge_id="+challenge);

  const selection={challenge_id:challenge,repository_id:"123456789",
    confirm:"select_repository"};
  assert.deepEqual(parseAccountOwnerGithubSelection(selection),selection);
  for(const bad of [
    {...selection,installation_id:"9001"},
    {...selection,repository_full_name:"ordaxsystems/ordax-platform"},
    {...selection,device_id:device},
    {...selection,grant_profile:"terminal"},
    {...selection,confirm:"yes"},
  ]) assert.equal(parseAccountOwnerGithubSelection(bad),null);

  const selected={ok:true,challenge_id:challenge,connection_id:connection,
    project_id:project,repository_id:"123456789",
    repository_full_name:"ordaxsystems/ordax-platform",default_branch:"main",
    state:"active",next_state:"needs_device_binding",installation_id:"drop"};
  const calls=[];
  const result=await selectAccountOwnerGithubRepository(access,selection,
    transport([candidates,selected],calls));
  assert.equal(result.schema,"ordax.owner-github-repository-selected/1");
  assert.equal(result.next_state,"needs_device_binding");
  assert.equal("installation_id" in result,false);
  assert.deepEqual(calls.map(call=>call.options.method),["GET","POST"]);
  assert.equal(calls[1].url,OWNER_GITHUB_SELECTIONS_URL);
  assert.deepEqual(JSON.parse(calls[1].options.body),selection);

  const guessedCalls=[];
  await assert.rejects(selectAccountOwnerGithubRepository(access,
    {...selection,repository_id:"987654321"},
    transport([candidates],guessedCalls)),/repository-not-verified/);
  assert.equal(guessedCalls.some(call=>call.options.method==="POST"),false);
});

test("Vercel forwards only exact GitHub OAuth callback and candidate query",async()=>{
  const {forwardOwnerMcpGithubCallbackQuery,forwardOwnerMcpGithubCandidateQuery}=
    await import("../lib/account-proxy-core.mjs");
  const callback=forwardOwnerMcpGithubCallbackQuery(ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
    new URLSearchParams({ordax_path:ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
      code:githubCode,state:githubState}));
  assert.equal(callback,ACCOUNT_MCP_GITHUB_CALLBACK_PATH+"?code="+
    encodeURIComponent(githubCode)+"&state="+encodeURIComponent(githubState));
  assert.equal(forwardOwnerMcpGithubCallbackQuery(ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
    new URLSearchParams({ordax_path:ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
      code:githubCode,state:githubState,installation_id:"1"})),null);
  assert.equal(forwardOwnerMcpGithubCallbackQuery(
    ACCOUNT_MCP_GITHUB_CALLBACK_PATH+"?code="+githubCode+"&state="+githubState,
    new URLSearchParams({ordax_path:ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
      code:"different-code",state:githubState})),null);

  assert.equal(forwardOwnerMcpGithubCandidateQuery(ACCOUNT_MCP_GITHUB_CANDIDATES_PATH,
    new URLSearchParams({ordax_path:ACCOUNT_MCP_GITHUB_CANDIDATES_PATH,
      challenge_id:challenge})),
    ACCOUNT_MCP_GITHUB_CANDIDATES_PATH+"?challenge_id="+challenge);
  assert.equal(forwardOwnerMcpGithubCandidateQuery(ACCOUNT_MCP_GITHUB_CANDIDATES_PATH,
    new URLSearchParams({ordax_path:ACCOUNT_MCP_GITHUB_CANDIDATES_PATH,
      challenge_id:challenge,repository_id:"1"})),null);
});

test("GitHub top-level GET can return with SameSite Lax while state-changing cross-site stays denied",async()=>{
  const {verifyBrowserOriginContext}=await import(
    "../infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs");
  const callback=new Request("https://ordax.com.br"+ACCOUNT_MCP_GITHUB_CALLBACK_PATH,
    {method:"GET",headers:{"sec-fetch-site":"cross-site"}});
  assert.equal(verifyBrowserOriginContext(callback,"https://ordax.com.br").ok,true);
  const mutation=new Request("https://ordax.com.br"+ACCOUNT_MCP_GITHUB_SELECTIONS_PATH,
    {method:"POST",headers:{"sec-fetch-site":"cross-site"}});
  assert.equal(verifyBrowserOriginContext(mutation,"https://ordax.com.br").ok,false);
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
