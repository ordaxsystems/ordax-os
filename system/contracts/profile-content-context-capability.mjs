export const PROFILE_CONTENT_CONTEXT_CAPABILITY_SCHEMA = "ordax.profile-content-context-capability/1";

export function validateProfileContentContextCapability(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Profile content context capability must be an object");
  }
  if (
    value.schema !== PROFILE_CONTENT_CONTEXT_CAPABILITY_SCHEMA
    || Object.keys(value).sort().join(",") !== "available,schema"
    || typeof value.available !== "boolean"
  ) {
    throw new TypeError("Profile content context capability is incompatible");
  }
  return Object.freeze({
    schema: PROFILE_CONTENT_CONTEXT_CAPABILITY_SCHEMA,
    available: value.available,
  });
}
