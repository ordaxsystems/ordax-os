import {
  validateAppIntelligenceManifest,
} from "../../contracts/app-intelligence-manifest.mjs";
import {
  defineComponentManifest,
} from "../../contracts/component-manifest.mjs";

const ENDPOINT = "/__ordax/native/app-intelligence-manifest";
const COMPONENT_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
const SCHEMA = "ordax.native-app-intelligence-manifest/2";

function validateEnvelope(value, componentId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Native app intelligence manifest response must be an object");
  }
  const expected = [
    "$schema",
    "componentId",
    "componentVersion",
    "sourceCommit",
    "revision",
    "component",
    "manifest",
    "authority",
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError("Native app intelligence manifest response fields are not canonical");
  }
  if (value.$schema !== SCHEMA || value.authority !== "none") {
    throw new TypeError("Native app intelligence manifest response boundary is invalid");
  }
  if (value.componentId !== componentId) {
    throw new TypeError("Native app intelligence manifest response component mismatch");
  }
  if (
    !Number.isSafeInteger(value.revision)
    || value.revision < 0
    || typeof value.componentVersion !== "string"
    || typeof value.sourceCommit !== "string"
    || !SHA40_RE.test(value.sourceCommit)
  ) {
    throw new TypeError("Native app intelligence manifest response identity is invalid");
  }
  const component = defineComponentManifest(value.component);
  if (
    component.id !== value.componentId
    || component.version !== value.componentVersion
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== "washingtonmsdj/ordax-apps"
  ) {
    throw new TypeError("Native app intelligence component identity is invalid");
  }
  const manifest = validateAppIntelligenceManifest(value.manifest, {
    appId: value.componentId,
    appVersion: value.componentVersion,
  });
  return Object.freeze({
    componentId: value.componentId,
    componentVersion: value.componentVersion,
    sourceCommit: value.sourceCommit,
    revision: value.revision,
    component,
    manifest,
    authority: "none",
  });
}

export function createNativeAppIntelligenceManifestSource(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native app intelligence manifest source requires window.fetch");
  }

  return Object.freeze({
    async read(componentId) {
      if (typeof componentId !== "string" || !COMPONENT_ID_RE.test(componentId)) {
        throw new TypeError("Native app intelligence manifest component id is invalid");
      }
      const response = await windowRef.fetch(
        `${ENDPOINT}?component=${encodeURIComponent(componentId)}`,
        {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        const error = new Error(
          `Native app intelligence manifest request failed: ${response.status}`,
        );
        error.status = response.status;
        throw error;
      }
      return validateEnvelope(await response.json(), componentId);
    },
  });
}
