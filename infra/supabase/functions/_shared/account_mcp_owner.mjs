// Transport of the ONE Product Owner MCP authority into OrdaX Account.
// The Supabase Account bearer stays on the server. No shadow ACL or storage.
import { readBoundedBody } from "./bounded_body.mjs";

export const ACCOUNT_MCP_DEVICES_PATH = "/account/mcp/devices";
export const ACCOUNT_MCP_AUTHORITY_PATH = "/account/mcp/authority";
export const ACCOUNT_MCP_REVOKE_PATH = "/account/mcp/revoke";
export const ACCOUNT_MCP_CENTRAL_TARGETS_PATH = "/account/mcp/central-targets";
export const ACCOUNT_MCP_CENTRAL_SELECTIONS_PATH = "/account/mcp/central-selections";
export const ACCOUNT_MCP_PROJECT_ONBOARDING_PATH = "/account/mcp/project-onboarding";
export const ACCOUNT_MCP_PROJECTS_PATH = "/account/mcp/project-onboarding/projects";
export const OWNER_MCP_DEVICES_URL = "https://mcp.ordax.com.br/v3/owner/devices";
const OWNER_MCP_AUTHORITY_URL = "https://mcp.ordax.com.br/v3/owner/remote-authority";
const OWNER_MCP_GRANTS_URL = "https://mcp.ordax.com.br/v3/owner/remote-grant-groups";
const OWNER_CENTRAL_TARGETS_URL = "https://mcp.ordax.com.br/v3/owner/central-session-targets";
const OWNER_CENTRAL_SELECTIONS_URL = "https://mcp.ordax.com.br/v3/owner/central-session-selections";
export const OWNER_PROJECT_ONBOARDING_URL = "https://mcp.ordax.com.br/v3/owner/project-onboarding";
export const OWNER_PROJECTS_URL = OWNER_PROJECT_ONBOARDING_URL + "/projects";
const MAX_OWNER_BODY = 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_.-]{16,16384}$/;
const PROFILE = /^[a-z][a-z0-9._-]{1,79}$/;

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
    groups.push({grant_group_id:g.grant_group_id, client_id:g.client_id,
      profile_key:g.profile_key, valid_until:g.valid_until,
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
