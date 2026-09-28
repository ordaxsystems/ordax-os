import { COMPONENT_RUNTIME_SCHEMA } from "../../contracts/component-runtime.mjs";
import { getDefaultIntelligenceContextSharingRuntime } from "../../services/intelligence/context-sharing-runtime.mjs";
import { PROJECTS_VERSION } from "./version.mjs";
import { probeProjectsDeviceAgent } from "./device-agent-status.mjs";
import { mountProjectsDeviceAgentStatus } from "./ui/device-agent-status.mjs";
import { mountProjectsWorkspaceControls } from "./ui/workspace-controls.mjs";

const PROJECTS_STYLESHEET_URL = new URL("./projects.css", import.meta.url).href;
const PROJECTS_STYLE_SELECTOR = 'link[data-ordax-component-style="projects"]';

async function mountProjectsStyles(root) {
  const documentObject = root?.ownerDocument;
  if (!documentObject?.head) {
    throw new TypeError("Projects runtime requires a document head for component styles");
  }

  const existing = documentObject.querySelector(PROJECTS_STYLE_SELECTOR);
  if (existing) {
    if (existing.href !== PROJECTS_STYLESHEET_URL) {
      throw new TypeError("Projects component stylesheet identity mismatch");
    }
    return () => {};
  }

  const link = documentObject.createElement("link");
  link.rel = "stylesheet";
  link.href = PROJECTS_STYLESHEET_URL;
  link.dataset.ordaxComponentStyle = "projects";

  const loaded = new Promise((resolve, reject) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener(
      "error",
      () => reject(new Error("Projects component stylesheet failed to load")),
      { once: true },
    );
  });

  documentObject.head.append(link);
  try {
    await loaded;
  } catch (error) {
    link.remove();
    throw error;
  }
  return () => link.remove();
}

export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "projects",
  version: PROJECTS_VERSION,
  async mount({
    root,
    surfaceLifecycle,
    projects = null,
    projectCloudLinks = null,
    projectWebReferences = null,
    projectEvidence = null,
    appActivation = null,
    intelligenceContextShare = null,
    deviceAgentCapabilities = null,
  } = {}) {
    const releaseStyles = await mountProjectsStyles(root);
    let controls = null;
    let deviceAgentControls = null;

    try {
      const deviceAgentStatus = await probeProjectsDeviceAgent(deviceAgentCapabilities);
      const contextShare = intelligenceContextShare
        ?? getDefaultIntelligenceContextSharingRuntime().share;
      controls = mountProjectsWorkspaceControls(root, {
        surfaceLifecycle,
        projects,
        projectCloudLinks,
        projectWebReferences,
        projectEvidence,
        appActivation,
        intelligenceContextShare: contextShare,
      });
      if (deviceAgentStatus !== null) {
        deviceAgentControls = mountProjectsDeviceAgentStatus(
          root,
          deviceAgentStatus,
          surfaceLifecycle,
        );
      }

      let destroyed = false;
      return Object.freeze({
        deviceAgentStatus,
        destroy() {
          if (destroyed) return;
          destroyed = true;
          deviceAgentControls?.destroy();
          controls?.destroy();
          releaseStyles();
        },
      });
    } catch (error) {
      deviceAgentControls?.destroy();
      controls?.destroy();
      releaseStyles();
      throw error;
    }
  },
});
