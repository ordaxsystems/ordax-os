/** Compatibility facade for Studio v1: system preflight owns all checks. */
import { createDeviceActionPreflight } from "./action-preflight.mjs";

export const STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA =
  "ordax.studio-device-action-authorization/1";

export function createStudioDeviceActionAuthorizer(options = {}) {
  const preflight = createDeviceActionPreflight(options);
  return Object.freeze({
    schema: STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA,
    async authorize(request, grant) {
      const inspected = await preflight.check(request, grant);
      return Object.freeze({
        ...inspected,
        schema: STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA,
      });
    },
  });
}
