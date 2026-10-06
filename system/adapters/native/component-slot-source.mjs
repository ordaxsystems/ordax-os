import { nativeComponentSurfaceOrigin } from "./component-slot-origin.mjs";
import { validateComponentId } from "../../contracts/component-manifest.mjs";
import {
  COMPONENT_SLOT_SOURCE_SCHEMA,
  assertComponentSlotSource,
  validateComponentSlotResolution,
  validateComponentSlotState,
} from "../../contracts/component-slot-source.mjs";

const COMPONENT_METADATA_PATH = "/__ordax/native/component-runtime";
const COMPONENT_MODULE_PREFIX = "/__ordax/native/component-module/";

export function createNativeComponentSlotSource(windowRef = globalThis.window) {
  const origin = nativeComponentSurfaceOrigin(windowRef);
  const source = {
    schema: COMPONENT_SLOT_SOURCE_SCHEMA,
    metadataUrl(componentIdValue, stateValue) {
      const componentId = validateComponentId(componentIdValue);
      const state = validateComponentSlotState(stateValue);
      const url = new URL(COMPONENT_METADATA_PATH, `${origin}/`);
      url.searchParams.set("component", componentId);
      url.searchParams.set("state", state);
      if (url.origin !== origin) {
        throw new TypeError("Native component metadata URL escaped the Surface origin");
      }
      return url.href;
    },
    runtimeUrl(resolutionValue) {
      const resolution = validateComponentSlotResolution(resolutionValue);
      const path =
        `${COMPONENT_MODULE_PREFIX}${resolution.componentId}/`
        + `${resolution.state}/${resolution.version}/${resolution.sourceCommit}/`
        + resolution.entrypoint;
      const url = new URL(path, `${origin}/`);
      if (url.origin !== origin || url.pathname !== path) {
        throw new TypeError("Native component runtime URL escaped the verified namespace");
      }
      return url.href;
    },
  };
  return Object.freeze(assertComponentSlotSource(source));
}
