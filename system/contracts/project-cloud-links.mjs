import {
  PROJECT_CLOUD_LINKS_SCHEMA,
  validateProjectCloudLinksSnapshot,
} from "./project-cloud-links-data.mjs";

export {
  MAX_PROJECT_CLOUD_LINKS,
  PROJECT_CLOUD_LINKS_SCHEMA,
  validateCloudProjectId,
  validateCloudSpaceId,
  validateProjectCloudLink,
  validateProjectCloudLinkEntries,
  validateProjectCloudLinksSnapshot,
} from "./project-cloud-links-data.mjs";

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
