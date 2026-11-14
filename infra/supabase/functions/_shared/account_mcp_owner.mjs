// Transport of the ONE Product Owner MCP authority into OrdaX Account.
// The Supabase Account bearer stays on the server. No shadow ACL or storage.
import { readBoundedBody } from "./bounded_body.mjs";

export const ACCOUNT_MCP_DEVICES_PATH = "/account/mcp/devices";
export const ACCOUNT_MCP_AUTHORITY_PATH = "/account/mcp/authority";
export const ACCOUNT_MCP_REVOKE_PATH = "/account/mcp/revoke";
export const ACCOUNT_MCP_PROJECT_GRANTS_PATH = "/account/mcp/project-grants";
export const ACCOUNT_MCP_CENTRAL_TARGETS_PATH = "/account/mcp/central-targets";
export const ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH = "/account/mcp/central-selections";
export const ACCOUNT_MCP_PROJECT_ONBOARDING_PATH = "/account/mcp/project-onboarding";
export const ACCOUNT_MCP_PROJECTS_PATH = "/account/mcp/project-onboarding/projects";
export const ACCOUNT_MCP_PROJECT_BINDING_INTENTS_PATH = "/account/mcp/project-onboarding/device-binding-intents";
export const ACCOUNT_MCP_GITHUB_CHALLENGES_PATH = "/account/mcp/github/authorization-challenges";
export const ACCOUNT_MCP_GITHUB_CALLBACK_PATH = "/account/mcp/github/callback";
export const ACCOUNT_MCP_GITHUB_CANDIDATES_PATH = "/account/mcp/github/repository-candidates";
export const ACCOUNT_MCP_GITHUB_SELECTIONS_PATH = "/account/mcp/github/repository-selections";
export const OWNER_MCP_DEVICES_URL = "https://mcp.ordax.com.br/v3/owner/devices";
const OWNER_MCP_AUTHORITY_URL = "https://mcp.ordax.com.br/v3/owner/remote-authority";
const OWNER_MCP_GRANTS_URL = "https://mcp.ordax.com.br/v3/owner/remote-grant-groups";
const OWNER_CENTRAL_TARGETS_URL = "https://mcp.ordax.com.br/v3/owner/central-session-targets";
const OWNER_CENTRAL_SELECTIONS_URL = "https://mcp.ordax.com.br/v3/owner/central-session-selections";
export const OWNER_PROJECT_ONBOARDING_URL = "https://mcp.ordax.com.br/v3/owner/project-onboarding";
export const OWNER_PROJECTS_URL = OWNER_PROJECT_ONBOARDING_URL + "/projects";
export const OWNER_PROJECT_BINDING_INTENTS_URL = OWNER_PROJECT_ONBOARDING_URL + "/device-binding-intents";
export const OWNER_GITHUB_CHALLENGES_URL = "https://mcp.ordax.com.br/v3/owner/github/authorization-challenges";
export const OWNER_GITHUB_COMPLETIONS_URL = "https://mcp.ordax.com.br/v3/owner/github/authorization-completions";
export const OWNER_GITHUB_CANDIDATES_URL = "https://mcp.ordax.com.br/v3/owner/github/repository-candidates";
export const OWNER_GITHUB_SELECTIONS_URL = "https://mcp.ordax.com.br/v3/owner/github/repository-selections";
const MAX_OWNER_BODY = 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_.-]{16,16384}$/;
const PROFILE = /^[a-z][a-z0-9._-]{1,79}$/;
const PROJECT_NATIVE_GRANT_PROFILES = Object.freeze({
  "project-native-process": 6,
  "project-native-terminal": 1,
});

const isRecord = value => value && typeof value === "object" && !Array.isArray(value);
export const isOwnerUuid = value => typeof value === "string" && UUID.test(value);
const verifyToken = access => {
  if (typeof access !== "string" || !TOKEN.test(access))
    throw new Error("mcp-owner-access-invalid");
};

export function validateAccountOwnerDevices(value) {
  if (!isRecord(value) || value.ok !== true || value.schema !== "ordax.owner-mcp-devices/1"
      || !Array.isArray(value.devices) || value.devices.length > 200
      || value.count !== value.devices.length) return null;
  const ids = new Set(), devices = [];
  for (const item of value.devices) {
    if (!isRecord(item) || !isOwnerUuid(item.device_id) || ids.has(item.device_id)
        || typeof item.name !== "string" || item.name.length < 1 || item.name.length > 120
        || typeof item.kind !== "string" || item.kind.length > 80
        || typeof item.channel !== "string" || item.channel.length > 80
        || typeof item.state !== "string" || item.state.length > 80
        || typeof item.online !== "boolean" || typeof item.runtime_ready !== "boolean"
        || !(item.last_seen_at === null || (typeof item.last_seen_at === "string"
          && item.last_seen_at.length <= 64 && Number.isFinite(Date.parse(item.last_seen_at))))) return null;
    ids.add(item.device_id);
    devices.push({ device_id:item.device_id, name:item.name, kind:item.kind,
      channel:item.channel, state:item.state, online:item.online,
      runtime_ready:item.runtime_ready, last_seen_at:item.last_seen_at });
  }
  return {ok:true, schema:"ordax.owner-mcp-devices/1", count:devices.length, devices};
}

