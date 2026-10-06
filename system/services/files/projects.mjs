import {
  PROJECT_CATALOG_SCHEMA,
  assertProjectCatalogPort,
  validateProjectCatalogSnapshot,
} from "../../contracts/project-catalog.mjs";
import {
  assertProjectStore,
  createEmptyProjectStoreState,
  validateProjectStoreState,
} from "../../contracts/project-store.mjs";
import {
  clearProjectLastFileState,
  createProjectState,
  recordProjectFileOpenedState,
  recordProjectOpenedState,
  relocateProjectLastFilePathState,
  removeProjectState,
  renameProjectState,
  sameProjectStoreState,
} from "./project-transitions.mjs";

export function createProjectCatalogRuntime({ store = null, now = Date.now } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("Project runtime requires a clock function");
  }
  const durableStore = store === null ? null : assertProjectStore(store);
  let persistence = durableStore?.scope ?? "session";
  let state = createEmptyProjectStoreState();
  const listeners = new Set();

  if (durableStore) {
    try {
      state = validateProjectStoreState(durableStore.load());
    } catch {
      state = createEmptyProjectStoreState();
      persistence = "session";
    }
  }

  const getSnapshot = () => validateProjectCatalogSnapshot({
    persistence,
    projects: state.projects,
  });

  const emit = () => {
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const persist = (nextState) => {
    state = validateProjectStoreState(nextState);
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

  const replaceState = (nextState) => {
    const validated = validateProjectStoreState(nextState);
    if (sameProjectStoreState(validated, state)) return false;
    persist(validated);
    emit();
    return true;
  };

  const port = {
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Project catalog listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    create(input = {}) {
      replaceState(createProjectState(state, input, now));
      return getSnapshot();
    },
    rename(id, name) {
      replaceState(renameProjectState(state, id, name));
      return getSnapshot();
    },
    recordOpened(id) {
      replaceState(recordProjectOpenedState(state, id, now));
      return getSnapshot();
    },
    recordFileOpened(id, filePath) {
      replaceState(recordProjectFileOpenedState(state, id, filePath, now));
      return getSnapshot();
    },
    clearLastFile(id) {
      replaceState(clearProjectLastFileState(state, id));
      return getSnapshot();
    },
    relocateLastFilePath(previousPath, nextPath) {
      replaceState(relocateProjectLastFilePathState(state, previousPath, nextPath));
      return getSnapshot();
    },
    remove(id) {
      replaceState(removeProjectState(state, id));
      return getSnapshot();
    },
  };

  assertProjectCatalogPort(port);
  return Object.freeze(port);
}
