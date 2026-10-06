import {
  assertProjectCloudLinksPort,
} from "../../contracts/project-cloud-links.mjs";
import {
  PROJECT_CLOUD_LINKS_READER_SCHEMA,
} from "../../contracts/project-cloud-links-reader.mjs";

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