export function validateAccountOwnerAuthority(value, requestedDeviceId) {
  if (!isRecord(value) || value.ok !== true || !isOwnerUuid(requestedDeviceId)
      || value.device_id !== requestedDeviceId || !Array.isArray(value.clients)
      || value.clients.length > 100 || !Array.isArray(value.grant_groups)
      || value.grant_groups.length > 256) return null;
  const clients = [], clientIds = new Set();
  for (const item of value.clients) {
    if (!isRecord(item) || !isOwnerUuid(item.client_id) || clientIds.has(item.client_id)
        || typeof item.client_name !== "string" || item.client_name.length > 120) return null;
    clientIds.add(item.client_id);
    clients.push({client_id:item.client_id, client_name:item.client_name});
  }
  const groups = [], groupIds = new Set();
  for (const g of value.grant_groups) {
    if (!isRecord(g) || !isOwnerUuid(g.grant_group_id) || groupIds.has(g.grant_group_id)
        || !isOwnerUuid(g.client_id) || g.device_id !== requestedDeviceId
        || typeof g.profile_key !== "string" || !PROFILE.test(g.profile_key)
        || !(g.valid_until === null || (typeof g.valid_until === "string"
          && g.valid_until.length <= 64 && Number.isFinite(Date.parse(g.valid_until))))
        || typeof g.client_consent_active !== "boolean") return null;
    groupIds.add(g.grant_group_id);
    // A revoked OAuth consent can leave a previously active grant visible.
    // An Owner must still be able to revoke that exact grant safely.
    const projectScope = g.scope_kind === "project";
    const deviceScope = g.scope_kind === "device";
    if ((!projectScope && !deviceScope)
        || (projectScope && (!isOwnerUuid(g.space_id) || !isOwnerUuid(g.project_id)))
        || (deviceScope && (g.space_id !== null || g.project_id !== null))) return null;
    groups.push({grant_group_id:g.grant_group_id, client_id:g.client_id,
      profile_key:g.profile_key, scope_kind:g.scope_kind,
      space_id:g.space_id, project_id:g.project_id, valid_until:g.valid_until,
      client_consent_active:g.client_consent_active});
  }
  return {ok:true, schema:"ordax.owner-mcp-authority-view/1",
    device_id:requestedDeviceId, clients, grant_groups:groups};
}

async function ownerRequest(access, url, method, fetcher=fetch, body=null, expectedStatus=200) {
  verifyToken(access);
  if (typeof url !== "string" || !url.startsWith("https://mcp.ordax.com.br/v3/owner/"))
    throw new Error("mcp-owner-noncanonical-destination");
  const response = await fetcher(url, {
    method, redirect:"error", cache:"no-store",
    headers:{Authorization:"Bearer " + access, Accept:"application/json",
      ...(body===null?{}:{"Content-Type":"application/json"})},
    ...(body===null?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(10000),
  });
  if (!response || response.status !== expectedStatus || !response.ok || response.url !== url)
    throw new Error("mcp-owner-upstream-unavailable");
  const bytes = await readBoundedBody(
    response.body, response.headers.get("content-length"), MAX_OWNER_BODY,
  );
  return JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes));
}

export async function readAccountOwnerDevices(access, fetcher=fetch) {
  const value = await ownerRequest(access, OWNER_MCP_DEVICES_URL, "GET", fetcher);
  const verified = validateAccountOwnerDevices(value);
  if (!verified) throw new Error("mcp-owner-devices-invalid");
  return verified;
}

export async function readAccountOwnerAuthority(access, deviceId, fetcher=fetch) {
  if (!isOwnerUuid(deviceId)) throw new Error("mcp-owner-device-invalid");
  const url = OWNER_MCP_AUTHORITY_URL + "?device_id=" + deviceId;
  const value = await ownerRequest(access, url, "GET", fetcher);
  const verified = validateAccountOwnerAuthority(value, deviceId);
  if (!verified) throw new Error("mcp-owner-authority-invalid");
  return verified;
}

const validDate = value => typeof value === "string" && value.length <= 64
  && Number.isFinite(Date.parse(value));
