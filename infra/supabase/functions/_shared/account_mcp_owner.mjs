// Transport of the ONE Product Owner MCP authority into OrdaX Account.
// The Supabase Account bearer stays on the server. No shadow ACL or storage.
import { readBoundedBody } from "./bounded_body.mjs";

export const ACCOUNT_MCP_DEVICES_PATH = "/account/mcp/devices";
export const ACCOUNT_MCP_AUTHORITY_PATH = "/account/mcp/authority";
export const ACCOUNT_MCP_REVOKE_PATH = "/account/mcp/revoke";
export const OWNER_MCP_DEVICES_URL = "https://mcp.ordax.com.br/v3/owner/devices";
const OWNER_MCP_AUTHORITY_URL = "https://mcp.ordax.com.br/v3/owner/remote-authority";
const OWNER_MCP_GRANTS_URL = "https://mcp.ordax.com.br/v3/owner/remote-grant-groups";
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

async function ownerRequest(access, url, method, fetcher=fetch) {
  verifyToken(access);
  if (typeof url !== "string" || !url.startsWith("https://mcp.ordax.com.br/v3/owner/"))
    throw new Error("mcp-owner-noncanonical-destination");
  const response = await fetcher(url, {
    method, redirect:"error", cache:"no-store",
    headers:{Authorization:"Bearer " + access, Accept:"application/json"},
    signal:AbortSignal.timeout(10000),
  });
  if (!response || response.status !== 200 || !response.ok || response.url !== url)
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
