// Native host-owned Files ports, not a second Files app implementation.
// This provider is installed only after the canonical signed-slot policy
// admits Files AND the bundled Files source has been removed. The canonical
// verified-current loader checks signed slot identity before mount.
import { assertFileSpacePort } from "../../contracts/file-space.mjs";
import { assertRecentFilesPort } from "../../contracts/recent-files.mjs";
import { assertProjectCatalogPort } from "../../contracts/project-catalog.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";

export function createNativeFilesTrustedContextProvider({
  fileSpace = null,
  recentFiles = null,
  projects = null,
  appActivation = null,
  verifiedCurrent = null,
} = {}) {
  // The ONLY legitimate provenance for verifiedCurrent is the Native verified
  // installed-app catalog. This provider does not trust a package manifest,
  // unverified Store entry, caller-supplied component ID or synthetic receipt.
  // The canonical current-slot loader independently rechecks this exact
  // identity immediately before and after mount.
  //
  // Files stays bundled today, so Native does not install this provider while
  // the OS still owns its source. A future handoff must not expose File Space
  // merely because a caller asks for "files".
  return function nativeFilesTrustedContext(componentId) {
    if (componentId !== "files") return null;
    if (verifiedCurrent === null) {
      throw new TypeError("Files requires a verified current Native slot identity");
    }
    const current = validateComponentRuntimeMetadata(verifiedCurrent, {
      componentId: "files", state: "current",
    });
    if (current.source !== "slot") {
      throw new TypeError("Files host ports require an installed current slot");
    }
    return Object.freeze({
      fileSpace: assertFileSpacePort(fileSpace),
      recentFiles: assertRecentFilesPort(recentFiles),
      projects: assertProjectCatalogPort(projects),
      appActivation: assertAppActivationPort(appActivation),
    });
  };
}
