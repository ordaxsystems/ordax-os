// OS workspace capabilities for an externally verified component, never bundled Files UI.
import { assertDeviceLocalFileSpacePort } from "../../contracts/file-space.mjs";
import { assertRecentFilesPort } from "../../contracts/recent-files.mjs";
import { assertProjectCatalogPort } from "../../contracts/project-catalog.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { getFirstPartyApp } from "../../apps/catalog.mjs";
import { hasNativeExternalFirstPartyModuleRead } from "../../services/apps/external-first-party-policy.mjs";
import { installTrustedComponentContextProvider } from "../../services/components/runtime-loader.mjs";
import { createVerifiedSlotHostContextProvider } from "../../services/components/verified-host-context.mjs";
import { createNativePendingComponentHostBootstrap } from "./component-pending-host.mjs";

// The ID identifies the package allowed by the canonical Native policy.
const WORKSPACE_COMPONENT_ID = "files";
export function createNativeWorkspaceHostPorts({fileSpace=null,recentFiles=null,projects=null,appActivation=null}={}) {
  return Object.freeze({
    fileSpace:assertDeviceLocalFileSpacePort(fileSpace),
    recentFiles:assertRecentFilesPort(recentFiles),
    projects:assertProjectCatalogPort(projects),
    appActivation:assertAppActivationPort(appActivation),
  });
}
export function createNativeWorkspacePendingBootstrap({installProvider}={}) {
  if (!hasNativeExternalFirstPartyModuleRead(WORKSPACE_COMPONENT_ID)||getFirstPartyApp(WORKSPACE_COMPONENT_ID)) return null;
  return createNativePendingComponentHostBootstrap({
    componentId:WORKSPACE_COMPONENT_ID,createPorts:createNativeWorkspaceHostPorts,
    ...(installProvider?{installProvider}:{})
  });
}
export function installNativeWorkspaceVerifiedContext({
  installed=[],fileSpace=null,recentFiles=null,projects=null,appActivation=null,
  installProvider=installTrustedComponentContextProvider,
}={}) {
  if (!hasNativeExternalFirstPartyModuleRead(WORKSPACE_COMPONENT_ID)||getFirstPartyApp(WORKSPACE_COMPONENT_ID)) return false;
  if (!Array.isArray(installed)||typeof installProvider!=="function") throw new TypeError("Invalid verified workspace catalog");
  const verifiedCurrent=installed.find(entry=>entry.component.id===WORKSPACE_COMPONENT_ID)?.metadata??null;
  installProvider(createVerifiedSlotHostContextProvider({
    componentId:WORKSPACE_COMPONENT_ID,verifiedCurrent,
    createPorts:()=>createNativeWorkspaceHostPorts({fileSpace,recentFiles,projects,appActivation}),
  }));
  return true;
}
