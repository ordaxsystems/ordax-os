// Native OS-owned read-only observation; Electron owns the per-launch grant.
// A local process is not proof of a remote attested MCP session.
const ROUTE = "/__ordax/native/product-runtime-status";
const SCHEMA = "ordax.product-runtime-supervisor-status/1";
const STATES = new Set(["blocked", "stopped", "stopping", "running"]);

export function validateDesktopProductRuntimeStatus(raw) {
  if (!raw || typeof raw !== "object" || raw.schema !== SCHEMA ||
      raw.host !== "ordax-desktop" || !STATES.has(raw.state) ||
      typeof raw.reason !== "string" || raw.reason.length > 100 ||
      typeof raw.enrolled !== "boolean" ||
      !(raw.deviceId === null || (typeof raw.deviceId === "string" &&
        /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(raw.deviceId))) ||
      typeof raw.processRunning !== "boolean" ||
      typeof raw.productDispatchReady !== "boolean" ||
      typeof raw.mcpReady !== "boolean" ||
      typeof raw.centralSessionAttested !== "boolean" ||
      !(raw.capabilityDigest === null ||
        (typeof raw.capabilityDigest === "string" &&
          /^[a-f0-9]{64}$/.test(raw.capabilityDigest))))
    throw new Error("Invalid Product Runtime observation");
  if (raw.processRunning !== (raw.state === "running" || raw.state === "stopping"))
    throw new Error("Inconsistent Product Runtime process state");
  // The legacy fields are intentionally pinned false: local Runtime
  // readiness is never a proof of the persistent Platform conversation binding
  // or a client grant. New code consumes productDispatchReady explicitly.
  if (raw.mcpReady !== false || raw.centralSessionAttested !== false)
    throw new Error("Local Product readiness cannot attest a client session");
  if (raw.productDispatchReady && (
      raw.state !== "running" || !raw.enrolled || raw.deviceId === null ||
      typeof raw.capabilityDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.capabilityDigest)))
    throw new Error("Product dispatch readiness requires live Runtime capabilities");
  return Object.freeze({
    schema: SCHEMA, host: "ordax-desktop",
    state: raw.state, reason: raw.reason, enrolled: raw.enrolled,
    deviceId: raw.deviceId,
    processRunning: raw.processRunning,
    productDispatchReady: raw.productDispatchReady,
    // Compatibility only; never reinterpret these as Runtime readiness.
    mcpReady: false, centralSessionAttested: false,
    capabilityDigest: raw.capabilityDigest,
  });
}

export function createNativeDesktopProductRuntimeStatus(windowRef) {
  if (typeof windowRef?.fetch !== "function")
    throw new TypeError("Native Desktop transport required");
  return Object.freeze({
    async read() {
      const response = await windowRef.fetch(ROUTE, {
        method: "GET", credentials: "same-origin", cache: "no-store",
      });
      if (response.status !== 200 ||
          !String(response.headers?.get?.("content-type") ?? "")
            .toLowerCase().includes("application/json"))
        throw new Error("Native Product Runtime observation unavailable");
      return validateDesktopProductRuntimeStatus(await response.json());
    },
  });
}
