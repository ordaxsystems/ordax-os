import { DESKTOP_RECOVERY_SCHEMA, validateDesktopRecoverySnapshot } from "../../contracts/desktop-recovery.mjs";

const ENDPOINT = "/__ordax/desktop/recovery";

export async function createDesktopRecoveryStatus(windowRef = globalThis.window) {
  // The privileged Electron preload exists only in the Windows Desktop shell.
  // Do not turn Web or Linux Native sessions into pretend Windows recoveries.
  if (!windowRef || typeof windowRef.fetch !== "function" ||
      typeof windowRef.ordaxDesktopBrowser?.postMessage !== "function") {
    throw new TypeError("Windows Desktop host bridge is not available");
  }
  const port = Object.freeze({
    schema: DESKTOP_RECOVERY_SCHEMA,
    async read() {
      const response = await windowRef.fetch(ENDPOINT, {
        method: "GET", cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error("Windows Desktop recovery observation failed: " + response.status);
      }
      return validateDesktopRecoverySnapshot(await response.json());
    },
  });
  await port.read();
  return port;
}
