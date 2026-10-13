// Native host-owned Files ports, not a second Files app implementation.
// This provider is installed only after the canonical signed-slot policy
// admits Files AND the bundled Files source has been removed. The canonical
// verified-current loader checks signed slot identity before mount.
import { assertFileSpacePort } from "../../contracts/file-space.mjs";
import { assertRecentFilesPort } from "../../contracts/recent-files.mjs";
import { assertProjectCatalogPort } from "../../contracts/project-catalog.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";

export function createNativeFilesTrustedContextProvider({
  fileSpace = null,
  recentFiles = null,
  projects = null,
  appActivation = null,
} = {}) {
  // Do not access any native capability until the trusted loader requests
  // Files specifically. Missing ports fail the optional component's mount,
  // never grant an unrelated app access or block OS startup.
  return function nativeFilesTrustedContext(componentId) {
    if (componentId !== "files") return null;
    return Object.freeze({
      fileSpace: assertFileSpacePort(fileSpace),
      recentFiles: assertRecentFilesPort(recentFiles),
      projects: assertProjectCatalogPort(projects),
      appActivation: assertAppActivationPort(appActivation),
    });
  };
}
