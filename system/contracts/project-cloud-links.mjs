import {
  MAX_PROJECTS,
  validateProjectId,
} from "./project-catalog.mjs";

export const PROJECT_CLOUD_LINKS_SCHEMA = "ordax.project-cloud-links/1";
export const PROJECT_CLOUD_LINKS_READER_SCHEMA = "ordax.project-cloud-links-reader/1";
export const MAX_PROJECT_CLOUD_LINKS = MAX_PROJECTS;

const PERSISTENCE_SCOPES = new Set(["device", "session"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUuid(value, label) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new TypeError(`${label} must be a UUID`);
  }
  return value.toLowerCase();
}

function validateTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Project cloud link linkedAt must be a non-negative epoch millisecond");
  }
  return value;
}

export function validateCloudProjectId(value) {
  return validateUuid(value, "Cloud project id");
}

export function validateCloudSpaceId(value) {
  return validateUuid(value, "Cloud space id");
}

export function validateProjectCloudLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project cloud link must be an object");
  }
  return Object.freeze({
    localProjectId: validateProjectId(value.localProjectId),
    cloudProjectId: validateCloudProjectId(value.cloudProjectId),
    spaceId: validateCloudSpaceId(value.spaceId),
    linkedAt: validateTimestamp(value.linkedAt),
  });
}

export function validateProjectCloudLinkEntries(value) {
  if (!Array.isArray(value) || value.length > MAX_PROJECT_CLOUD_LINKS) {
    throw new TypeError(
      `Project cloud links must contain at most ${MAX_PROJECT_CLOUD_LINKS} entries`,
    );
  }
  const links = value.map(validateProjectCloudLink);
  if (new Set(links.map((link) => link.localProjectId)).size !== links.length) {
    throw new TypeError("Each local project may have only one cloud link");
  }
  if (new Set(links.map((link) => link.cloudProjectId)).size !== links.length) {
    throw new TypeError("Each cloud project may be linked only once per device catalog");
  }
  return Object.freeze(links);
}

export function validateProjectCloudLinksSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project cloud links snapshot must be an object");
  }
  if (!PERSISTENCE_SCOPES.has(value.persistence)) {
    throw new TypeError("Project cloud links persistence must be device or session");
  }
  return Object.freeze({
    schema: PROJECT_CLOUD_LINKS_SCHEMA,
    persistence: value.persistence,
    links: validateProjectCloudLinkEntries(value.links),
  });
}

export function assertProjectCloudLinksPort(port) {
  if (!port || typeof port !== "object" || port.schema !== PROJECT_CLOUD_LINKS_SCHEMA) {
    throw new TypeError("A compatible project-cloud-links port is required");
  }
  for (const method of ["getSnapshot", "subscribe", "link", "unlink", "destroy"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Project cloud links port must implement ${method}()`);
    }
  }
  validateProjectCloudLinksSnapshot(port.getSnapshot());
  return port;
}

export function assertProjectCloudLinksReaderPort(port) {
  if (
    !port
    || typeof port !== "object"
    || port.schema !== PROJECT_CLOUD_LINKS_READER_SCHEMA
  ) {
    throw new TypeError("A compatible project-cloud-links reader is required");
  }
  for (const method of ["getSnapshot", "subscribe"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Project cloud links reader must implement ${method}()`);
    }
  }
  for (const forbidden of ["link", "unlink", "destroy"]) {
    if (forbidden in port) {
      throw new TypeError("Project cloud links reader must not expose mutation authority");
    }
  }
  validateProjectCloudLinksSnapshot(port.getSnapshot());
  return port;
}

export function createProjectCloudLinksReader(portValue) {
  const port = assertProjectCloudLinksPort(portValue);
  return Object.freeze({
    schema: PROJECT_CLOUD_LINKS_READER_SCHEMA,
    getSnapshot() {
      return port.getSnapshot();
    },
    subscribe(listener) {
      return port.subscribe(listener);
    },
  });
}
