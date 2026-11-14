import {
  PROJECT_CLOUD_LINKS_SCHEMA,
  assertProjectCloudLinksPort,
  validateCloudProjectId,
  validateCloudSpaceId,
  validateProjectCloudLinksSnapshot,
} from "../../contracts/project-cloud-links.mjs";
import {
  assertProjectCatalogReader,
  validateProjectId,
} from "../../contracts/project-catalog.mjs";
import {
  assertProjectCloudLinkStore,
  createEmptyProjectCloudLinkState,
  validateProjectCloudLinkState,
} from "../../contracts/project-cloud-link-store.mjs";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Project cloud link clock returned an invalid value");
  }
  return value;
}

function sameLinks(left, right) {
  if (left.length !== right.length) return false;
  return left.every((link, index) => {
    const candidate = right[index];
    return link.localProjectId === candidate.localProjectId
      && link.cloudProjectId === candidate.cloudProjectId
      && link.spaceId === candidate.spaceId
      && link.linkedAt === candidate.linkedAt;
  });
}

export function createProjectCloudLinksRuntime({
  projects,
  store = null,
  now = Date.now,
} = {}) {
  const projectCatalog = assertProjectCatalogReader(projects);
  const durableStore = store === null ? null : assertProjectCloudLinkStore(store);
  if (typeof now !== "function") {
    throw new TypeError("Project cloud links runtime requires a clock");
  }

  let persistence = durableStore?.scope ?? "session";
  let state = createEmptyProjectCloudLinkState();
  const listeners = new Set();
  let destroyed = false;

  if (durableStore) {
    try {
      state = validateProjectCloudLinkState(durableStore.load());
    } catch {
      state = createEmptyProjectCloudLinkState();
      persistence = "session";
    }
  }

  const localIds = () => new Set(
    projectCatalog.getSnapshot().projects.map((project) => project.id),
  );

  const getSnapshot = () => validateProjectCloudLinksSnapshot({
    persistence,
    links: state.links,
  });

  const emit = () => {
    if (destroyed) return;
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const persist = (nextState) => {
    state = validateProjectCloudLinkState(nextState);
    if (!durableStore) {
      persistence = "session";
      return;
    }
    try {
      const saved = durableStore.save(state) !== false;
      persistence = saved && durableStore.scope === "device" ? "device" : "session";
    } catch {
      persistence = "session";
    }
  };

  const replaceLinks = (links) => {
    const next = validateProjectCloudLinkState({ links });
    if (sameLinks(next.links, state.links)) return false;
    persist(next);
    emit();
    return true;
  };

  const pruneMissingLocalProjects = () => {
    const allowed = localIds();
    replaceLinks(state.links.filter((link) => allowed.has(link.localProjectId)));
  };

  pruneMissingLocalProjects();
  const unsubscribeProjects = projectCatalog.subscribe(pruneMissingLocalProjects);

  const port = {
    schema: PROJECT_CLOUD_LINKS_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Project cloud links listener must be a function");
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    link(localProjectIdValue, { cloudProjectId, spaceId } = {}) {
      const localProjectId = validateProjectId(localProjectIdValue);
      if (!localIds().has(localProjectId)) {
        throw new TypeError("Local project is not registered");
      }
      const cloudId = validateCloudProjectId(cloudProjectId);
      const cloudSpaceId = validateCloudSpaceId(spaceId);
      const existingLocal = state.links.find(
        (link) => link.localProjectId === localProjectId,
      );
      if (existingLocal) {
        if (
          existingLocal.cloudProjectId === cloudId
          && existingLocal.spaceId === cloudSpaceId
        ) {
          return getSnapshot();
        }
        throw new TypeError("Local project is already linked; unlink it before relinking");
      }
      if (state.links.some((link) => link.cloudProjectId === cloudId)) {
        throw new TypeError("Cloud project is already linked on this device");
      }
      replaceLinks([
        ...state.links,
        Object.freeze({
          localProjectId,
          cloudProjectId: cloudId,
          spaceId: cloudSpaceId,
          linkedAt: readClock(now),
        }),
      ]);
      return getSnapshot();
    },
    unlink(localProjectIdValue) {
      const localProjectId = validateProjectId(localProjectIdValue);
      replaceLinks(state.links.filter((link) => link.localProjectId !== localProjectId));
      return getSnapshot();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeProjects();
      listeners.clear();
    },
  };

  assertProjectCloudLinksPort(port);
  return Object.freeze(port);
}