const PROJECT_KINDS = new Set(["general","development","creative","legal","business","research"]);
const PROJECT_NEXT_STATES = new Set([
  "needs_github_installation","needs_repository_selection",
  "needs_device_binding","ready_without_grants",
]);
const ROOT_PROJECT_STATES = new Set(["needs_space","needs_project"]);
const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const GITHUB_CALLBACK_URL = "https://ordax.com.br/account/mcp/github/callback";
const GITHUB_STATE = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const GITHUB_CODE = /^[^\s\u0000-\u001f\u007f]{8,1024}$/;
const GITHUB_PROVIDER_ID = /^[1-9][0-9]{0,18}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,100}$/;
const GITHUB_CLIENT_ID = /^[A-Za-z0-9_.-]{8,160}$/;
const GITHUB_INSTALL_URL = /^https:\/\/github\.com\/apps\/[A-Za-z0-9-]+\/installations\/new$/;
const GITHUB_BIGINT_MAX = 9223372036854775807n;

function isGithubProviderId(value) {
  if (typeof value !== "string" || !GITHUB_PROVIDER_ID.test(value)) return false;
  try { return BigInt(value) <= GITHUB_BIGINT_MAX; } catch { return false; }
}

function githubInstallUrl(value) {
  return typeof value === "string" && value.length <= 512 && GITHUB_INSTALL_URL.test(value)
    ? value : null;
}

function githubAuthorizationUrl(value, challengeId) {
  if (typeof value !== "string" || value.length > 2048 || !isOwnerUuid(challengeId)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== "https://github.com" || url.pathname !== "/login/oauth/authorize"
      || url.username || url.password || url.hash) return null;
  const expected = ["allow_signup","client_id","code_challenge","code_challenge_method",
    "prompt","redirect_uri","state"].sort().join(",");
  if ([...url.searchParams.keys()].sort().join(",") !== expected) return null;
  const state = url.searchParams.get("state") ?? "";
  const stateMatch = GITHUB_STATE.exec(state);
  if (!stateMatch || stateMatch[1] !== challengeId
      || !GITHUB_CLIENT_ID.test(url.searchParams.get("client_id") ?? "")
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "")
      || url.searchParams.get("code_challenge_method") !== "S256"
      || url.searchParams.get("redirect_uri") !== GITHUB_CALLBACK_URL
      || url.searchParams.get("allow_signup") !== "false"
      || url.searchParams.get("prompt") !== "select_account") return null;
  return url.toString();
}

export function validateAccountOwnerProjectOnboarding(value, requestedDeviceId) {
  if (!isRecord(value) || value.ok !== true || value.device_id !== requestedDeviceId
      || !isOwnerUuid(requestedDeviceId) || !Array.isArray(value.spaces)
      || value.spaces.length > 64 || !Array.isArray(value.projects)
      || value.projects.length > 512
      || !(value.next_state === null || ROOT_PROJECT_STATES.has(value.next_state))) return null;
  const spaces=[], spaceIds=new Set();
  for (const s of value.spaces) {
    if (!isRecord(s) || !isOwnerUuid(s.space_id) || spaceIds.has(s.space_id)
        || typeof s.name !== "string" || s.name.length < 1 || s.name.length > 120
        || typeof s.kind !== "string" || s.kind.length < 1 || s.kind.length > 80
        || s.state !== "active") return null;
    spaceIds.add(s.space_id);
    spaces.push({space_id:s.space_id,name:s.name,kind:s.kind,state:"active"});
  }
  const projects=[], projectIds=new Set();
  for (const p of value.projects) {
    if (!isRecord(p) || !isOwnerUuid(p.project_id) || projectIds.has(p.project_id)
        || !isOwnerUuid(p.space_id) || !spaceIds.has(p.space_id)
        || typeof p.name !== "string" || p.name.length < 1 || p.name.length > 120
        || !PROJECT_KINDS.has(p.kind) || p.state !== "active"
        || !Number.isSafeInteger(p.github_connection_count) || p.github_connection_count < 0
        || typeof p.space_device_execute !== "boolean"
        || typeof p.project_device_bound !== "boolean"
        || !PROJECT_NEXT_STATES.has(p.next_state)
        || !(p.repository_full_name === null
          || (typeof p.repository_full_name === "string"
            && p.repository_full_name.length <= 220 && REPOSITORY.test(p.repository_full_name)))
        || (p.github_connection_count === 1) !== (p.repository_full_name !== null)) return null;
    projectIds.add(p.project_id);
    projects.push({project_id:p.project_id,space_id:p.space_id,name:p.name,kind:p.kind,
      state:"active",github_connection_count:p.github_connection_count,
      repository_full_name:p.repository_full_name,
      space_device_execute:p.space_device_execute,
      project_device_bound:p.project_device_bound,next_state:p.next_state});
  }
  if ((value.next_state === "needs_space" && spaces.length !== 0)
      || (value.next_state === "needs_project" && (spaces.length === 0 || projects.length !== 0))
      || (value.next_state === null && (spaces.length === 0 || projects.length === 0))) return null;
  return {ok:true,schema:"ordax.owner-project-onboarding-view/1",
    device_id:requestedDeviceId,spaces,projects,next_state:value.next_state};
}

