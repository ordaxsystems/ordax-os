import {
  validateProjectCloudLinksSnapshot,
} from "./project-cloud-links-data.mjs";
import {
  assertProjectCloudLinksPort,
} from "./project-cloud-links.mjs";

export {
  validateProjectCloudLinksSnapshot,
} from "./project-cloud-links-data.mjs";

export const PROJECT_CLOUD_LINKS_READER_SCHEMA = "ordax.project-cloud-links-reader/1";

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
