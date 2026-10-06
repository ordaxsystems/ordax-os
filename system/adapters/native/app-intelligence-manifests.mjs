import {
  APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
  validateAppIntelligenceCatalogSnapshot,
} from "../../contracts/app-intelligence-catalog.mjs";

export const NATIVE_APP_INTELLIGENCE_SOURCE_SCHEMA =
  "ordax.native-app-intelligence-manifest-source/1";
export const NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA =
  "ordax.native-app-intelligence-manifests/1";

const ENDPOINT = "/__ordax/native/app-intelligence-catalog";

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} fields are not canonical`);
  }
}

export async function createNativeAppIntelligenceManifestSource(
  windowRef = globalThis.window,
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native app intelligence source requires window.fetch");
  }

  let disposed = false;
  let manifests = Object.freeze([]);

  const refresh = async () => {
    if (disposed) throw new Error("Native app intelligence source is disposed");
    const response = await windowRef.fetch(ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Native app intelligence catalog unavailable: ${response.status}`);
    }
    const payload = await response.json();
    exactKeys(payload, ["schema", "manifests"], "Native app intelligence catalog");
    if (payload.schema !== NATIVE_APP_INTELLIGENCE_MANIFESTS_SCHEMA) {
      throw new TypeError("Native app intelligence catalog schema is incompatible");
    }

    const snapshot = validateAppIntelligenceCatalogSnapshot({
      schema: APP_INTELLIGENCE_CATALOG_SNAPSHOT_SCHEMA,
      revision: 0,
      manifests: payload.manifests,
      authority: "none",
      execution: "declarative-only",
    });
    manifests = snapshot.manifests;
    return manifests;
  };

  await refresh();

  return Object.freeze({
    schema: NATIVE_APP_INTELLIGENCE_SOURCE_SCHEMA,
    getManifests() {
      return manifests;
    },
    refresh,
    dispose() {
      disposed = true;
      manifests = Object.freeze([]);
    },
  });
}
