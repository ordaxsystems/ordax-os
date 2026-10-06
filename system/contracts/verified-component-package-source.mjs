import {
  validateComponentPackagePath,
  validateComponentSlotResolution,
  validateComponentSlotState,
} from "./component-slot-source.mjs";
import { validateComponentId } from "./component-manifest.mjs";

export const VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA = "ordax.verified-component-package-source/1";

const FORBIDDEN_AUTHORITY_METHODS = [
  "execute",
  "invoke",
  "run",
  "install",
  "uninstall",
  "promote",
  "rollback",
  "writeFile",
];

export function assertVerifiedComponentPackageSource(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA
  ) {
    throw new TypeError("A compatible verified component package source is required");
  }
  for (const method of ["metadataUrl", "fileUrl"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Verified component package source must implement ${method}()`);
    }
  }
  for (const method of FORBIDDEN_AUTHORITY_METHODS) {
    if (typeof port[method] === "function") {
      throw new TypeError(`Verified component package source must not expose ${method}()`);
    }
  }
  return port;
}

export function validateVerifiedComponentPackageFileRequest({
  componentId,
  state,
  resolution,
  path,
} = {}) {
  const id = validateComponentId(componentId);
  const slotState = validateComponentSlotState(state);
  const slot = validateComponentSlotResolution(resolution);
  if (slot.componentId !== id || slot.state !== slotState) {
    throw new TypeError("Verified component package file request identity mismatch");
  }
  return Object.freeze({
    componentId: id,
    state: slotState,
    resolution: slot,
    path: validateComponentPackagePath(path),
  });
}
