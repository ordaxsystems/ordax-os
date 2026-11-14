import {
  PROJECT_BINDING_REVIEW_SCHEMA,
  PROJECT_BINDING_REVIEW_SNAPSHOT_SCHEMA,
  validateProjectBindingReviewSnapshot,
} from "../../contracts/project-binding-review.mjs";
import { assertProjectCatalogReader, validateProjectId } from "../../contracts/project-catalog.mjs";
import {
  assertProjectCloudLinksPort,
  validateCloudProjectId,
} from "../../contracts/project-cloud-links.mjs";
import { createWebJsonReader } from "../../adapters/web/json-read.mjs";

const ONBOARDING_SCHEMA = "ordax.owner-project-onboarding-view/1";
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

function snapshot(state, deviceId = null, localProjects = null, cloudProjects = null) {
  return validateProjectBindingReviewSnapshot({
    schema: PROJECT_BINDING_REVIEW_SNAPSHOT_SCHEMA,
    state,
    deviceId,
    localProjects,
    cloudProjects,
  });
}

function normalizeOnboarding(value, deviceId) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema !== ONBOARDING_SCHEMA || value.device_id !== deviceId
      || !Array.isArray(value.projects) || value.projects.length > 512) {
    throw new TypeError("Owner Project onboarding response is invalid");
  }
  return value.projects.map((project) => {
    if (!project || typeof project !== "object" || Array.isArray(project)
        || typeof project.project_id !== "string" || !UUID.test(project.project_id)
        || typeof project.space_id !== "string" || !UUID.test(project.space_id)
        || typeof project.name !== "string" || project.name.trim().length < 1
        || project.name.length > 120 || typeof project.project_device_bound !== "boolean"
        || typeof project.next_state !== "string"
        || !(project.repository_full_name === null
          || (typeof project.repository_full_name === "string"
            && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(project.repository_full_name)))) {
      throw new TypeError("Owner Project onboarding entry is invalid");
    }
    return Object.freeze({
      cloudProjectId: project.project_id,
      spaceId: project.space_id,
      name: project.name.trim(),
      repositoryFullName: project.repository_full_name,
      nextState: project.next_state,
      projectDeviceBound: project.project_device_bound,
    });
  });
}

export function createProjectBindingReviewRuntime({
  windowRef = globalThis.window,
  productRuntimeStatus,
  projects,
  projectCloudLinks,
} = {}) {
  if (!productRuntimeStatus || typeof productRuntimeStatus.read !== "function") {
    throw new TypeError("Project binding review requires Product Runtime status");
  }
  const projectCatalog = assertProjectCatalogReader(projects);
  const cloudLinks = assertProjectCloudLinksPort(projectCloudLinks);
  const reader = createWebJsonReader(windowRef);
  const listeners = new Set();
  let current = snapshot("idle");
  let refreshOrdinal = 0;
  let disposed = false;

  const publish = (next) => {
    current = next;
    if (!disposed) for (const listener of [...listeners]) listener(current);
  };

  const rebuildReady = (deviceId, remote) => {
    const localProjects = projectCatalog.getSnapshot().projects
      .map(({id, name}) => Object.freeze({id, name}));
    const links = cloudLinks.getSnapshot();
    if (links.persistence !== "device") {
      publish(snapshot("unavailable", deviceId));
      return current;
    }
    const byCloud = new Map(links.links.map((link) => [link.cloudProjectId, link]));
    const cloudProjects = remote.map((project) => Object.freeze({
      ...project,
      linkedLocalProjectId: byCloud.get(project.cloudProjectId)?.localProjectId ?? null,
    }));
    publish(snapshot("ready", deviceId, localProjects, cloudProjects));
    return current;
  };

  const refresh = async () => {
    if (disposed) throw new Error("Project binding review is disposed");
    const ordinal = ++refreshOrdinal;
    publish(snapshot("loading"));
    try {
      const status = await productRuntimeStatus.read();
      if (ordinal !== refreshOrdinal || disposed) return current;
      const deviceId = status?.deviceId ?? null;
      if (status?.enrolled !== true || typeof deviceId !== "string" || !UUID.test(deviceId)) {
        publish(snapshot("unavailable"));
        return current;
      }
      const response = await reader.read(`/account/mcp/project-onboarding?device_id=${encodeURIComponent(deviceId)}`);
      if (ordinal !== refreshOrdinal || disposed) return current;
      if (response.status === 401 || response.status === 403) {
        publish(snapshot("unavailable", deviceId));
        return current;
      }
      if (!response.ok) {
        publish(snapshot("error", deviceId));
        return current;
      }
      return rebuildReady(deviceId, normalizeOnboarding(response.value, deviceId));
    } catch {
      if (ordinal === refreshOrdinal && !disposed) publish(snapshot("error"));
      return current;
    }
  };

  const unsubscribeProjects = projectCatalog.subscribe(() => {
    if (current.state === "ready") void refresh();
  });
  const unsubscribeLinks = cloudLinks.subscribe(() => {
    if (current.state === "ready") void refresh();
  });

  return Object.freeze({
    schema: PROJECT_BINDING_REVIEW_SCHEMA,
    getSnapshot() { return current; },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Project binding review listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    refresh,
    reset() {
      if (disposed) return;
      refreshOrdinal += 1;
      reader.cancel();
      publish(snapshot("unavailable"));
    },
    link(localProjectIdValue, cloudProjectIdValue) {
      if (current.state !== "ready") throw new Error("Project binding review is not ready");
      const localProjectId = validateProjectId(localProjectIdValue);
      const cloudProjectId = validateCloudProjectId(cloudProjectIdValue);
      const local = current.localProjects.find((project) => project.id === localProjectId);
      const remote = current.cloudProjects.find((project) => project.cloudProjectId === cloudProjectId);
      if (!local || !remote || remote.repositoryFullName === null
          || remote.nextState !== "needs_device_binding" || remote.projectDeviceBound
          || remote.linkedLocalProjectId !== null) {
        throw new Error("Project binding is not eligible for local confirmation");
      }
      cloudLinks.link(localProjectId, {
        cloudProjectId: remote.cloudProjectId,
        spaceId: remote.spaceId,
      });
      return refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      refreshOrdinal += 1;
      reader.dispose();
      unsubscribeProjects();
      unsubscribeLinks();
      listeners.clear();
      current = snapshot("unavailable");
    },
  });
}
