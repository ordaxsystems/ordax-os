import {
  VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
  assertVerifiedComponentPackageSource,
  validateVerifiedComponentPackageFileRequest,
} from "../../contracts/verified-component-package-source.mjs";
import {
  validateComponentId,
} from "../../contracts/component-manifest.mjs";
import {
  validateComponentSlotState,
} from "../../contracts/component-slot-source.mjs";
import { nativeComponentSurfaceOrigin } from "./component-slot-origin.mjs";

const COMPONENT_METADATA_PATH = "/__ordax/native/component-runtime";
const COMPONENT_MODULE_PREFIX = "/__ordax/native/component-module/";

export function createNativeVerifiedComponentPackageSource(windowRef = globalThis.window) {
  const origin = nativeComponentSurfaceOrigin(windowRef);
  const source = {
    schema: VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
    metadataUrl(componentIdValue, stateValue) {
      const componentId = validateComponentId(componentIdValue);
      const state = validateComponentSlotState(stateValue);
      const url = new URL(COMPONENT_METADATA_PATH, `${origin}/`);
      url.searchParams.set("component", componentId);
      url.searchParams.set("state", state);
      if (url.origin !== origin) {
        throw new TypeError("Verified component metadata URL escaped the Surface origin");
      }
      return url.href;
    },
    fileUrl(requestValue) {
      const request = validateVerifiedComponentPackageFileRequest(requestValue);
      const path =
        `${COMPONENT_MODULE_PREFIX}${request.componentId}/`
        + `${request.state}/${request.resolution.version}/${request.resolution.sourceCommit}/`
        + request.path;
      const url = new URL(path, `${origin}/`);
      if (url.origin !== origin || url.pathname !== path) {
        throw new TypeError("Verified component file URL escaped the verified namespace");
      }
      return url.href;
    },
  };
  return Object.freeze(assertVerifiedComponentPackageSource(source));
}