export async function readAccountOwnerProjectOnboarding(access, deviceId, fetcher=fetch) {
  if (!isOwnerUuid(deviceId)) throw new Error("mcp-owner-device-invalid");
  const url=OWNER_PROJECT_ONBOARDING_URL+"?device_id="+deviceId;
  const value=await ownerRequest(access,url,"GET",fetcher);
  const verified=validateAccountOwnerProjectOnboarding(value,deviceId);
  if (!verified) throw new Error("mcp-owner-project-onboarding-invalid");
  return verified;
}

export function parseAccountOwnerProjectCreate(value) {
  if (!isRecord(value)
      || Object.keys(value).sort().join(",") !== "confirm,kind,name,space_id"
      || !isOwnerUuid(value.space_id) || !PROJECT_KINDS.has(value.kind)
      || typeof value.name !== "string" || value.name.trim().length < 1
      || value.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(value.name)
      || value.confirm !== "create_project") return null;
  return {space_id:value.space_id,name:value.name.trim(),kind:value.kind,confirm:"create_project"};
}

export async function createAccountOwnerProject(access, raw, fetcher=fetch) {
  const input=parseAccountOwnerProjectCreate(raw);
  if (!input) throw new Error("mcp-owner-project-create-invalid");
  // Exactly one POST. An uncertain response is never retried because Project
  // creation is a mutation with a server-generated identity.
  const value=await ownerRequest(access,OWNER_PROJECTS_URL,"POST",fetcher,input,201);
  if (!isRecord(value) || value.ok !== true || !isOwnerUuid(value.project_id)
      || value.space_id !== input.space_id || value.state !== "active"
      || value.next_state !== "needs_github_installation")
    throw new Error("mcp-owner-project-create-unconfirmed");
  return {ok:true,schema:"ordax.owner-project-created/1",project_id:value.project_id,
    space_id:value.space_id,state:"active",next_state:"needs_github_installation"};
}

export function parseAccountOwnerProjectBindingIntent(value) {
  if (!isRecord(value)
      || Object.keys(value).sort().join(",") !== "confirm,device_id,project_id"
      || !isOwnerUuid(value.project_id) || !isOwnerUuid(value.device_id)
      || value.confirm !== "bind_project_device") return null;
  return {
    project_id:value.project_id,
    device_id:value.device_id,
    confirm:"bind_project_device",
  };
}

export async function createAccountOwnerProjectBindingIntent(access, raw, fetcher=fetch) {
  const input=parseAccountOwnerProjectBindingIntent(raw);
  if (!input) throw new Error("mcp-owner-project-binding-intent-invalid");
  // Exactly one POST. Device confirmation is a separate enrolled-Runtime step,
  // and an uncertain Owner mutation is never retried by Account.
  const value=await ownerRequest(
    access,OWNER_PROJECT_BINDING_INTENTS_URL,"POST",fetcher,input,201,
  );
  if (!isRecord(value) || value.ok !== true
      || value.schema !== "ordax.owner-project-device-binding-intent/1"
      || !isOwnerUuid(value.intent_id)
      || value.project_id !== input.project_id
      || value.device_id !== input.device_id
      || !validDate(value.expires_at)
      || value.next_state !== "awaiting_device_confirmation") {
    throw new Error("mcp-owner-project-binding-intent-unconfirmed");
  }
  return {
    ok:true,
    schema:"ordax.owner-project-device-binding-intent/1",
    intent_id:value.intent_id,
    project_id:value.project_id,
    device_id:value.device_id,
    expires_at:value.expires_at,
    next_state:"awaiting_device_confirmation",
  };
}

export function parseAccountOwnerGithubAuthorizationStart(value) {
  if (!isRecord(value)
      || Object.keys(value).sort().join(",") !== "confirm,project_id"
      || !isOwnerUuid(value.project_id) || value.confirm !== "connect_github") return null;
  return {project_id:value.project_id,confirm:"connect_github"};
}

export async function startAccountOwnerGithubAuthorization(access, raw, fetcher=fetch) {
  const input=parseAccountOwnerGithubAuthorizationStart(raw);
  if (!input) throw new Error("mcp-owner-github-start-invalid");
  const value=await ownerRequest(access,OWNER_GITHUB_CHALLENGES_URL,"POST",fetcher,input,201);
  if (!isRecord(value) || value.ok !== true || !isOwnerUuid(value.challenge_id)
      || value.project_id !== input.project_id || !validDate(value.expires_at))
    throw new Error("mcp-owner-github-start-unconfirmed");
  const authorizationUrl=githubAuthorizationUrl(value.authorization_url,value.challenge_id);
  const installUrl=githubInstallUrl(value.install_url);
  if (!authorizationUrl || !installUrl)
    throw new Error("mcp-owner-github-start-unconfirmed");
  return {ok:true,schema:"ordax.owner-github-authorization-challenge/1",
    challenge_id:value.challenge_id,project_id:value.project_id,
    authorization_url:authorizationUrl,install_url:installUrl,expires_at:value.expires_at};
}

