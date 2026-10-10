import { listFirstPartyApps } from "../../apps/catalog.mjs";
import { createAppRuntimeCatalog } from "../../apps/runtime-catalog.mjs";
import { defineExternalFirstPartyApp } from "../../apps/external-app-definition.mjs";
import { loadVerifiedCurrentComponentRuntime } from "../../services/components/current-slot-loader.mjs";
import { hasNativeExternalFirstPartyModuleRead } from "../../services/apps/external-first-party-policy.mjs";

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
      || entry.component.owner !== "ordaxsystems/ordax-apps") {
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
  if (onError !== null && typeof onError !== "function") {
    throw new TypeError("Installed app mount error handler must be a function or null");
  }
  const mounts = await Promise.all(installed.map(async (entry) => {
    const mounted = await loadVerifiedCurrentComponentRuntime({
      componentId: entry.component.id,
      source,
      fetchImpl,
      importModule,
      context,
      onError(error) { onError?.(error, entry.component.id); },
    });
    return mounted;
  }));
  return Object.freeze({
    destroy() {
      for (const mounted of mounts) {
        try { mounted?.destroy(); } catch { /* component teardown is isolated */ }
      }
    },
    mountedCount: mounts.filter(Boolean).length,
  });
}
