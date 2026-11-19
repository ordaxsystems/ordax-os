import { validateProjectId } from "./project-catalog.mjs";
import { validateCloudProjectId, validateCloudSpaceId } from "./project-cloud-links.mjs";

export const PROJECT_BINDING_REVIEW_SCHEMA = "ordax.project-binding-review/1";
export const PROJECT_BINDING_REVIEW_SNAPSHOT_SCHEMA = "ordax.project-binding-review-snapshot/1";
const STATES = new Set(["idle", "loading", "ready", "unavailable", "error"]);
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const NEXT_STATES = new Set([
  "needs_github_authorization",
  "needs_repository_selection",
  "needs_space_device_grant",
  "needs_device_binding",
  "ready_without_grants",
  "ready",
]);

function visible(value, max, field) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new TypeError(`${field} is invalid`);
  }
  return text;
}

export function validateProjectBindingReviewSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema !== PROJECT_BINDING_REVIEW_SNAPSHOT_SCHEMA
      || !STATES.has(value.state)) {
    throw new TypeError("Project binding review snapshot is invalid");
  }
  const deviceId = value.deviceId === null ? null : value.deviceId;
  if (deviceId !== null && (typeof deviceId !== "string" || !UUID.test(deviceId))) {
    throw new TypeError("Project binding review device id is invalid");
  }
  const localProjects = Array.isArray(value.localProjects) ? value.localProjects.map((project) =>
    Object.freeze({
      id: validateProjectId(project.id),
      name: visible(project.name, 80, "Local project name"),
    })) : null;
  const cloudProjects = Array.isArray(value.cloudProjects) ? value.cloudProjects.map((project) => {
    const repositoryFullName = project.repositoryFullName === null ? null
      : visible(project.repositoryFullName, 220, "Repository");
    if (!NEXT_STATES.has(project.nextState)) {
      throw new TypeError("Cloud project next state is invalid");
    }
    return Object.freeze({
      cloudProjectId: validateCloudProjectId(project.cloudProjectId),
      spaceId: validateCloudSpaceId(project.spaceId),
      name: visible(project.name, 120, "Cloud project name"),
      repositoryFullName,
      nextState: project.nextState,
      projectDeviceBound: project.projectDeviceBound === true,
      linkedLocalProjectId: project.linkedLocalProjectId === null
        ? null : validateProjectId(project.linkedLocalProjectId),
    });
  }) : null;
  if (value.state === "ready" && (deviceId === null || localProjects === null || cloudProjects === null)) {
    throw new TypeError("Ready project binding review requires device and projects");
  }
  if (value.state !== "ready"
      && ((localProjects !== null && localProjects.length > 0)
        || (cloudProjects !== null && cloudProjects.length > 0))) {
    throw new TypeError("Non-ready project binding review cannot expose projects");
  }
  return Object.freeze({
    schema: PROJECT_BINDING_REVIEW_SNAPSHOT_SCHEMA,
    state: value.state,
    deviceId,
    localProjects: localProjects ?? Object.freeze([]),
    cloudProjects: cloudProjects ?? Object.freeze([]),
  });
}

export function assertProjectBindingReviewPort(port) {
  if (!port || typeof port !== "object" || port.schema !== PROJECT_BINDING_REVIEW_SCHEMA
      || typeof port.getSnapshot !== "function" || typeof port.subscribe !== "function"
      || typeof port.refresh !== "function" || typeof port.link !== "function"
      || typeof port.reset !== "function") {
    throw new TypeError("A compatible project binding review port is required");
  }
  validateProjectBindingReviewSnapshot(port.getSnapshot());
  return port;
}
