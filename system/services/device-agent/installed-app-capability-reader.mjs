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
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

function exactObject(value, fields, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== [...fields].sort().join(",")) {
    throw new TypeError(label + " fields are incompatible");
  }
  return value;
}

function bounded(value, label) {
  if (typeof value !== "string" || !value || value.length > 128 || CONTROL_RE.test(value)) {
    throw new TypeError(label + " is invalid");
  }
  return value;
}

function verifiedCaller(value) {
  exactObject(value, ["appId", "packageSha256", "accountId", "spaceId", "deviceId", "verified"],
    "Installed app caller");
  if (value.verified !== true || !APP_ID_RE.test(value.appId)
      || !SHA256_RE.test(value.packageSha256)) {
    throw new TypeError("Installed app caller is not a verified package");
  }
  return Object.freeze({
    appId: value.appId,
    packageSha256: value.packageSha256,
    accountId: bounded(value.accountId, "Caller account"),
    spaceId: bounded(value.spaceId, "Caller Space"),
    deviceId: bounded(value.deviceId, "Caller device"),
  });
}

function allowedDecision(raw, caller) {
  exactObject(raw, ["schema", "appId", "packageSha256", "accountId", "spaceId", "deviceId", "capabilities"],
    "App capability decision");
  if (raw.schema !== INSTALLED_APP_CAPABILITY_DECISION_SCHEMA
      || raw.appId !== caller.appId || raw.packageSha256 !== caller.packageSha256
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
} = {}) {
  if (typeof resolveCaller !== "function" || typeof readAllowedCapabilities !== "function") {
    throw new TypeError("Installed app capabilities require trusted host resolvers");
  }
  const reader = assertDeviceAgentCapabilityReaderPort(capabilityReader);
  return Object.freeze({
    schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
    async capabilities(request = undefined) {
      if (request !== undefined) {
        throw new TypeError("App capability discovery must not select a caller or scope");
      }
      // Both resolvers are OS-private ports. Fail closed if absent, stale, or
      // malformed. Do not return a previous/cached authorized snapshot.
      const caller = verifiedCaller(await resolveCaller());
      const [decision, available] = await Promise.all([
        readAllowedCapabilities(caller),
        reader.capabilities({ client: "ordax-native" }),
      ]);
      const allowed = allowedDecision(decision, caller);
      const current = validateDeviceAgentCapabilitiesSnapshot(available);
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
