import { validatePreferenceRecord } from "./preference-store.mjs";

export const PREFERENCE_RUNTIME_SCHEMA = "ordax.preference-runtime/1";

export function assertPreferenceRuntimePort(port) {
  if (!port || typeof port !== "object" || port.schema !== PREFERENCE_RUNTIME_SCHEMA) {
    throw new TypeError("A compatible preference-runtime port is required");
  }
  if (
    typeof port.getSnapshot !== "function" ||
    typeof port.set !== "function" ||
    typeof port.subscribe !== "function"
  ) {
    throw new TypeError("Preference-runtime port must implement getSnapshot(), set() and subscribe()");
  }
  if (port.setManyConfirmed !== undefined && typeof port.setManyConfirmed !== "function") {
    throw new TypeError("Preference-runtime setManyConfirmed must be a function when present");
  }
  validatePreferenceRecord(port.getSnapshot());
  return port;
}