export function parseAccountOwnerGithubCallback(value) {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "code,state"
      || typeof value.code !== "string" || !GITHUB_CODE.test(value.code)
      || typeof value.state !== "string" || !GITHUB_STATE.test(value.state)) return null;
  return {code:value.code,state:value.state};
}

export async function completeAccountOwnerGithubAuthorization(access, raw, fetcher=fetch) {
  const input=parseAccountOwnerGithubCallback(raw);
  if (!input) throw new Error("mcp-owner-github-callback-invalid");
  const challengeId=GITHUB_STATE.exec(input.state)[1];
  // OAuth code/state are one-shot. Never retry this POST after an uncertain response.
  const value=await ownerRequest(access,OWNER_GITHUB_COMPLETIONS_URL,"POST",fetcher,input);
  if (!isRecord(value) || value.ok !== true || value.challenge_id !== challengeId
      || !isOwnerUuid(value.project_id) || !Number.isSafeInteger(value.candidate_count)
      || value.candidate_count < 0 || value.candidate_count > 500
      || value.next_state !== (value.candidate_count > 0
        ? "needs_repository_selection" : "needs_github_installation")
      || !validDate(value.expires_at)) throw new Error("mcp-owner-github-callback-unconfirmed");
  const installUrl=githubInstallUrl(value.install_url);
  if (!installUrl) throw new Error("mcp-owner-github-callback-unconfirmed");
  return {ok:true,schema:"ordax.owner-github-authorization-completed/1",
    challenge_id:challengeId,project_id:value.project_id,
    candidate_count:value.candidate_count,next_state:value.next_state,
    install_url:installUrl,expires_at:value.expires_at};
}

export async function readAccountOwnerGithubCandidates(access, challengeId, fetcher=fetch) {
  if (!isOwnerUuid(challengeId)) throw new Error("mcp-owner-github-challenge-invalid");
  const url=OWNER_GITHUB_CANDIDATES_URL+"?challenge_id="+challengeId;
  const value=await ownerRequest(access,url,"GET",fetcher);
  if (!isRecord(value) || value.ok !== true || value.challenge_id !== challengeId
      || !isOwnerUuid(value.project_id) || !Array.isArray(value.repositories)
      || value.repositories.length > 500 || !validDate(value.expires_at))
    throw new Error("mcp-owner-github-candidates-invalid");
  const ids=new Set(),repositories=[];
  for(const item of value.repositories) {
    if (!isRecord(item) || !isGithubProviderId(item.repository_id)
        || ids.has(item.repository_id)
        || typeof item.repository_full_name !== "string"
        || item.repository_full_name.length > 200 || !REPOSITORY.test(item.repository_full_name)
        || !(item.default_branch === null || (typeof item.default_branch === "string"
          && item.default_branch.length >= 1 && item.default_branch.length <= 255
          && !/[\u0000-\u001f\u007f]/.test(item.default_branch)))
        || typeof item.installation_account_login !== "string"
        || !GITHUB_LOGIN.test(item.installation_account_login)) {
      throw new Error("mcp-owner-github-candidates-invalid");
    }
    ids.add(item.repository_id);
    repositories.push({repository_id:item.repository_id,
      repository_full_name:item.repository_full_name,default_branch:item.default_branch,
      installation_account_login:item.installation_account_login});
  }
  return {ok:true,schema:"ordax.owner-github-repository-candidates/1",
    challenge_id:challengeId,project_id:value.project_id,repositories,
    expires_at:value.expires_at};
}

export function parseAccountOwnerGithubSelection(value) {
  if (!isRecord(value)
      || Object.keys(value).sort().join(",") !== "challenge_id,confirm,repository_id"
      || !isOwnerUuid(value.challenge_id) || !isGithubProviderId(value.repository_id)
      || value.confirm !== "select_repository") return null;
  return {challenge_id:value.challenge_id,repository_id:value.repository_id,
    confirm:"select_repository"};
}

export async function selectAccountOwnerGithubRepository(access, raw, fetcher=fetch) {
  const input=parseAccountOwnerGithubSelection(raw);
  if (!input) throw new Error("mcp-owner-github-selection-invalid");
  const before=await readAccountOwnerGithubCandidates(access,input.challenge_id,fetcher);
  const candidate=before.repositories.find(item=>item.repository_id===input.repository_id);
  if (!candidate) throw new Error("mcp-owner-github-repository-not-verified");
  // Exactly one mutation POST. Platform rechecks the private verified candidate atomically.
  const value=await ownerRequest(access,OWNER_GITHUB_SELECTIONS_URL,"POST",fetcher,input);
  if (!isRecord(value) || value.ok !== true || value.challenge_id !== input.challenge_id
      || !isOwnerUuid(value.connection_id) || value.project_id !== before.project_id
      || value.repository_id !== input.repository_id
      || value.repository_full_name !== candidate.repository_full_name
      || value.default_branch !== candidate.default_branch
      || value.state !== "active" || value.next_state !== "needs_device_binding")
    throw new Error("mcp-owner-github-selection-unconfirmed");
  return {ok:true,schema:"ordax.owner-github-repository-selected/1",
    challenge_id:input.challenge_id,connection_id:value.connection_id,
    project_id:value.project_id,repository_id:value.repository_id,
    repository_full_name:value.repository_full_name,default_branch:value.default_branch,
    state:"active",next_state:"needs_device_binding"};
}

