import {
  validateProfileContentContextCapability,
} from "../../contracts/profile-content-context-capability.mjs";

const ENDPOINT = "/__ordax/native/profile-content-context-capability";

export async function readNativeProfileContentContextCapability(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Profile content context capability requires window.fetch");
  }
  const response = await windowRef.fetch(ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Profile content context capability unavailable (HTTP ${response.status})`);
  }
  return validateProfileContentContextCapability(await response.json());
}
