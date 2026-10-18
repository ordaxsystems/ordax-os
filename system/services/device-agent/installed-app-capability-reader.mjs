/**
 * System-owned, read-only capability projection for an installed app instance.
 *
 * Only trusted OS composition may construct this port: resolveCaller is bound to
 * the live IPC/process identity of the verified package, never to app-supplied
 * JSON, a manifest, a prompt, or a bearer token forwarded by a renderer.
 *
 * readAllowedCapabilities must be backed by the existing OS permission manager.
 * This module does not store/mint grants, dispatch, or replace Action Gateway
 * enforcement. Each read resolves current caller and policy afresh.
 */
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  assertDeviceAgentCapabilityReaderPort,
  validateDeviceAgentCapabilitiesSnapshot,
} from "../../contracts/device-capabilities.mjs";

export const INSTALLED_APP_CAPABILITY_DECISION_SCHEMA =
  "ordax.installed-app-capability-decision/1";

const APP_ID_RE = /^[a-z][a-z0-9-]{0,127}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
// The Native host assigns a fresh UUID for each live mount. Reusing the
// same app bytes or same install receipt MUST NOT revive an old port.
const INSTANCE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(label + " must be a plain data object");
  }
  const keys = Reflect.ownKeys(value);
  const allowed = new Set(fields);
  if (keys.length !== allowed.size || keys.some(key => !allowed.has(key))) {
    throw new TypeError(label + " fields are incompatible");
  }
  // Reject accessors: caller/decision identity cannot change between checks.
  if (Object.values(Object.getOwnPropertyDescriptors(value))
      .some(descriptor => !Object.hasOwn(descriptor, "value"))) {
    throw new TypeError(label + " cannot contain accessor fields");
  }
  return value;
}

function bounded(value, label) {
  if (typeof value !== "string" || !value || value.length > 128 || CONTROL_RE.test(value)) {
    throw new TypeError(label + " is invalid");
  }
  return value;
}

function optionalScope(value, label) {
  return value === null ? null : bounded(value, label);
}

function sameCaller(a, b) {
  return a.appId === b.appId && a.publisherId === b.publisherId
    && a.packageSha256 === b.packageSha256
    && a.runtimeInstanceId === b.runtimeInstanceId && a.accountId === b.accountId
    && a.spaceId === b.spaceId && a.deviceId === b.deviceId;
}

function verifiedCaller(value) {
  exactObject(value, ["appId", "publisherId", "packageSha256", "runtimeInstanceId", "accountId", "spaceId", "deviceId", "verified"],
    "Installed app caller");
  if (value.verified !== true || !APP_ID_RE.test(value.appId)
      || !SHA256_RE.test(value.packageSha256)
      || !INSTANCE_RE.test(value.runtimeInstanceId)) {
    throw new TypeError("Installed app caller is not a verified package");
  }
  return Object.freeze({
    appId: value.appId,
    publisherId: bounded(value.publisherId, "Caller publisher"),
    packageSha256: value.packageSha256,
    runtimeInstanceId: value.runtimeInstanceId,
    // Guest/device-owner sessions intentionally have no account or Space.
    // Only the trusted OS resolver may decide that a scope is null.
    accountId: optionalScope(value.accountId, "Caller account"),
    spaceId: optionalScope(value.spaceId, "Caller Space"),
    deviceId: bounded(value.deviceId, "Caller device"),
  });
}

function allowedDecision(raw, caller) {
  exactObject(raw, ["schema", "appId", "publisherId", "packageSha256", "accountId", "spaceId", "deviceId", "capabilities"],
    "App capability decision");
  if (raw.schema !== INSTALLED_APP_CAPABILITY_DECISION_SCHEMA
      || raw.appId !== caller.appId || raw.publisherId !== caller.publisherId
      || raw.packageSha256 !== caller.packageSha256
      || raw.accountId !== caller.accountId || raw.spaceId !== caller.spaceId
      || raw.deviceId !== caller.deviceId) {
    throw new TypeError("App capability decision is not bound to the verified caller");
  }
  // Reuse the single published snapshot validator rather than define another
  // capability identifier/mode grammar inside the app layer.
  const projection = validateDeviceAgentCapabilitiesSnapshot({
    schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
    state: "ready",
    capabilities: raw.capabilities,
  });
  return projection.capabilities;
}

export function createInstalledAppCapabilityReader({
  resolveCaller,
  readAllowedCapabilities,
  capabilityReader,
  mountCaller = null,
} = {}) {
  if (typeof resolveCaller !== "function" || typeof readAllowedCapabilities !== "function") {
    throw new TypeError("Installed app capabilities require trusted host resolvers");
  }
  const reader = assertDeviceAgentCapabilityReaderPort(capabilityReader);
  // Only trusted composition may supply the mount-time identity. Without a
  // mount pin, a host-global reader is still valid for internal diagnostics.
  const pinnedCaller = mountCaller === null ? null : verifiedCaller(mountCaller);
  return Object.freeze({
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities(request = undefined) {
      if (request !== undefined) {
        throw new TypeError("App capability discovery must not select a caller or scope");
      }
      // Both resolvers are OS-private ports. Fail closed if absent, stale, or
      // malformed. Do not return a previous/cached authorized snapshot.
      const caller = verifiedCaller(await resolveCaller());
      if (pinnedCaller !== null && !sameCaller(caller, pinnedCaller)) {
        throw new TypeError("Installed app mount identity is no longer current");
      }
      const [decision, available] = await Promise.all([
        readAllowedCapabilities(caller),
        reader.capabilities({ client: "ordax-native" }),
      ]);
      const allowed = allowedDecision(decision, caller);
      const current = validateDeviceAgentCapabilitiesSnapshot(available);
      // A Space/account switch, package update or uninstall during the async
      // permission read cannot return a stale capability snapshot to the app.
      const currentCaller = verifiedCaller(await resolveCaller());
      if (!sameCaller(currentCaller, caller)) {
        throw new TypeError("Installed app caller changed during capability discovery");
      }
      if (pinnedCaller !== null && !sameCaller(currentCaller, pinnedCaller)) {
        throw new TypeError("Installed app mount identity is no longer current");
      }
      if (current.state !== "ready") {
        return validateDeviceAgentCapabilitiesSnapshot({
          schema: DEVICE_AGENT_CAPABILITIES_SCHEMA, state: "degraded", capabilities: [],
        });
      }
      const allowById = new Map(allowed.map(item => [item.id, new Set(item.modes)]));
      const visible = current.capabilities.flatMap(capability => {
        const modes = capability.modes.filter(mode => allowById.get(capability.id)?.has(mode));
        return modes.length ? [{ id: capability.id, modes }] : [];
      });
      return validateDeviceAgentCapabilitiesSnapshot({
        schema: DEVICE_AGENT_CAPABILITIES_SCHEMA, state: "ready", capabilities: visible,
      });
    },
  });
}
