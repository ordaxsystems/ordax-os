import {
  RECOVERY_STATUS_SCHEMA,
  assertRecoveryStatusPort,
  validateRecoveryStatusSnapshot,
} from "../../contracts/recovery-status.mjs";

import { createNativeBootProbeReader } from "./boot-probe-reader.mjs";

const RECOVERY_STATUS_ENDPOINT = "/__ordax/native/recovery-status";

export async function createNativeRecoveryStatus(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native recovery status adapter requires window.fetch");
  }

  const port = {
    schema: RECOVERY_STATUS_SCHEMA,
    read: createNativeBootProbeReader(async () => {
      const response = await windowRef.fetch(RECOVERY_STATUS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const error = new Error(`Native recovery status request failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return validateRecoveryStatusSnapshot(await response.json());
    }),
  };

  assertRecoveryStatusPort(port);
  await port.read();
  return Object.freeze(port);
}
