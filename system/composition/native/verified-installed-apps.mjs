import { listFirstPartyApps } from "../../apps/catalog.mjs";
import { createAppRuntimeCatalog } from "../../apps/runtime-catalog.mjs";
import { defineExternalFirstPartyApp } from "../../apps/external-app-definition.mjs";
import { loadVerifiedCurrentComponentRuntime } from "../../services/components/current-slot-loader.mjs";
import {
  EXTERNAL_FIRST_PARTY_OWNER,
  hasNativeExternalFirstPartyModuleRead,
} from "../../services/apps/external-first-party-policy.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

/**
 * Native only: verified 'current' slot discovery is the SSOT. A built-in
 * app always wins collisions while its source still belongs to the OS.
 */
export function createNativeVerifiedInstalledAppCatalog(
  verifiedEntries, { builtIns = listFirstPartyApps() } = {},
) {
  if (!Array.isArray(verifiedEntries) || !Array.isArray(builtIns)) {
    throw new TypeError("Installed app catalog requires verified entries and built-ins");
  }
  const bundledIds = new Set(builtIns.map((app) => app.id));
  const installed = [];
  for (const entry of verifiedEntries) {
    if (!entry || !entry.component || !entry.metadata || !entry.presentation) {
      throw new TypeError("Verified installed app entry is incomplete");
    }
    const id = entry.component.id;
    if (bundledIds.has(id)) continue;
    if (!hasNativeExternalFirstPartyModuleRead(id)
      || entry.metadata.componentId !== id
      || entry.metadata.state !== "current"
      || entry.metadata.source !== "slot"
      || entry.metadata.version !== entry.component.version
      || entry.component.owner !== EXTERNAL_FIRST_PARTY_OWNER) {
      throw new TypeError("Installed app entry is not a canonical verified Native slot");
    }
    installed.push(Object.freeze({
      component: entry.component,
      metadata: entry.metadata,
      app: defineExternalFirstPartyApp(entry.component, entry.presentation),
    }));
  }
  const catalog = createAppRuntimeCatalog({
    builtIns,
    external: installed.map((entry) => entry.app),
  });
  return Object.freeze({
    catalog,
    installed: Object.freeze(installed),
  });
}

// The only caller-owned values allowed across this boundary are the app's
// render root and a narrow Surface lifecycle. Privileged device ports are
// bound exclusively by the trusted Native component context providers.
const EXTERNAL_CONTEXT_KEYS = new Set(["root", "surfaceLifecycle"]);
const EXTERNAL_LIFECYCLE_KEYS = new Set([
  "schema", "localization", "subscribeRender", "getAppTarget", "setAppTarget",
]);

function assertExternalCallerContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(context))
    || Object.getOwnPropertySymbols(context).length !== 0
    || Object.getOwnPropertyNames(context).some((key) => !EXTERNAL_CONTEXT_KEYS.has(key))
    || Object.values(Object.getOwnPropertyDescriptors(context)).some((descriptor) =>
      !Object.prototype.hasOwnProperty.call(descriptor, "value"))) {
    throw new TypeError("Installed app caller context cannot supply privileged ports or accessors");
  }
  if (Object.prototype.hasOwnProperty.call(context, "surfaceLifecycle")) {
    const lifecycle = context.surfaceLifecycle;
    if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(lifecycle))
      || Object.getOwnPropertySymbols(lifecycle).length !== 0
      || Object.getOwnPropertyNames(lifecycle).some((key) =>
        !EXTERNAL_LIFECYCLE_KEYS.has(key))
      || Object.values(Object.getOwnPropertyDescriptors(lifecycle)).some((descriptor) =>
        !Object.prototype.hasOwnProperty.call(descriptor, "value"))) {
      throw new TypeError("Installed app Surface lifecycle must be a minimal projection");
    }
    assertSurfaceRenderLifecycle(lifecycle);
  }
  return Object.freeze({ ...context });
}

/**
 * Executable identity is independently checked again at mount time by the
 * canonical verified current-slot loader; discovery does not grant authority.
 * Trusted ports such as App Data are provided by the OS context broker.
 */
export async function mountNativeVerifiedInstalledApps({
  installed, source, fetchImpl, importModule,
  context, onError = null,
} = {}) {
  if (!Array.isArray(installed)) throw new TypeError("Installed app mounts require an array");
  const narrowContext = assertExternalCallerContext(context);
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Installed app mount error handler must be a function or null");
  }
  const results = await Promise.all(installed.map(async (entry) => {
    const appId = entry.component.id;
    if (!hasNativeExternalFirstPartyModuleRead(appId)) {
      onError?.(new TypeError("App is outside the Native module-read policy"), appId);
      return null;
    }
    try {
      const mounted = await loadVerifiedCurrentComponentRuntime({
        componentId: appId,
        source,
        fetchImpl,
        importModule,
        context: narrowContext,
        requireTrustedAppData: true,
        expectedCurrent: entry.metadata,
        onError(error) { onError?.(error, appId); },
      });
      return mounted === null ? null : Object.freeze({ appId, mounted });
    } catch (error) {
      onError?.(error, appId);
      return null;
    }
  }));
  const mountedIds = Object.freeze(results.filter(Boolean).map((value) => value.appId));
  return Object.freeze({
    destroy() {
      for (const result of results) {
        try { result?.mounted.destroy(); } catch { /* component teardown is isolated */ }
      }
    },
    mountedIds,
    mountedCount: mountedIds.length,
  });
}
