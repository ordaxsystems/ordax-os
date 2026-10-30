import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { validateComponentCompatibility } from "../../contracts/component-update-compatibility.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";

const SCHEMA = "ordax.native-verified-current-compatibility/1";
const MAX_BYTES = 64 * 1024;
const DEADLINE = 4000;

// No new signing, trust policy or app-ID registry. The Native host Go verifier
// obtains the signed release/2 sidecar from the exact active current slot.
// The verified OS policy, not page code, selects the public trust anchor.
export function createNativeSignedCurrentCompatibilityResolver({ source, fetchImpl } = {}) {
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") throw TypeError("Native compatibility requires a fetch port");

  return async function signedCurrentCompatibility(rawCurrent) {
    const current = validateComponentRuntimeMetadata(rawCurrent, {
      componentId: rawCurrent?.componentId, state: "current",
    });
    if (current.source !== "slot" || current.revision < 1)
      throw TypeError("Signed compatibility requires a positive current slot revision");

    const metadata = new URL(packageSource.metadataUrl(current.componentId, "current"));
    if (metadata.protocol !== "http:" || metadata.hostname !== "127.0.0.1"
      || !metadata.port || metadata.username || metadata.password || metadata.hash
      || metadata.pathname !== "/__ordax/native/component-runtime"
      || [...metadata.searchParams.keys()].sort().join(",") !== "component,state"
      || metadata.searchParams.get("component") !== current.componentId
      || metadata.searchParams.get("state") !== "current") {
      throw TypeError("Signed compatibility is restricted to the canonical Native origin");
    }
    metadata.pathname = "/__ordax/native/component-compatibility";
    metadata.searchParams.set("revision", String(current.revision));
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), DEADLINE);
    try {
      const response = await fetchImpl(metadata.href, {
        method: "GET", cache: "no-store", credentials: "same-origin",
        redirect: "error", signal: controller.signal,
      });
      if (response?.ok !== true || typeof response.text !== "function")
        throw Error("Signed current compatibility is unavailable");
      const raw = await response.text();
      if (raw.length < 1 || raw.length > MAX_BYTES) throw Error("Compatibility exceeds size bound");
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || Object.keys(payload).sort().join(",")
          !== "componentId,descriptor,revision,schema,sourceCommit,state,version"
        || payload.schema !== SCHEMA || payload.componentId !== current.componentId
        || payload.state !== "current" || payload.revision !== current.revision
        || payload.version !== current.version || payload.sourceCommit !== current.sourceCommit)
        throw TypeError("Signed compatibility changed current slot identity");
      const descriptor = validateComponentCompatibility(payload.descriptor);
      if (descriptor.componentId !== current.componentId
        || descriptor.componentVersion !== current.version)
        throw TypeError("Signed compatibility descriptor does not match current component");
      // The state descriptor is for persistent migration ownership; the
      // required contracts independently determine whether App Data is needed.
      // If a state owner exists with no App Data requirement, conservatively
      // require a bound App Data port instead of inventing another state host.
      return descriptor;
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
  };
}
