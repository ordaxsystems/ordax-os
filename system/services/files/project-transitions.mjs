import { validateFileSpacePath } from "../../contracts/file-space.mjs";
import {
  MAX_PROJECTS,
  validateProjectFilePath,
  validateProjectId,
  validateProjectName,
  validateProjectPath,
} from "../../contracts/project-catalog.mjs";
import { validateProjectStoreState } from "../../contracts/project-store.mjs";

function readClock(now) {
  if (typeof now !== "function") {
    throw new TypeError("Project transition requires a clock function");
  }
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Project runtime clock must return a non-negative epoch millisecond");
  }
  return value;
}

function validateRelocationPath(value) {
  const path = validateFileSpacePath(value);
  if (path === "/") {
    throw new TypeError("Project continuity relocation path must identify an entry below the logical root");
  }
  return path;
}

function state(value) {
  return validateProjectStoreState(value);
}

export function sameProjectStoreState(leftValue, rightValue) {
  const left = state(leftValue);
  const right = state(rightValue);
  if (left.nextOrdinal !== right.nextOrdinal || left.projects.length !== right.projects.length) {
    return false;
  }
  return left.projects.every((project, index) => {
    const candidate = right.projects[index];
    return project.id === candidate.id
      && project.name === candidate.name
      && project.path === candidate.path
      && project.createdAt === candidate.createdAt
      && project.lastOpenedAt === candidate.lastOpenedAt
      && project.lastFilePath === candidate.lastFilePath;
  });
}

export function createProjectState(currentValue, { name, path } = {}, now = Date.now) {
  const current = state(currentValue);
  if (current.projects.length >= MAX_PROJECTS) {
    throw new RangeError(`Project catalog supports at most ${MAX_PROJECTS} projects`);
  }
  const validatedName = validateProjectName(name);
  const validatedPath = validateProjectPath(path);
  if (current.projects.some((project) => project.path === validatedPath)) {
    throw new TypeError("This folder is already registered as a project");
  }
  const timestamp = readClock(now);
  const project = Object.freeze({
    id: `project-${current.nextOrdinal}`,
    name: validatedName,
    path: validatedPath,
    createdAt: timestamp,
    lastOpenedAt: timestamp,
    lastFilePath: null,
  });
  return state({
    nextOrdinal: current.nextOrdinal + 1,
    projects: [project, ...current.projects],
  });
}

export function renameProjectState(currentValue, id, name) {
  const current = state(currentValue);
  const projectId = validateProjectId(id);
  const validatedName = validateProjectName(name);
  const existingIndex = current.projects.findIndex((project) => project.id === projectId);
  if (existingIndex < 0) {
    throw new TypeError("Project id is not registered");
  }
  const existing = current.projects[existingIndex];
  if (existing.name === validatedName) return current;
  const projects = [...current.projects];
  projects[existingIndex] = Object.freeze({ ...existing, name: validatedName });
  return state({ nextOrdinal: current.nextOrdinal, projects });
}

export function recordProjectOpenedState(currentValue, id, now = Date.now) {
  const current = state(currentValue);
  const projectId = validateProjectId(id);
  const existing = current.projects.find((project) => project.id === projectId);
  if (!existing) {
    throw new TypeError("Project id is not registered");
  }
  const timestamp = Math.max(readClock(now), existing.lastOpenedAt, existing.createdAt);
  const updated = Object.freeze({ ...existing, lastOpenedAt: timestamp });
  return state({
    nextOrdinal: current.nextOrdinal,
    projects: [updated, ...current.projects.filter((project) => project.id !== projectId)],
  });
}

export function recordProjectFileOpenedState(currentValue, id, filePath, now = Date.now) {
  const current = state(currentValue);
  const projectId = validateProjectId(id);
  const existing = current.projects.find((project) => project.id === projectId);
  if (!existing) {
    throw new TypeError("Project id is not registered");
  }
  const validatedFilePath = validateProjectFilePath(existing.path, filePath);
  const timestamp = Math.max(readClock(now), existing.lastOpenedAt, existing.createdAt);
  const updated = Object.freeze({
    ...existing,
    lastOpenedAt: timestamp,
    lastFilePath: validatedFilePath,
  });
  return state({
    nextOrdinal: current.nextOrdinal,
    projects: [updated, ...current.projects.filter((project) => project.id !== projectId)],
  });
}

export function clearProjectLastFileState(currentValue, id) {
  const current = state(currentValue);
  const projectId = validateProjectId(id);
  const existingIndex = current.projects.findIndex((project) => project.id === projectId);
  if (existingIndex < 0) {
    throw new TypeError("Project id is not registered");
  }
  const existing = current.projects[existingIndex];
  if (existing.lastFilePath === null) return current;
  const projects = [...current.projects];
  projects[existingIndex] = Object.freeze({ ...existing, lastFilePath: null });
  return state({ nextOrdinal: current.nextOrdinal, projects });
}

export function relocateProjectLastFilePathState(currentValue, previousPath, nextPath) {
  const current = state(currentValue);
  const previous = validateRelocationPath(previousPath);
  const next = validateRelocationPath(nextPath);
  if (previous === next) return current;

  let changed = false;
  const projects = current.projects.map((project) => {
    const currentPath = project.lastFilePath;
    if (
      currentPath === null
      || (currentPath !== previous && !currentPath.startsWith(`${previous}/`))
    ) {
      return project;
    }

    const suffix = currentPath.slice(previous.length);
    const relocated = validateFileSpacePath(`${next}${suffix}`);
    const insideProject = relocated !== project.path && relocated.startsWith(`${project.path}/`);
    const lastFilePath = insideProject
      ? validateProjectFilePath(project.path, relocated)
      : null;
    if (lastFilePath === currentPath) return project;
    changed = true;
    return Object.freeze({ ...project, lastFilePath });
  });

  if (!changed) return current;
  return state({ nextOrdinal: current.nextOrdinal, projects });
}

export function removeProjectState(currentValue, id) {
  const current = state(currentValue);
  const projectId = validateProjectId(id);
  return state({
    nextOrdinal: current.nextOrdinal,
    projects: current.projects.filter((project) => project.id !== projectId),
  });
}
