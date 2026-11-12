import { validateSystemCapabilityId } from "./system-foundation.mjs";

export const SURFACE_HOST_SCHEMA = "ordax.surface-host/1";

const CONNECTIVITY = new Set(["online", "offline", "unknown"]);

export function validateSurfaceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Surface host snapshot must be an object");
  }

  // Older snapshots may omit the list; an explicitly malformed list is never
  // converted into "no capabilities" because that conceals a broken provider.
  const capabilityIds = value.capabilityIds === undefined ? [] : value.capabilityIds;
  if (!Array.isArray(capabilityIds)) {
    throw new TypeError("Surface capability IDs must be an array");
  }
  const validatedIds = capabilityIds.map(validateSystemCapabilityId);
  if (new Set(validatedIds).size !== validatedIds.length) {
    throw new TypeError("Surface capability IDs must be unique");
  }

  const connectivity = value.connectivity ?? "unknown";
  if (!CONNECTIVITY.has(connectivity)) {
    throw new TypeError(`Unsupported Surface connectivity state: ${connectivity}`);
  }

  return Object.freeze({
    capabilityIds: Object.freeze(validatedIds),
    connectivity,
  });
}

export function assertSurfaceHost(host) {
  if (!host || typeof host !== "object") {
    throw new TypeError("Surface host is required");
  }
  if (host.schema !== SURFACE_HOST_SCHEMA) {
    throw new TypeError(`Unsupported Surface host schema: ${String(host.schema)}`);
  }
  if (typeof host.getSnapshot !== "function") {
    throw new TypeError("Surface host must implement getSnapshot()");
  }
  if (typeof host.subscribe !== "function") {
    throw new TypeError("Surface host must implement subscribe(listener)");
  }

  validateSurfaceSnapshot(host.getSnapshot());
  return host;
}
