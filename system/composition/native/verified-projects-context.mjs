import {
  PROJECT_CATALOG_SCHEMA,
  assertProjectCatalogReader,
  validateProjectCatalogSnapshot,
} from "../../contracts/project-catalog.mjs";
import {
  PROJECT_CLOUD_LINKS_READER_SCHEMA,
  assertProjectCloudLinksReaderPort,
  validateProjectCloudLinksSnapshot,
} from "../../contracts/project-cloud-links-reader.mjs";

function readOnlyProjectCatalog(portValue) {
  if (portValue === null) return null;
  const port = assertProjectCatalogReader(portValue);
  // The OS service also owns mutations. Never expose the original port to an app.
  return Object.freeze({
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot() {
      return validateProjectCatalogSnapshot(port.getSnapshot());
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Projects reader listener is required");
      return port.subscribe((snapshot) => listener(validateProjectCatalogSnapshot(snapshot)));
    },
  });
}

function readOnlyCloudLinks(portValue) {
  if (portValue === null) return null;
  const port = assertProjectCloudLinksReaderPort(portValue);
  return Object.freeze({
    schema: PROJECT_CLOUD_LINKS_READER_SCHEMA,
    getSnapshot() {
      return validateProjectCloudLinksSnapshot(port.getSnapshot());
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Project links reader listener is required");
      return port.subscribe((snapshot) => listener(validateProjectCloudLinksSnapshot(snapshot)));
    },
  });
}

/**
 * Native-owned trusted binding for one signed-slot app. Context never grants
 * project mutations, filesystem access or arbitrary host capabilities.
 */
export function createVerifiedProjectsContextProvider({
  projects = null,
  projectCloudLinks = null,
} = {}) {
  const catalogReader = readOnlyProjectCatalog(projects);
  const cloudReader = readOnlyCloudLinks(projectCloudLinks);
  const context = Object.freeze({
    projects: catalogReader,
    projectCloudLinks: cloudReader,
  });
  return (componentId) => componentId === "projects" ? context : null;
}