// These are projections of the existing Platform SQL results, not a second
// device/permission catalog. Neither read is a grant, session or attestation.
export async function readAccountOwnerCentralTargets(access, clientId, fetcher=fetch) {
  if (!isOwnerUuid(clientId)) throw new Error("mcp-owner-client-invalid");
  const value = await ownerRequest(access,
    OWNER_CENTRAL_TARGETS_URL + "?client_id=" + clientId, "GET", fetcher);
  if (!isRecord(value) || value.ok !== true || value.client_id !== clientId
      || !Number.isSafeInteger(value.eligible_device_count)
      || value.eligible_device_count < 0 || value.eligible_device_count > 25
      || !Array.isArray(value.targets)
      || value.targets.length !== value.eligible_device_count
      || value.attested !== false || value.dispatch_authorized !== false
      || value.owner_choice_performed !== false
      || !["no_action_grant","single_granted_target","owner_selection_required"]
        .includes(value.state)
      || value.state !== (value.eligible_device_count === 0 ? "no_action_grant"
        : value.eligible_device_count === 1 ? "single_granted_target"
        : "owner_selection_required")) throw new Error("mcp-owner-central-targets-invalid");
  const devices = new Set(), targets = [];
  for (const t of value.targets) {
    if (!isRecord(t) || !isOwnerUuid(t.device_id) || devices.has(t.device_id)
        || typeof t.reported_online !== "boolean"
        || typeof t.runtime_ready !== "boolean") throw new Error("mcp-owner-central-targets-invalid");
    devices.add(t.device_id);
    targets.push({device_id:t.device_id,reported_online:t.reported_online,
      runtime_ready:t.runtime_ready});
  }
  return {ok:true,schema:"ordax.owner-central-targets/1",client_id:clientId,
    state:value.state,eligible_device_count:targets.length,targets,
    attested:false,dispatch_authorized:false};
}

export async function readAccountOwnerCentralSelections(access, clientId, fetcher=fetch) {
  if (!isOwnerUuid(clientId)) throw new Error("mcp-owner-client-invalid");
  const value = await ownerRequest(access,
    OWNER_CENTRAL_SELECTIONS_URL + "?client_id=" + clientId, "GET", fetcher);
  if (!isRecord(value) || value.ok !== true
      || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 25
      || !Array.isArray(value.pending_selections)
      || value.pending_selections.length !== value.count
      || value.attested !== false || value.dispatch_authorized !== false)
    throw new Error("mcp-owner-central-selections-invalid");
  const ids = new Set(), pending = [];
  for (const ticket of value.pending_selections) {
    if (!isRecord(ticket) || Object.keys(ticket).sort().join(",")
          !== "challenge_id,created_at,expires_at"
        || !isOwnerUuid(ticket.challenge_id) || ids.has(ticket.challenge_id)
        || !validDate(ticket.created_at) || !validDate(ticket.expires_at))
      throw new Error("mcp-owner-central-selections-invalid");
    ids.add(ticket.challenge_id);
    pending.push({challenge_id:ticket.challenge_id,
      created_at:ticket.created_at,expires_at:ticket.expires_at});
  }
  return {ok:true,schema:"ordax.owner-central-selections/1",client_id:clientId,
    count:pending.length,pending_selections:pending,
    attested:false,dispatch_authorized:false};
}

export function parseAccountOwnerCentralSelection(value) {
  if (!isRecord(value) || Object.keys(value).sort().join(",")
      !== "challenge_id,client_id,confirm,device_id"
      || !isOwnerUuid(value.client_id) || !isOwnerUuid(value.challenge_id)
      || !isOwnerUuid(value.device_id) || value.confirm !== "selecionar") return null;
  return {client_id:value.client_id,challenge_id:value.challenge_id,
    device_id:value.device_id};
}

