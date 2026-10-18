/**
 * Optional Native composition for signed, installed apps.
 *
 * Host-owned resolvers must be backed by the trusted Native slot/installation
 * record and the OS permissions authority. Never register this provider with
 * a renderer-supplied identity, manifest, grants, or a Studio API. The normal
 * current-slot loader invokes context providers only from privileged bootstrap.
 *
 * Absence of a verified installation contributes no capability port. The
 * injected reader exposes discovery only, never grant/dispatch/credentials.
 */
import { assertDeviceAgentCapabilityReaderPort } from "../../contracts/device-capabilities.mjs";
import { createInstalledAppCapabilityReader } from "../../services/device-agent/installed-app-capability-reader.mjs";

export function createNativeInstalledAppCapabilityContextProvider({
  resolveCurrentInstalledApp,
  readAllowedCapabilities,
  capabilityReader,
} = {}) {
  if (typeof resolveCurrentInstalledApp !== "function"
      || typeof readAllowedCapabilities !== "function") {
    throw new TypeError("Native app capability context requires trusted host resolvers");
  }
  const deviceReader = assertDeviceAgentCapabilityReaderPort(capabilityReader);
  return async function nativeInstalledAppCapabilityContext(componentId) {
    if (typeof componentId !== "string" || !componentId) {
      throw new TypeError("Native app capability context requires a component ID");
    }
    // The resolver is the OS-private signed-slot/provenance authority.
    // An app name, catalogue entry or model string is never sufficient proof.
    const installed = await resolveCurrentInstalledApp(componentId);
    if (installed === null) return null;
    // Treat even a host resolver result as inert data. No getters or
    // renderer-controlled objects may run while validating mount identity.
    if (!installed || typeof installed !== "object" || Array.isArray(installed)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(installed))
        || Reflect.ownKeys(installed).length !== 7
        || ["appId", "publisherId", "packageSha256", "accountId",
            "spaceId", "deviceId", "verified"].some(key =>
          !Object.hasOwn(installed, key)
          || !Object.hasOwn(Object.getOwnPropertyDescriptor(installed, key), "value"))
        || installed.verified !== true || installed.appId !== componentId) {
      throw new TypeError("Native app capability identity is not a verified current slot");
    }
    const reader = createInstalledAppCapabilityReader({
      // Resolve again on *every* read. A mount-time snapshot is never enough
      // after uninstall, account/Space switch, package update or revocation.
      resolveCaller: () => resolveCurrentInstalledApp(componentId),
      readAllowedCapabilities,
      capabilityReader: deviceReader,
    });
    return Object.freeze({ capabilityReader: reader });
  };
}
