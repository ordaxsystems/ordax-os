import {
  validateComponentId,
  validateComponentVersion,
} from "./component-manifest.mjs";

export const COMPONENT_SLOT_SOURCE_SCHEMA = "ordax.component-slot-source/1";
export const COMPONENT_SLOT_STATES = Object.freeze(["current", "pending"]);

const SOURCE_COMMIT_RE = /^[0-9a-f]{40}$/;
const SOURCE_REPOSITORY_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const PACKAGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function validateComponentSlotState(value) {
  if (!COMPONENT_SLOT_STATES.includes(value)) {
    throw new TypeError("Component slot state must be current or pending");
  }
  return value;
}

export function validateComponentSlotSourceCommit(value) {
  if (typeof value !== "string" || !SOURCE_COMMIT_RE.test(value)) {
    throw new TypeError("Component slot sourceCommit must be a lowercase 40-hex SHA");
  }
  return value;
}

export function validateComponentSlotSourceRepository(value) {
  if (typeof value !== "string" || !SOURCE_REPOSITORY_RE.test(value)) {
    throw new TypeError("Component slot sourceRepository must be owner/repository");
  }
  return value;
}

export function validateComponentPackagePath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("\0")
    || value.includes("?")
    || value.includes("#")
    || value.includes("%")
  ) {
    throw new TypeError("Component package path is invalid");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === ""
        || segment === "."
        || segment === ".."
        || !PACKAGE_SEGMENT_RE.test(segment),
    )
  ) {
    throw new TypeError("Component package path contains an unsafe segment");
  }
  return value;
}

export function validateComponentSlotResolution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Component slot resolution must be an object");
  }
  if (value.source !== "slot") {
    throw new TypeError("Component slot source can only build URLs for verified slots");
  }
  return Object.freeze({
    componentId: validateComponentId(value.componentId),
    state: validateComponentSlotState(value.state),
    source: "slot",
    sourceRepository: validateComponentSlotSourceRepository(value.sourceRepository),
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0
      ? value.revision
      : (() => { throw new TypeError("Component slot revision is invalid"); })(),
    version: validateComponentVersion(value.version),
    sourceCommit: validateComponentSlotSourceCommit(value.sourceCommit),
    entrypoint: validateComponentPackagePath(value.entrypoint),
    pendingHealth: value.state === "pending"
      ? (
        ["unknown", "healthy", "failed"].includes(value.pendingHealth)
          ? value.pendingHealth
          : (() => { throw new TypeError("Component pending health is invalid"); })()
      )
      : null,
  });
}

export function assertComponentSlotSource(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== COMPONENT_SLOT_SOURCE_SCHEMA
  ) {
    throw new TypeError("A compatible component slot source is required");
  }
  for (const method of ["metadataUrl", "runtimeUrl"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Component slot source must implement ${method}()`);
    }
  }
  return port;
}