// Only a pending Owner challenge is time-bounded. Once Platform + Runtime
// confirm conversation -> device, that binding is persistent Platform state;
// this gateway never renews it, expires it from heartbeat/inactivity, or
// chooses another target because the bound Runtime goes offline.
export async function selectAccountOwnerCentralDevice(access, raw, fetcher=fetch) {
  const input = parseAccountOwnerCentralSelection(raw);
  if (!input) throw new Error("mcp-owner-central-selection-invalid");
  // Preflight only; SQL remains the exclusive authority and rechecks
  // the exact grant, signed Owner, consent, online Runtime and ticket atomically.
  const [targets, tickets] = await Promise.all([
    readAccountOwnerCentralTargets(access,input.client_id,fetcher),
    readAccountOwnerCentralSelections(access,input.client_id,fetcher),
  ]);
  if (!targets.targets.some(t => t.device_id === input.device_id
        && t.reported_online && t.runtime_ready)
      || tickets.count !== 1 || tickets.pending_selections[0].challenge_id
        !== input.challenge_id || Date.parse(tickets.pending_selections[0].expires_at)
        <= Date.now()) throw new Error("mcp-owner-central-selection-not-eligible");
  // Exactly one POST, never an implicit retry or a claim of attestation.
  const value = await ownerRequest(access, OWNER_CENTRAL_SELECTIONS_URL, "POST", fetcher,
    {client_id:input.client_id,challenge_id:input.challenge_id,device_id:input.device_id});
  if (!isRecord(value) || value.ok !== true || value.status !== "pending"
      || value.device_id !== input.device_id || value.challenge_id !== input.challenge_id
      || !validDate(value.expires_at) || Date.parse(value.expires_at) <= Date.now()
      || value.attested !== false
      || value.dispatch_authorized !== false)
    throw new Error("mcp-owner-central-selection-unconfirmed");
  return {ok:true,schema:"ordax.owner-central-device-selection/1",
    status:"pending",client_id:input.client_id,device_id:input.device_id,
    challenge_id:input.challenge_id,expires_at:value.expires_at,
    attested:false,dispatch_authorized:false};
}

export function parseAccountOwnerProjectGrant(value, now=Date.now()) {
  if (!isRecord(value)
      || Object.keys(value).sort().join(",")
        !== "client_id,confirm,device_id,profile_key,project_id,space_id,valid_until"
      || !isOwnerUuid(value.device_id) || !isOwnerUuid(value.client_id)
      || !isOwnerUuid(value.space_id) || !isOwnerUuid(value.project_id)
      || !(value.profile_key in PROJECT_NATIVE_GRANT_PROFILES)
      || value.confirm !== "authorize_project") return null;
  let validUntil = null;
  if (value.valid_until !== null) {
    if (typeof value.valid_until !== "string" || value.valid_until.length > 64) return null;
    const parsed = Date.parse(value.valid_until);
    if (!Number.isFinite(parsed) || !Number.isFinite(now) || parsed <= now
        || parsed > now + 365 * 24 * 60 * 60 * 1000) return null;
    validUntil = new Date(parsed).toISOString();
  }
  return {
    device_id:value.device_id,
    client_id:value.client_id,
    space_id:value.space_id,
    project_id:value.project_id,
    profile_key:value.profile_key,
    valid_until:validUntil,
    confirm:"authorize_project",
  };
}

