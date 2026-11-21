import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Exercise the real inline Account port body in isolation. Do not introduce
// a second copy of the validator just for tests.
const source = readFileSync(new URL("../public/assets/site.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("    async readMcpDevices(signal) {");
const end = source.indexOf("\n    },\n    subscribe(observer)", start);
assert.ok(start > 0 && end > start, "Account MCP device port missing");
const body = source.slice(start + "    async readMcpDevices(signal) {".length, end);

function harness(session, transport) {
  return new Function("loadJson", "initial", `let sessionView = initial;
    return { read: async function(signal) {${body}
    }, change(next) { sessionView = next; } };`)(transport, session);
}
// Execute the original path gate from site.js. Tests of the Account port
// alone would mock loadJson and miss a GET rejected before network dispatch.
const gateStart = source.indexOf('  function sameOriginPath(value, method = "GET") {');
const gateEnd = source.indexOf("\n  // Eligibility is shared", gateStart);
assert.ok(gateStart >= 0 && gateEnd > gateStart, "canonical same-origin gate missing");
const sameOriginPath = new Function(source.slice(gateStart,gateEnd) +
  "\nreturn sameOriginPath;")();

test("real same-origin gate permits only a single exact MCP authority UUID query",()=>{
  const deviceId="14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5";
  const valid="/account/mcp/authority?device_id="+deviceId;
  const projectRead="/account/mcp/project-onboarding?device_id="+deviceId;
  assert.equal(sameOriginPath(valid),true);
  assert.equal(sameOriginPath(projectRead),true);
  assert.equal(sameOriginPath("/account/mcp/project-onboarding"),false);
  assert.equal(sameOriginPath("/account/mcp/project-onboarding/projects"),false);
  assert.equal(sameOriginPath("/account/mcp/project-onboarding/projects","POST"),true);
  assert.equal(sameOriginPath("/account/mcp/project-onboarding/projects","GET"),false);
  assert.equal(sameOriginPath("/account/mcp/project-onboarding/device-binding-intents","POST"),true);
  assert.equal(sameOriginPath("/account/mcp/project-onboarding/device-binding-intents","GET"),false);
  assert.equal(sameOriginPath("/account/mcp/project-grants","POST"),true);
  assert.equal(sameOriginPath("/account/mcp/project-grants","GET"),false);
  assert.equal(sameOriginPath("/account/mcp/github/authorization-challenges","POST"),true);
  assert.equal(sameOriginPath("/account/mcp/github/authorization-challenges","GET"),false);
  assert.equal(sameOriginPath("/account/mcp/github/repository-selections","POST"),true);
  assert.equal(sameOriginPath("/account/mcp/github/repository-selections","GET"),false);
  const githubCandidates="/account/mcp/github/repository-candidates?challenge_id="+deviceId;
  assert.equal(sameOriginPath(githubCandidates),true);
  assert.equal(sameOriginPath("/account/mcp/github/repository-candidates"),false);
  assert.equal(sameOriginPath(githubCandidates+"&repository_id=1"),false);
  assert.equal(sameOriginPath("/account/mcp/github/callback?code=x&state=y"),false);
  assert.equal(sameOriginPath("/account/mcp/devices"),true);
  assert.equal(sameOriginPath("/account/mcp/revoke"),true);
  for(const bad of [
    "/account/mcp/authority", "/account/mcp/authority?device_id=bad",
    valid+"&device_id="+deviceId, valid+"&owner_id="+deviceId,
    "/account/mcp/authority?owner_id="+deviceId,
    "/account/mcp/authority?device_id="+deviceId.toUpperCase(),
    "/account/mcp/authority?device_id=%31"+deviceId.slice(1),
    projectRead+"&device_id="+deviceId,
    projectRead+"&repository_id=123",
    "/account/mcp/project-onboarding?device_id=bad",
    valid+"#fragment", "/auth/session?device_id="+deviceId,
    "/account/usage/mcp?device_id="+deviceId,
    "/account/mcp/authority?device_id="+deviceId+"/../../auth/session",
    "//evil.example/account/mcp/authority?device_id="+deviceId,
    "https://evil.example/account/mcp/authority?device_id="+deviceId,
  ]) assert.equal(sameOriginPath(bad),false,bad);
});

test("Account JSON transport keeps the exact state-changing Owner routes explicit",()=>{
  assert.match(source,/if \(!sameOriginPath\(path, method\)\) throw new Error\("api-path-invalid"\)/);
  for (const route of [
    "/account/mcp/revoke",
    "/account/mcp/project-grants",
    "/account/mcp/central-selections",
    "/account/mcp/project-onboarding/projects",
    "/account/mcp/project-onboarding/device-binding-intents",
    "/account/mcp/github/authorization-challenges",
    "/account/mcp/github/repository-selections",
  ]) assert.equal(source.includes('"' + route + '"'),true,route);
});

const first = {
  device_id:"14cef8f4-3c06-4b1b-9e3a-42c74ef7dec5",
  name:"Windows OrdaX",kind:"desktop",channel:"development",
  state:"active",online:true,runtime_ready:true,last_seen_at:"2026-11-03T20:00:00Z",
};
const good = {ok:true,schema:"ordax.owner-mcp-devices/1",count:1,devices:[first]};

test("signed-in Account reads bounded same-origin device route without product tokens", async () => {
  let calls = [];
  const h = harness({status:"authenticated"},async (...args) => {calls.push(args);return good;});
  assert.deepEqual(await h.read(),good);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/devices");
  assert.deepEqual(calls[0][2],{maxBytes:65536});
});

test("anonymous Account cannot fetch device inventory",async () => {
  const h=harness({status:"anonymous"},async () => {throw Error("should not fetch");});
  await assert.rejects(h.read(),/public-account-session-required/);
});

test("malformed inventory, other schemas and duplicate device ids fail closed",async () => {
  for(const invalid of [
    {...good,schema:"unknown"},
    {...good,count:2},
    {...good,devices:[first,first],count:2},
    {...good,devices:[{...first,online:"true"}]},
    {...good,devices:[{...first,device_id:"wrong-id"}]},
    {...good,devices:[{...first,last_seen_at:"invalid-date"}]},
  ]) {
    const h=harness({status:"authenticated"},async()=>invalid);
    await assert.rejects(h.read(),/public-account-mcp-devices-invalid/);
  }
});

test("data from a superseded account session cannot be displayed",async () => {
  let finish;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const h=harness({status:"authenticated"},()=>waiting);
  const read=h.read();
  h.change({status:"authenticated"});
  finish(good);
  await assert.rejects(read,/public-account-session-changed/);
});

test("an authenticated, verified empty list is distinct from an unavailable server",async () => {
  const empty={ok:true,schema:"ordax.owner-mcp-devices/1",count:0,devices:[]};
  assert.deepEqual(await harness({status:"authenticated"},async()=>empty).read(),empty);
  await assert.rejects(harness({status:"authenticated"},async()=>{throw Error("503");}).read(),/503/);
});

const authorityStart = source.indexOf("    async readMcpAuthority(deviceId, signal) {");
const authorityEnd = source.indexOf("\n    },\n    async createMcpProjectGrant(input, signal) {", authorityStart);
const grantStart = source.indexOf("    async createMcpProjectGrant(input, signal) {");
const grantEnd = source.indexOf("\n    },\n    async reauthorizeMcpGrant(input, signal) {", grantStart);
const reauthorizeStart = source.indexOf("    async reauthorizeMcpGrant(input, signal) {");
const reauthorizeEnd = source.indexOf("\n    },\n    async revokeMcpGrant(input, signal) {", reauthorizeStart);
const revokeStart = source.indexOf("    async revokeMcpGrant(input, signal) {");
const revokeEnd = source.indexOf("\n    },\n    async readMcpCentralTargets(clientId, signal) {", revokeStart);
assert.ok(authorityStart > 0 && authorityEnd > authorityStart, "Owner authority read port missing");
assert.ok(grantStart > 0 && grantEnd > grantStart, "Owner Project grant port missing");
assert.ok(reauthorizeStart > 0 && reauthorizeEnd > reauthorizeStart, "Owner reauthorization port missing");
assert.ok(revokeStart > 0 && revokeEnd > revokeStart, "Owner revoke port missing");

function ownerHarness(session, loadJson) {
  const authorityBody = source.slice(authorityStart + "    async readMcpAuthority(deviceId, signal) {".length, authorityEnd);
  const grantBody = source.slice(grantStart + "    async createMcpProjectGrant(input, signal) {".length, grantEnd);
  const reauthorizeBody = source.slice(reauthorizeStart + "    async reauthorizeMcpGrant(input, signal) {".length, reauthorizeEnd);
  const revokeBody = source.slice(revokeStart + "    async revokeMcpGrant(input, signal) {".length, revokeEnd);
  return new Function("loadJson", "initial", `let sessionView=initial;
    return {
      authority: async function(deviceId,signal) {${authorityBody}
      },
      grant: async function(input,signal) {${grantBody}
      },
      reauthorize: async function(input,signal) {${reauthorizeBody}
      },
      revoke: async function(input,signal) {${revokeBody}
      },
      change(next) {sessionView=next}
    };`)(loadJson,session);
}
const other = "44444444-4444-4444-8444-444444444444";
const client = "22222222-2222-4222-8222-222222222222";
const group = "33333333-3333-4333-8333-333333333333";
const space = "55555555-5555-4555-8555-555555555555";
const project = "66666666-6666-4666-8666-666666666666";
const groupItem = {grant_group_id:group,client_id:client,profile_key:"full-computer-control",
  scope_kind:"device",space_id:null,project_id:null,valid_until:null,client_consent_active:true};
const authority = {ok:true,schema:"ordax.owner-mcp-authority-view/1",device_id:first.device_id,
  clients:[{client_id:client,client_name:"ChatGPT"}],grant_groups:[groupItem]};

const centralTargetsStart=source.indexOf("    async readMcpCentralTargets(clientId, signal) {");
const centralTargetsEnd=source.indexOf("\n    },\n    async readMcpCentralSelections(clientId, signal) {",
  centralTargetsStart);
const centralTicketsStart=source.indexOf("    async readMcpCentralSelections(clientId, signal) {");
const centralTicketsEnd=source.indexOf("\n    },\n    async selectMcpCentralDevice(input, signal) {",
  centralTicketsStart);
const centralSelectStart=source.indexOf("    async selectMcpCentralDevice(input, signal) {");
const centralSelectEnd=source.indexOf("\n    },\n    // Reuse Account's authenticated",
  centralSelectStart);
assert.ok(centralTargetsStart>0&&centralTargetsEnd>centralTargetsStart);
assert.ok(centralTicketsStart>0&&centralTicketsEnd>centralTicketsStart);
assert.ok(centralSelectStart>0&&centralSelectEnd>centralSelectStart);
const centralBody=(start,end,head)=>source.slice(start+head.length,end);
function centralHarness(session,fetcher){
  return new Function("loadJson","initial",`let sessionView=initial;
    return {
      targets: async function(clientId,signal) {${centralBody(
        centralTargetsStart,centralTargetsEnd,"    async readMcpCentralTargets(clientId, signal) {")}
      },
      tickets: async function(clientId,signal) {${centralBody(
        centralTicketsStart,centralTicketsEnd,"    async readMcpCentralSelections(clientId, signal) {")}
      },
      select: async function(input,signal) {${centralBody(
        centralSelectStart,centralSelectEnd,"    async selectMcpCentralDevice(input, signal) {")}
      },
      change(next){sessionView=next}
    };`)(fetcher,session);
}
const projectReadStart=source.indexOf("    async readMcpProjectOnboarding(deviceId, signal) {");
const projectReadEnd=source.indexOf("\n    },\n    async createMcpProject(input, signal) {",projectReadStart);
const projectCreateStart=source.indexOf("    async createMcpProject(input, signal) {");
const projectCreateEnd=source.indexOf("\n    },\n    async requestMcpProjectDeviceBinding(input, signal) {",projectCreateStart);
const projectBindStart=source.indexOf("    async requestMcpProjectDeviceBinding(input, signal) {");
const projectBindEnd=source.indexOf("\n    },\n    async startMcpGithubAuthorization(projectId, signal) {",projectBindStart);
assert.ok(projectReadStart>0&&projectReadEnd>projectReadStart,"Owner project read port missing");
assert.ok(projectCreateStart>0&&projectCreateEnd>projectCreateStart,"Owner project create port missing");
assert.ok(projectBindStart>0&&projectBindEnd>projectBindStart,"Owner project binding port missing");
function projectHarness(session,fetcher){
  const readBody=source.slice(projectReadStart+"    async readMcpProjectOnboarding(deviceId, signal) {".length,projectReadEnd);
  const createBody=source.slice(projectCreateStart+"    async createMcpProject(input, signal) {".length,projectCreateEnd);
  const bindBody=source.slice(projectBindStart+"    async requestMcpProjectDeviceBinding(input, signal) {".length,projectBindEnd);
  return new Function("loadJson","initial",`let sessionView=initial;
    return {
      read: async function(deviceId,signal) {${readBody}
      },
      create: async function(input,signal) {${createBody}
      },
      bind: async function(input,signal) {${bindBody}
      },
      change(next){sessionView=next}
    };`)(fetcher,session);
}
const projectState={ok:true,schema:"ordax.owner-project-onboarding-view/1",
  device_id:first.device_id,
  spaces:[{space_id:space,name:"Owner",kind:"work",state:"active"}],
  projects:[],next_state:"needs_project",
  onboarding_availability:{github_authorization_configured:false,
    project_device_binding_enabled:false}};
const projectStateWithProject={...projectState,next_state:null,projects:[{
  project_id:project,space_id:space,name:"OrdaX Platform",kind:"development",
  state:"active",github_connection_count:0,repository_full_name:null,
  space_device_execute:false,project_device_bound:false,
  next_state:"needs_github_installation",
}]};

test("Account project onboarding is scoped to one device and never invents GitHub readiness",async()=>{
  const calls=[];
  const h=projectHarness({status:"authenticated"},async(...args)=>{calls.push(args);return projectState});
  assert.deepEqual(await h.read(first.device_id),projectState);
  assert.equal(calls[0][0],"/account/mcp/project-onboarding?device_id="+first.device_id);
  assert.deepEqual(calls[0][2],{maxBytes:128*1024});
  for(const invalid of [
    {...projectState,schema:"other"},
    {...projectState,device_id:other},
    {...projectState,next_state:null},
    {...projectState,onboarding_availability:undefined},
    {...projectState,onboarding_availability:{github_authorization_configured:true,
      project_device_binding_enabled:"enabled"}},
    {...projectState,onboarding_availability:{github_authorization_configured:null,
      project_device_binding_enabled:false}},
    {...projectStateWithProject,projects:[{...projectStateWithProject.projects[0],
      github_connection_count:1,repository_full_name:null}]},
    {...projectStateWithProject,projects:[{...projectStateWithProject.projects[0],
      next_state:"ready"}]},
  ]) await assert.rejects(projectHarness({status:"authenticated"},async()=>invalid).read(first.device_id));
  await assert.rejects(projectHarness({status:"anonymous"},async()=>projectState).read(first.device_id),
    /session-required/);
});

test("Account project creation accepts only exact project fields and one same-origin POST",async()=>{
  const input={space_id:space,name:" OrdaX Platform ",kind:"development",confirm:"create_project"};
  const created={ok:true,schema:"ordax.owner-project-created/1",project_id:project,
    space_id:space,state:"active",next_state:"needs_github_installation"};
  const calls=[];
  const h=projectHarness({status:"authenticated"},async(...args)=>{calls.push(args);return created});
  assert.deepEqual(await h.create(input),created);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/project-onboarding/projects");
  assert.equal(calls[0][2].method,"POST");
  assert.deepEqual(calls[0][2].jsonBody,
    {space_id:space,name:"OrdaX Platform",kind:"development",confirm:"create_project"});
  for(const extra of [
    {repository_id:123},{installation_id:456},
    {repository_full_name:"ordaxsystems/ordax-platform"},
    {grant_profile:"project-native-terminal"},{device_id:first.device_id},{metadata:{}},
  ]) {
    const before=calls.length;
    await assert.rejects(h.create({...input,...extra}),/project-create-invalid/);
    assert.equal(calls.length,before,"invalid provider/grant fields must fail before transport");
  }
  await assert.rejects(projectHarness({status:"authenticated"},async()=>({...created,
    next_state:"ready_without_grants"})).create(input),/project-create-unconfirmed/);
});

test("Account project binding port sends only Owner project/device identity and sanitizes Runtime authority",async()=>{
  const input={project_id:project,device_id:first.device_id,confirm:"bind_project_device"};
  const intent="99999999-9999-4999-8999-999999999999";
  const upstream={ok:true,schema:"ordax.owner-project-device-binding-intent/1",
    intent_id:intent,project_id:project,device_id:first.device_id,
    expires_at:"2026-11-14T00:10:00Z",next_state:"awaiting_device_confirmation",
    local_project_ref:"project-1",allowed_capabilities:["terminal.exec"],grant_id:other};
  const calls=[];
  const h=projectHarness({status:"authenticated"},async(...args)=>{calls.push(args);return upstream});
  const value=await h.bind(input);
  assert.deepEqual(value,{ok:true,schema:"ordax.owner-project-device-binding-intent/1",
    intent_id:intent,project_id:project,device_id:first.device_id,
    expires_at:"2026-11-14T00:10:00Z",next_state:"awaiting_device_confirmation"});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/project-onboarding/device-binding-intents");
  assert.equal(calls[0][2].method,"POST");
  assert.deepEqual(calls[0][2].jsonBody,input);
  assert.equal("local_project_ref" in value,false);
  assert.equal("allowed_capabilities" in value,false);
  assert.equal("grant_id" in value,false);

  for(const extra of [
    {local_project_ref:"project-1"},{path:"C:/repo"},{allowed_capabilities:["terminal.exec"]},
    {repository_id:"123"},{repository_full_name:"ordaxsystems/ordax-platform"},
    {installation_id:"456"},{space_id:space},{grant_profile:"project-native-terminal"},
    {metadata:{}},
  ]) {
    const before=calls.length;
    await assert.rejects(h.bind({...input,...extra}),/binding-intent-invalid/);
    assert.equal(calls.length,before,"browser-only authority must fail before transport");
  }
  await assert.rejects(h.bind({...input,confirm:"yes"}),/binding-intent-invalid/);

  for(const invalid of [
    {...upstream,schema:"other"},
    {...upstream,intent_id:"bad"},
    {...upstream,project_id:other},
    {...upstream,device_id:other},
    {...upstream,expires_at:"bad"},
    {...upstream,next_state:"ready_without_grants"},
  ]) {
    await assert.rejects(projectHarness({status:"authenticated"},async()=>invalid).bind(input),
      /binding-intent-unconfirmed/);
  }
  await assert.rejects(projectHarness({status:"anonymous"},async()=>upstream).bind(input),
    /session-required/);
});

const githubStartStart=source.indexOf("    async startMcpGithubAuthorization(projectId, signal) {");
const githubStartEnd=source.indexOf("\n    },\n    async readMcpGithubCandidates(challengeId, signal) {",githubStartStart);
const githubReadStart=source.indexOf("    async readMcpGithubCandidates(challengeId, signal) {");
const githubReadEnd=source.indexOf("\n    },\n    async selectMcpGithubRepository(input, signal) {",githubReadStart);
const githubSelectStart=source.indexOf("    async selectMcpGithubRepository(input, signal) {");
const githubSelectEnd=source.indexOf("\n    },\n    // Reuse Account's authenticated",githubSelectStart);
assert.ok(githubStartStart>0&&githubStartEnd>githubStartStart,"GitHub authorization port missing");
assert.ok(githubReadStart>0&&githubReadEnd>githubReadStart,"GitHub candidates port missing");
assert.ok(githubSelectStart>0&&githubSelectEnd>githubSelectStart,"GitHub selection port missing");
function githubHarness(session,fetcher){
  const body=(start,end,head)=>source.slice(start+head.length,end);
  return new Function("loadJson","initial",`let sessionView=initial;
    return {
      start: async function(projectId,signal) {${body(githubStartStart,githubStartEnd,
        "    async startMcpGithubAuthorization(projectId, signal) {")}
      },
      read: async function(challengeId,signal) {${body(githubReadStart,githubReadEnd,
        "    async readMcpGithubCandidates(challengeId, signal) {")}
      },
      select: async function(input,signal) {${body(githubSelectStart,githubSelectEnd,
        "    async selectMcpGithubRepository(input, signal) {")}
      },
      change(next){sessionView=next}
    };`)(fetcher,session);
}

const githubChallenge="77777777-7777-4777-8777-777777777777";
const githubRepoId="123456789";
const githubAuth=(()=>{
  const url=new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id","Iv1.1234567890abcdef");
  url.searchParams.set("redirect_uri","https://ordax.com.br/account/mcp/github/callback");
  url.searchParams.set("state",githubChallenge+"."+"A".repeat(43));
  url.searchParams.set("code_challenge","B".repeat(43));
  url.searchParams.set("code_challenge_method","S256");
  url.searchParams.set("allow_signup","false");
  url.searchParams.set("prompt","select_account");
  return url.toString();
})();
const githubStart={ok:true,schema:"ordax.owner-github-authorization-challenge/1",
  challenge_id:githubChallenge,project_id:project,authorization_url:githubAuth,
  install_url:"https://github.com/apps/ordax/installations/new",
  expires_at:"2026-11-14T00:00:00Z"};
const githubCandidates={ok:true,schema:"ordax.owner-github-repository-candidates/1",
  challenge_id:githubChallenge,project_id:project,repositories:[{
    repository_id:githubRepoId,repository_full_name:"ordaxsystems/ordax-platform",
    default_branch:"main",installation_account_login:"ordaxsystems",
  }],expires_at:"2026-11-14T00:00:00Z"};
const githubSelected={ok:true,schema:"ordax.owner-github-repository-selected/1",
  challenge_id:githubChallenge,connection_id:"88888888-8888-4888-8888-888888888888",
  project_id:project,repository_id:githubRepoId,
  repository_full_name:"ordaxsystems/ordax-platform",default_branch:"main",
  state:"active",next_state:"needs_device_binding"};

test("Account GitHub port navigates only to validated GitHub OAuth and never accepts provider IDs",async()=>{
  const calls=[];
  const h=githubHarness({status:"authenticated"},async(...args)=>{calls.push(args);return githubStart});
  const value=await h.start(project);
  assert.equal(value.authorization_url,githubAuth);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/github/authorization-challenges");
  assert.equal(calls[0][2].method,"POST");
  assert.deepEqual(calls[0][2].jsonBody,{project_id:project,confirm:"connect_github"});
  await assert.rejects(githubHarness({status:"authenticated"},async()=>({
    ...githubStart,authorization_url:githubAuth+"&installation_id=1",
  })).start(project),/start-unconfirmed/);
  await assert.rejects(githubHarness({status:"authenticated"},async()=>({
    ...githubStart,authorization_url:githubAuth.replace("github.com","evil.invalid"),
  })).start(project),/start-unconfirmed/);
});

test("Account GitHub candidate and selection ports expose only verified repository choice",async()=>{
  const calls=[];
  const h=githubHarness({status:"authenticated"},async(...args)=>{
    calls.push(args);
    return args[0].includes("repository-candidates")?githubCandidates:githubSelected;
  });
  assert.deepEqual(await h.read(githubChallenge),githubCandidates);
  assert.equal(calls[0][0],"/account/mcp/github/repository-candidates?challenge_id="+githubChallenge);
  const input={challenge_id:githubChallenge,repository_id:githubRepoId,confirm:"select_repository"};
  assert.deepEqual(await h.select(input),githubSelected);
  assert.equal(calls[1][0],"/account/mcp/github/repository-selections");
  assert.equal(calls[1][2].method,"POST");
  assert.deepEqual(calls[1][2].jsonBody,input);
  for(const extra of [
    {installation_id:"1"},{repository_full_name:"ordaxsystems/ordax-platform"},
    {device_id:first.device_id},{grant_profile:"project-native-terminal"},{metadata:{}},
  ]) {
    const before=calls.length;
    await assert.rejects(h.select({...input,...extra}),/selection-invalid/);
    assert.equal(calls.length,before);
  }
  await assert.rejects(githubHarness({status:"authenticated"},async()=>({
    ...githubCandidates,repositories:[...githubCandidates.repositories,
      githubCandidates.repositories[0]],
  })).read(githubChallenge),/candidates-invalid/);
});


const challenge="99999999-9999-4999-8999-999999999999";
const expiry=new Date(Date.now()+100000).toISOString();
const centralTargets={ok:true,schema:"ordax.owner-central-targets/1",client_id:client,
  eligible_device_count:1,targets:[{device_id:first.device_id,
    reported_online:true,runtime_ready:true}],attested:false,dispatch_authorized:false};
const centralTickets={ok:true,schema:"ordax.owner-central-selections/1",client_id:client,
  count:1,pending_selections:[{challenge_id:challenge,
    created_at:new Date(Date.now()-1000).toISOString(),expires_at:expiry}],
  attested:false,dispatch_authorized:false};
const centralChoice={client_id:client,challenge_id:challenge,
  device_id:first.device_id,confirm:"selecionar"};

test("Account central MCP routes admit only exact client UUID and one POST",async()=>{
  for(const route of ["targets","selections"]){
    const path="/account/mcp/central-"+route+"?client_id="+client;
    assert.equal(sameOriginPath(path),true);
    for(const invalid of ["/account/mcp/central-"+route,
      path+"&client_id="+client,path+"&owner_id="+other,path+"#fragment",
      path.replace(client,"invalid"),path.replace(client,"%32"+client.slice(1))])
      assert.equal(sameOriginPath(invalid),false,invalid);
  }
  assert.equal(sameOriginPath("/account/mcp/central-selections"),false);
  assert.equal(sameOriginPath("/account/mcp/central-selections","GET"),false);
  assert.equal(sameOriginPath("/account/mcp/central-selections","POST"),true);
  assert.equal(sameOriginPath("/account/mcp/central-targets","POST"),false);
  const calls=[];
  const h=centralHarness({status:"authenticated"},async (...args)=>{
    calls.push(args);
    return args[0].includes("central-targets")?centralTargets:
      args[0].includes("?")?centralTickets:
      {ok:true,schema:"ordax.owner-central-device-selection/1",status:"pending",
        client_id:client,device_id:first.device_id,challenge_id:challenge,
        expires_at:expiry,attested:false,dispatch_authorized:false};
  });
  assert.equal((await h.targets(client)).eligible_device_count,1);
  assert.equal((await h.tickets(client)).count,1);
  assert.equal((await h.select(centralChoice)).status,"pending");
  assert.deepEqual(calls.map(c=>c[0]),[
    "/account/mcp/central-targets?client_id="+client,
    "/account/mcp/central-selections?client_id="+client,
    "/account/mcp/central-selections",
  ]);
  assert.equal(calls[2][2].method,"POST");
  assert.deepEqual(calls[2][2].jsonBody,centralChoice);
});

test("Account central results never imply attestation and reject session changes",async()=>{
  for(const invalid of [{...centralTargets,attested:true},
    {...centralTargets,targets:[{...centralTargets.targets[0],runtime_ready:"yes"}]},
    {...centralTargets,client_id:other}]){
    await assert.rejects(centralHarness({status:"authenticated"},async()=>invalid).targets(client));
  }
  for(const invalid of [{...centralTickets,count:2},
    {...centralTickets,pending_selections:[{...centralTickets.pending_selections[0],
      challenge_id:"bad"}]}, {...centralTickets,dispatch_authorized:true}]){
    await assert.rejects(centralHarness({status:"authenticated"},async()=>invalid).tickets(client));
  }
  await assert.rejects(centralHarness({status:"authenticated"},async()=>({
    ok:true,schema:"ordax.owner-central-device-selection/1",status:"bound",
    client_id:client,challenge_id:challenge,device_id:first.device_id,
    expires_at:expiry,attested:true,dispatch_authorized:true,
  })).select(centralChoice));
  await assert.rejects(centralHarness({status:"anonymous"},async()=>{
    throw Error("must not fetch");
  }).select(centralChoice),/session-required/);
  let release;
  const waiting=new Promise(resolve=>{release=resolve});
  const h=centralHarness({status:"authenticated"},()=>waiting);
  const request=h.targets(client);
  h.change({status:"authenticated"});
  release(centralTargets);
  await assert.rejects(request,/session-changed/);
  const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8");
  assert.match(portal,/data-mcp-central-select/);
  assert.match(portal,/mcpCentralSelections\?\.count === 1/);
  assert.match(portal,/window\.confirm\(/);
  assert.match(portal,/mcpCentralNotice = "Vínculo solicitado/);
  assert.match(portal,/expires_at belongs only to this pending Owner challenge/);
  assert.match(portal,/conversation -> device binding is persistent in Platform/);
  assert.match(portal,/offline, heartbeat atrasado ou reinício não escolhem outra instalação/);
  assert.match(portal,/Desafio desta conversa — compare com o código do ChatGPT/);
  assert.match(portal,/\$\{esc\(ticket\.challenge_id\)\}/,
    "the signed-in Owner sees the exact server challenge escaped for display");
  assert.match(portal,/Confira se este desafio é exatamente o mostrado pelo ChatGPT/);
  assert.match(portal,/\$\{ticket\.challenge_id\}/,
    "the confirmation dialog must repeat the precise selected ticket");
  assert.match(portal,/Confirmar esta instalação para a conversa/);
  assert.match(portal,/\$\{device\?\.name \|\| deviceId\} \(\$\{deviceId\}\)/,
    "the Owner must see both installation name and exact device id");
  assert.doesNotMatch(portal,/Vincular esta conversa ao computador/);
  assert.doesNotMatch(portal,/Selecionar sessão MCP/);
});

test("Account grant inspection is scoped to one UUID, rejects forgery and duplicate grants", async () => {
  const calls = [];
  const h = ownerHarness({status:"authenticated"},async (...args) => {calls.push(args);return authority;});
  assert.deepEqual(await h.authority(first.device_id),authority);
  assert.equal(calls[0][0],"/account/mcp/authority?device_id="+first.device_id);
  await assert.rejects(h.authority("evil-device"),/mcp-owner-device-invalid/);
  await assert.rejects(ownerHarness({status:"authenticated"},async()=>({...authority,device_id:other})).authority(first.device_id),/mcp-owner-authority-invalid/);
  await assert.rejects(ownerHarness({status:"authenticated"},async()=>({...authority,grant_groups:[groupItem,groupItem]})).authority(first.device_id),/mcp-owner-authority-invalid/);
  for(const invalid of [
    {...groupItem,scope_kind:"project",space_id:null,project_id:null},
    {...groupItem,scope_kind:"device",space_id:space,project_id:project},
    {...groupItem,scope_kind:"project",space_id:space,project_id:"bad"},
    {...groupItem,scope_kind:"other"},
  ]) {
    await assert.rejects(ownerHarness({status:"authenticated"},async()=>({
      ...authority,grant_groups:[invalid],
    })).authority(first.device_id),/mcp-owner-authority-invalid/);
  }
  const scoped={...groupItem,profile_key:"project-native-terminal",
    scope_kind:"project",space_id:space,project_id:project};
  assert.equal((await ownerHarness({status:"authenticated"},async()=>({
    ...authority,grant_groups:[scoped],
  })).authority(first.device_id)).grant_groups[0].scope_kind,"project");
  const rolloutDevice={grant_group_id:group,client_id:client,
    profile_key:"full-computer-control",valid_until:null,client_consent_active:true};
  const legacyView=await ownerHarness({status:"authenticated"},async()=>({
    ...authority,grant_groups:[rolloutDevice],
  })).authority(first.device_id);
  assert.equal(legacyView.grant_groups[0].scope_kind,undefined,
    "absent rollout scope is never inferred as Project authority");
});

test("Project grant browser port accepts exact Terminal/Process/Blender scope and sanitizes response", async () => {
  const expiry=new Date(Date.now()+60*60*1000).toISOString();
  const input={device_id:first.device_id,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:expiry,confirm:"authorize_project"};
  const grantId="77777777-7777-4777-8777-777777777777";
  const upstream={ok:true,schema:"ordax.owner-project-grant/1",grant_group_id:grantId,
    device_id:first.device_id,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:expiry,
    capabilities:["terminal.exec"],local_project_ref:"project-1",access_mode:"write"};
  const calls=[];
  const h=ownerHarness({status:"authenticated"},async(...args)=>{calls.push(args);return upstream});
  const value=await h.grant(input);
  assert.deepEqual(value,{ok:true,schema:"ordax.owner-project-grant/1",grant_group_id:grantId,
    device_id:first.device_id,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:expiry});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/project-grants");
  assert.equal(calls[0][2].method,"POST");
  assert.deepEqual(calls[0][2].jsonBody,input);
  assert.equal("capabilities" in value,false);
  assert.equal("local_project_ref" in value,false);
  assert.equal("access_mode" in value,false);

  const unbounded={...input,profile_key:"project-native-process",valid_until:null};
  const processReply={...upstream,profile_key:"project-native-process",valid_until:null};
  assert.equal((await ownerHarness({status:"authenticated"},async()=>processReply).grant(unbounded)).valid_until,null);

  // The same scoped Owner endpoint already supports the canonical Blender profile.
  // Do not mint capabilities, local paths or consent in the browser response.
  const blenderInput={...input,profile_key:"project-blender-control"};
  const blenderReply={...upstream,profile_key:"project-blender-control",
    capabilities:["blender.live_rig_create"],local_project_ref:"should-not-leak"};
  const blender=await ownerHarness({status:"authenticated"},async()=>blenderReply).grant(blenderInput);
  assert.equal(blender.profile_key,"project-blender-control");
  assert.equal(blender.device_id,blenderInput.device_id);
  assert.equal(blender.space_id,blenderInput.space_id);
  assert.equal(blender.project_id,blenderInput.project_id);
  assert.equal("capabilities" in blender,false);
  assert.equal("local_project_ref" in blender,false);
  await assert.rejects(ownerHarness({status:"authenticated"},async()=>({...blenderReply,
    profile_key:"project-native-terminal"})).grant(blenderInput),/project-grant-unconfirmed/);

  for(const extra of [
    {local_project_ref:"project-1"},{path:"C:/repo"},{capabilities:["terminal.exec"]},
    {access_mode:"write"},{repository_id:"123"},{grant_group_id:grantId},{metadata:{}},
  ]) {
    const before=calls.length;
    await assert.rejects(h.grant({...input,...extra}),/project-grant-invalid/);
    assert.equal(calls.length,before,"forged authority must fail before transport");
  }
  for(const bad of [
    {...input,profile_key:"full-computer-control"},
    {...input,profile_key:"project-browser-automation"},
    {...input,confirm:"yes"},
    {...input,valid_until:new Date(Date.now()-1000).toISOString()},
    {...input,valid_until:new Date(Date.now()+366*24*60*60*1000).toISOString()},
  ]) await assert.rejects(h.grant(bad),/project-grant-invalid/);
});

test("Project grant browser port fails closed on response drift and superseded session", async () => {
  const expiry=new Date(Date.now()+60*60*1000).toISOString();
  const input={device_id:first.device_id,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:expiry,confirm:"authorize_project"};
  const reply={ok:true,schema:"ordax.owner-project-grant/1",
    grant_group_id:"77777777-7777-4777-8777-777777777777",
    device_id:first.device_id,client_id:client,space_id:space,project_id:project,
    profile_key:"project-native-terminal",valid_until:expiry};
  for(const invalid of [
    {...reply,schema:"other"},
    {...reply,grant_group_id:"bad"},
    {...reply,device_id:other},
    {...reply,client_id:other},
    {...reply,space_id:other},
    {...reply,project_id:other},
    {...reply,profile_key:"project-native-process"},
    {...reply,valid_until:null},
  ]) await assert.rejects(ownerHarness({status:"authenticated"},async()=>invalid).grant(input),
    /project-grant-unconfirmed/);
  await assert.rejects(ownerHarness({status:"anonymous"},async()=>reply).grant(input),
    /session-required/);
  let release;
  const waiting=new Promise(resolve=>{release=resolve});
  const h=ownerHarness({status:"authenticated"},()=>waiting);
  const pending=h.grant(input);
  h.change({status:"authenticated"});
  release(reply);
  await assert.rejects(pending,/session-changed/);
});

test("Device profile reauthorization posts only existing grant identity and sanitizes receipt", async () => {
  const input={device_id:first.device_id,client_id:client,grant_group_id:group,confirm:"reauthorize"};
  const nextGroup="77777777-7777-4777-8777-777777777777";
  const reply={ok:true,schema:"ordax.owner-profile-reauthorization/1",
    device_id:first.device_id,client_id:client,previous_grant_group_id:group,
    grant_group_id:nextGroup,profile_key:"full-computer-control",valid_until:null,
    capability_count:40,capabilities:["forbidden.browser.detail"]};
  const calls=[];
  const h=ownerHarness({status:"authenticated"},async(...args)=>{calls.push(args);return reply});
  const value=await h.reauthorize(input);
  assert.equal(value.grant_group_id,nextGroup);
  assert.equal(value.profile_key,"full-computer-control");
  assert.equal("capabilities" in value,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/reauthorize");
  assert.equal(calls[0][2].method,"POST");
  assert.deepEqual(calls[0][2].jsonBody,input);
  for(const extra of [{profile_key:"full-computer-control"},{capabilities:["computer.transfer_begin"]},
    {valid_until:null},{space_id:space},{project_id:project}]) {
    const before=calls.length;
    await assert.rejects(h.reauthorize({...input,...extra}),/reauthorize-invalid/);
    assert.equal(calls.length,before,"browser cannot choose reauthorization authority");
  }
  for(const invalid of [{...reply,schema:"other"},{...reply,grant_group_id:"bad"},
    {...reply,previous_grant_group_id:other},{...reply,device_id:other},
    {...reply,client_id:other},{...reply,capability_count:0}]) {
    await assert.rejects(ownerHarness({status:"authenticated"},async()=>invalid).reauthorize(input),
      /reauthorize-unconfirmed/);
  }
});

test("Revocation is an explicit same-origin POST and rejects unconfirmed outcomes", async () => {
  const input={device_id:first.device_id,client_id:client,grant_group_id:group,confirm:"revogar"};
  let calls=[];
  const h=ownerHarness({status:"authenticated"},async (...args)=>{
    calls.push(args);
    return {ok:true,schema:"ordax.owner-mcp-revocation/1",revoked:true,
      device_id:first.device_id,client_id:client,grant_group_id:group};
  });
  assert.equal((await h.revoke(input)).revoked,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],"/account/mcp/revoke");
  assert.equal(calls[0][2].method,"POST");
  assert.deepEqual(calls[0][2].jsonBody,input);
  await assert.rejects(h.revoke({...input,confirm:"yes"}),/mcp-owner-revoke-invalid/);
  await assert.rejects(ownerHarness({status:"authenticated"},async()=>({ok:true})).revoke(input),/mcp-owner-revoke-unconfirmed/);
  await assert.rejects(ownerHarness({status:"anonymous"},async()=>{throw Error("unexpected");}).revoke(input),/public-account-session-required/);
});

test("Late grant/revocation responses cannot authorize a superseded Account session", async () => {
  let resolve;
  const waiting=new Promise(r=>{resolve=r});
  const h=ownerHarness({status:"authenticated"},()=>waiting);
  const pending=h.authority(first.device_id);
  h.change({status:"authenticated"});
  resolve(authority);
  await assert.rejects(pending,/public-account-session-changed/);
});

test("Revoke UI requires exact group and Owner confirmation; no optimistic removal",()=>{
  const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8");
  assert.match(portal,/window\.confirm\(/);
  assert.match(portal,/mcpAuthority\.grant_groups\.some\(/);
  assert.match(portal,/await account\.revokeMcpGrant\(/);
  assert.match(portal,/await account\.readMcpAuthority\(deviceId\)/);
  assert.match(portal,/mcp-owner-revoke-not-reflected/);
  assert.match(source,/method !== "POST" \|\| !\[/);
  assert.match(source,/"\/account\/mcp\/project-onboarding\/device-binding-intents"/);
  assert.match(source,/"\/account\/mcp\/github\/repository-selections"/);
});

test("denied MCP device selection cannot invalidate an active grant revocation",async()=>{
  // Exercise the actual portal controller, not a duplicate implementation.
  const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8");
  const start=portal.indexOf("  async function loadMcpAuthority(deviceId) {");
  const end=portal.indexOf("\n  async function loadMcpProjectOnboarding(deviceId) {",start);
  assert.ok(start>=0 && end>start);
  const realFunction=portal.slice(start,end);
  const run=new Function("deviceId","answer",[
    'let mcpRevoking=true, mcpAuthorityRevision=7, mcpAuthority=null;',
    'let mcpAuthorityDevice=null, mcpAuthorityStatus="unavailable";',
    'let mcpRevocationNotice="", mcpDevicesStatus="ready";',
    'let mcpCentralSelecting=false,mcpProjectGrantCreating=false;const resetMcpCentral=()=>{};',
    'let mcpDevices=[{device_id:deviceId}], calls=0;',
    'const state={section:"dispositivos"};',
    'const signedIn=()=>true, renderContent=()=>{};',
    'const account={readMcpAuthority:async()=>{calls+=1;return answer}};',
    realFunction,
    'return {open:loadMcpAuthority, revision:()=>mcpAuthorityRevision,',
    '  calls:()=>calls, release:()=>{mcpRevoking=false}};',
  ].join("\n"))(first.device_id,authority);
  await run.open(first.device_id);
  assert.equal(run.revision(),7,"stale click must not cancel pending POST");
  assert.equal(run.calls(),0,"stale click cannot query while revoking");
  run.release();
  await run.open(first.device_id);
  assert.equal(run.revision(),8);
  assert.equal(run.calls(),1);
});

test("MCP device presentation never marks offline Runtime as verified or exposes busy controls",()=>{
  // Exercise the real Account renderer; readiness alone never proves online state.
  const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8");
  const start=portal.indexOf("  function mcpDeviceRecords() {");
  const end=portal.indexOf("\n  function mcpProjectPanel() {",start);
  assert.ok(start>0 && end>start,"real MCP device renderer missing");
  const render=new Function("devices","selecting","revoking","creating","granting",[
    'const mcpDevicesStatus="ready",mcpDevices=devices;',
    'const mcpRevoking=revoking,mcpCentralSelecting=selecting,mcpProjectCreating=creating,mcpProjectBinding=false,mcpProjectGrantCreating=granting;',
    'const i18n={getLocale:()=>"pt-BR"};',
    'const esc=value=>String(value??""),tx=value=>String(value);',
    'const icon=()=>"",pendingRecords=()=>"",empty=()=>"";',
    'const action=(label,_icon,options)=>"<button"+(options.disabled?" disabled":"")+">"+label+"</button>";',
    portal.slice(start,end),
    "return mcpDeviceRecords();",
  ].join("\n"));
  const target={device_id:first.device_id,name:"Product",
    last_seen_at:"2026-11-12T06:00:00Z",online:false,runtime_ready:true};
  const offline=render([target],false,false,false,false);
  assert.match(offline,/Offline/);
  assert.doesNotMatch(offline,/status-tag is-verified/,"offline is not attested");
  assert.match(offline,/<button>Autorizações<\/button>/);
  const online=render([{...target,online:true}],false,false,false,false);
  assert.match(online,/status-tag is-verified/);
  assert.match(render([{...target,online:true,runtime_ready:false}],false,false,false,false),
    /Runtime não confirmado/);
  assert.doesNotMatch(render([{...target,online:true,runtime_ready:false}],false,false,false,false),
    /status-tag is-verified/);
  assert.match(render([target],true,false,false,false),/<button disabled>Autorizações<\/button>/);
  assert.match(render([target],false,true,false,false),/<button disabled>Autorizações<\/button>/);
  assert.match(render([target],false,false,true,false),/<button disabled>Autorizações<\/button>/);
  const panel=portal.slice(portal.indexOf("  function mcpAuthorityPanel() {"),
    portal.indexOf("\n  function field(",portal.indexOf("  function mcpAuthorityPanel() {")));
  assert.match(panel,/disabled:mcpRevoking \|\| mcpCentralSelecting \|\| mcpProjectGrantCreating, small:true/);
});

test("re-entering devices refreshes Owner data without interrupting a revocation",()=>{
  // Run the actual router with injected navigation/document stubs.
  const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8");
  const start=portal.indexOf("  function route({ initial = false } = {}) {");
  const end=portal.indexOf("\n  const dialog = document.getElementById(\"account-dialog\");",start);
  assert.ok(start>0 && end>start,"real Account router missing");
  const realRoute=portal.slice(start,end);
  const harness=new Function("revoking","selecting","creating","binding","granting",[
    'let state={section:"visao-geral"};',
    'const byId=new Map([["visao-geral",{}],["dispositivos",{}]]);',
    'const location={hash:"#dispositivos"};',
    'const window={scrollTo:()=>{}};',
    'const document={getElementById:()=>({focus:()=>{}})};',
    'const dialog={open:false,close:()=>{}};',
    'const closeMore=()=>{},renderNavigation=()=>{},renderContent=()=>{};',
    'const subscriptionStatus="ready",loadSubscription=()=>{};',
    'let mcpRevoking=revoking,mcpCentralSelecting=selecting,mcpProjectCreating=creating,mcpProjectBinding=binding,mcpProjectGrantCreating=granting,mcpProjectGrantRevision=9,mcpDevicesRevision=3,mcpAuthorityRevision=5;',
    'const mcpGithubConnecting=false,mcpGithubSelecting=false,mcpGithubChallenge=null,mcpGithubStatus="idle";',
    'let mcpDevices=[{device_id:"old"}],mcpDevicesStatus="ready";',
    'let mcpAuthority={grant_groups:[{grant_group_id:"old"}]},mcpAuthorityDevice="old",',
    '    mcpAuthorityStatus="ready",mcpRevocationNotice="old";',
    'const signedIn=()=>true;',
    'let centralResets=0;const resetMcpCentral=()=>{centralResets++};',
    'let projectResets=0;const resetMcpProjectOnboarding=()=>{projectResets++};',
    'let loads=0;',
    'async function loadMcpDevices(){loads++;mcpDevicesStatus="loading";}',
    realRoute,
    'return {run:route, setHash:v=>{location.hash=v}, resets:()=>centralResets, projectResets:()=>projectResets,',
    '  view:()=>({loads,deviceRev:mcpDevicesRevision,authRev:mcpAuthorityRevision,',
    '  devices:mcpDevices,authority:mcpAuthority,chosen:mcpAuthorityDevice,',
    '  deviceStatus:mcpDevicesStatus,notice:mcpRevocationNotice})};',
  ].join("\n"));

  const normal=harness(false,false,false,false,false);
  normal.run();
  assert.deepEqual(normal.view(),{
    loads:1,deviceRev:4,authRev:6,devices:null,authority:null,
    chosen:null,deviceStatus:"loading",notice:"",
  });
  normal.run();
  assert.equal(normal.view().loads,1,"hash revisit during fetch must not duplicate calls");
  normal.setHash("#visao-geral");normal.run();
  normal.setHash("#dispositivos");normal.run();
  assert.equal(normal.view().loads,2,"new visit refreshes instead of showing stale grants");

  const pending=harness(true,false,false,false,false);
  pending.run();
  assert.equal(pending.view().loads,0,"do not start a new fetch during revoke");
  assert.equal(pending.view().authRev,5,"do not cancel in-flight revocation receipt");
  assert.equal(pending.view().authority.grant_groups[0].grant_group_id,"old");

  // A user may navigate away and back after confirming the Owner choice
  // while the single POST is still in flight. Never invalidate its receipt
  // or permit a fresh selection while the original outcome is uncertain.
  const selecting=harness(false,true,false,false,false);
  selecting.run();
  assert.equal(selecting.view().loads,0,"do not refresh while selecting");
  assert.equal(selecting.view().authRev,5);
  assert.equal(selecting.view().deviceRev,3);
  selecting.setHash("#visao-geral");
  selecting.run();
  selecting.setHash("#dispositivos");
  selecting.run();
  assert.equal(selecting.view().loads,0,"revisit cannot restart inventory during POST");
  assert.equal(selecting.view().authRev,5,"revisit preserves the Owner selection receipt");
  assert.equal(selecting.view().deviceRev,3,"revisit preserves current device scope");
  assert.equal(selecting.view().chosen,"old");
  assert.equal(selecting.resets(),0,"revisit must not cancel the pending selection");
  assert.equal(selecting.projectResets(),0,"revisit must not cancel project state during selection");

  const creating=harness(false,false,true,false,false);
  creating.run();
  assert.equal(creating.view().loads,0,"do not refresh inventory during project POST");
  creating.setHash("#visao-geral");creating.run();
  creating.setHash("#dispositivos");creating.run();
  assert.equal(creating.view().loads,0,"revisit cannot restart inventory during project POST");
  assert.equal(creating.projectResets(),0,"revisit must preserve an uncertain project receipt");

  const binding=harness(false,false,false,true,false);
  binding.run();
  assert.equal(binding.view().loads,0,"do not refresh inventory during binding POST");
  binding.setHash("#visao-geral");binding.run();
  binding.setHash("#dispositivos");binding.run();
  assert.equal(binding.view().loads,0,"revisit cannot restart inventory during binding POST");
  assert.equal(binding.projectResets(),0,"revisit must preserve an uncertain binding receipt");

  const granting=harness(false,false,false,false,true);
  granting.run();
  assert.equal(granting.view().loads,0,"do not refresh inventory during Project grant POST");
  granting.setHash("#visao-geral");granting.run();
  granting.setHash("#dispositivos");granting.run();
  assert.equal(granting.view().loads,0,"revisit cannot restart inventory during Project grant POST");
  assert.equal(granting.projectResets(),0,"revisit must preserve an uncertain Project grant receipt");
});

test("Project UI keeps Runtime binding separate and exposes Terminal/Process/Blender grants after binding",()=>{
  const portal=readFileSync(new URL("../public/assets/account-portal.js",import.meta.url),"utf8");
  assert.match(portal,/data-mcp-project-form/);
  assert.match(portal,/data-mcp-github-connect/);
  assert.match(portal,/data-mcp-github-selection/);
  assert.match(portal,/data-mcp-project-bind/);
  assert.match(portal,/data-mcp-project-grant-form/);
  assert.match(portal,/project-native-terminal/);
  assert.match(portal,/project-native-process/);
  assert.match(portal,/project-blender-control/);
  assert.match(portal,/!githubConfigured \|\| mcpGithubConnecting/);
  assert.match(portal,/pendingBinding \|\| !bindingEnabled/);
  assert.match(portal,/onboarding_availability\?\.project_device_binding_enabled !== true/);
  assert.match(portal,/onboarding_availability\?\.github_authorization_configured !== true/);
  assert.match(portal,/Blender do projeto/);
  assert.match(portal,/project\.next_state === "ready_without_grants"/);
  assert.match(portal,/await account\.createMcpProjectGrant\(/);
  assert.match(portal,/Never replay an uncertain grant POST/);
  assert.match(portal,/await account\.readMcpAuthority\(deviceId\)/);
  assert.match(portal,/scope_kind === "project"/);
  assert.match(portal,/Aguardando Runtime/);
  assert.match(portal,/await account\.requestMcpProjectDeviceBinding\(/);
  assert.match(portal,/Never replay an uncertain binding POST/);
  assert.match(portal,/await account\.startMcpGithubAuthorization\(projectId\)/);
  assert.match(portal,/await account\.readMcpGithubCandidates\(challengeId\)/);
  assert.match(portal,/await account\.selectMcpGithubRepository\(/);
  assert.doesNotMatch(portal,/local_project_ref|name="installation_id"|data-mcp-device-bind/);
  assert.doesNotMatch(portal,/full-computer-control|project-browser-automation|project-workspace-read/);
  assert.doesNotMatch(portal,/searchParams\.get\("code"\)|searchParams\.get\("state"\)/);
});