function sameGrantExpiry(a, b) {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

function sameGrantIdentity(a, b) {
  return a.client_id === b.client_id
    && a.profile_key === b.profile_key
    && a.scope_kind === b.scope_kind
    && a.space_id === b.space_id
    && a.project_id === b.project_id
    && sameGrantExpiry(a.valid_until, b.valid_until)
    && a.client_consent_active === b.client_consent_active;
}

export async function createAccountOwnerProjectGrant(
  access, raw, fetcher=fetch, now=Date.now(),
) {
  const input = parseAccountOwnerProjectGrant(raw, now);
  if (!input) throw new Error("mcp-owner-project-grant-request-invalid");

  // A browser-selected Project/Space tuple never proves scope. Re-read the
  // canonical onboarding state and require the completed two-party binding.
  const onboarding = await readAccountOwnerProjectOnboarding(
    access, input.device_id, fetcher,
  );
  const project = onboarding.projects.find(item =>
    item.project_id === input.project_id && item.space_id === input.space_id);
  if (!project || project.next_state !== "ready_without_grants"
      || project.space_device_execute !== true
      || project.project_device_bound !== true
      || typeof project.repository_full_name !== "string")
    throw new Error("mcp-owner-project-grant-scope-not-ready");

  const before = await readAccountOwnerAuthority(access, input.device_id, fetcher);
  if (!before.clients.some(item => item.client_id === input.client_id))
    throw new Error("mcp-owner-project-grant-client-not-consented");
  const replacing = before.grant_groups.filter(group =>
    group.client_id === input.client_id
      && group.profile_key === input.profile_key
      && group.scope_kind === "project"
      && group.space_id === input.space_id
      && group.project_id === input.project_id);
  if (replacing.length > 1)
    throw new Error("mcp-owner-project-grant-ambiguous");

  const requestBody = {
    client_id:input.client_id,
    device_id:input.device_id,
    profile_key:input.profile_key,
    project_id:input.project_id,
    space_id:input.space_id,
    valid_until:input.valid_until,
  };
  // Exactly one POST. An unknown outcome is reconciled by an explicit later
  // Owner read; it is never retried automatically.
  const receipt = await ownerRequest(
    access, OWNER_MCP_GRANTS_URL, "POST", fetcher, requestBody,
  );
  if (!isRecord(receipt) || receipt.ok !== true
      || !isOwnerUuid(receipt.grant_group_id)
      || receipt.scope_kind !== "project"
      || receipt.capability_count !== PROJECT_NATIVE_GRANT_PROFILES[input.profile_key])
    throw new Error("mcp-owner-project-grant-unconfirmed");

  const after = await readAccountOwnerAuthority(access, input.device_id, fetcher);
  const created = after.grant_groups.filter(group =>
    group.grant_group_id === receipt.grant_group_id
      && group.client_id === input.client_id
      && group.profile_key === input.profile_key
      && group.scope_kind === "project"
      && group.space_id === input.space_id
      && group.project_id === input.project_id
      && sameGrantExpiry(group.valid_until, input.valid_until)
      && group.client_consent_active === true);
  if (created.length !== 1) throw new Error("mcp-owner-project-grant-unconfirmed");

  const replaceIds = new Set(replacing.map(group => group.grant_group_id));
  const afterById = new Map(after.grant_groups.map(group => [group.grant_group_id, group]));
  for (const group of before.grant_groups) {
    if (replaceIds.has(group.grant_group_id)) continue;
    const current = afterById.get(group.grant_group_id);
    if (!current || !sameGrantIdentity(current, group))
      throw new Error("mcp-owner-project-grant-isolation-unverified");
  }
  const expectedAfterCount = before.grant_groups.length - replacing.length + 1;
  if (after.grant_groups.length !== expectedAfterCount)
    throw new Error("mcp-owner-project-grant-isolation-unverified");

  return {
    ok:true,
    schema:"ordax.owner-project-grant/1",
    grant_group_id:receipt.grant_group_id,
    device_id:input.device_id,
    client_id:input.client_id,
    space_id:input.space_id,
    project_id:input.project_id,
    profile_key:input.profile_key,
    valid_until:input.valid_until,
  };
}

export function parseAccountOwnerRevoke(value) {
  if (!isRecord(value)
      || Object.keys(value).sort().join(",") !== "client_id,confirm,device_id,grant_group_id"
      || !isOwnerUuid(value.device_id) || !isOwnerUuid(value.client_id)
      || !isOwnerUuid(value.grant_group_id) || value.confirm !== "revogar") return null;
  return {device_id:value.device_id, client_id:value.client_id,
    grant_group_id:value.grant_group_id};
}

export async function revokeAccountOwnerGrant(access, raw, fetcher=fetch) {
  const input = parseAccountOwnerRevoke(raw);
  if (!input) throw new Error("mcp-owner-revoke-request-invalid");
  // A caller-supplied group/client/device triple never proves grant ownership.
  const before = await readAccountOwnerAuthority(access, input.device_id, fetcher);
  if (before.grant_groups.filter(g => g.client_id === input.client_id
      && g.grant_group_id === input.grant_group_id).length !== 1)
    throw new Error("mcp-owner-revoke-stale");
  const url = OWNER_MCP_GRANTS_URL + "/" + input.grant_group_id
    + "?client_id=" + input.client_id;
  // Exactly one DELETE. No blind retry after timeout or ambiguous outcome.
  const result = await ownerRequest(access, url, "DELETE", fetcher);
  if (!isRecord(result) || result.ok !== true)
    throw new Error("mcp-owner-revoke-unconfirmed");
  const after = await readAccountOwnerAuthority(access, input.device_id, fetcher);
  // A reused or reassigned group id is not proof of revocation.
  if (after.grant_groups.some(g => g.grant_group_id === input.grant_group_id))
    throw new Error("mcp-owner-revoke-unconfirmed");
  // Never report an isolated revocation as successful when a different grant
  // also disappeared or changed identity. Concurrent Owner changes are
  // ambiguous, so this check intentionally fails closed rather than retrying.
  const preserved = new Map(after.grant_groups.map(g => [g.grant_group_id, g]));
  for (const group of before.grant_groups) {
    if (group.grant_group_id === input.grant_group_id) continue;
    const current = preserved.get(group.grant_group_id);
    if (!current || current.client_id !== group.client_id
        || current.profile_key !== group.profile_key
        || current.valid_until !== group.valid_until
        || current.client_consent_active !== group.client_consent_active)
      throw new Error("mcp-owner-revoke-isolation-unverified");
  }
  return {ok:true, schema:"ordax.owner-mcp-revocation/1", revoked:true,
    device_id:input.device_id, client_id:input.client_id,
    grant_group_id:input.grant_group_id};
}
