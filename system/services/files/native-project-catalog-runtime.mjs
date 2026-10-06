import {
  PROJECT_CATALOG_SCHEMA,
  assertProjectCatalogReader,
  validateProjectCatalogSnapshot,
} from "../../contracts/project-catalog.mjs";
import {
  PROJECT_MUTATIONS_SCHEMA,
  assertProjectMutations,
} from "../../contracts/project-mutations.mjs";
import {
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

const DEFAULT_MAX_CAS_ATTEMPTS = 4;

function assertTransport(value) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.read !== "function"
    || typeof value.compareAndSwap !== "function"
  ) {
    throw new TypeError("Native Project catalog runtime requires a CAS state transport");
  }
  return value;
}

function maxCasAttempts(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw new TypeError("Native Project catalog CAS attempts must be between 1 and 16");
  }
  return value;
}

function validateRecord(value) {
  if (value === null) {
    return Object.freeze({ revision: 0, state: createEmptyProjectStoreState() });
  }
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || value.revision > Number.MAX_SAFE_INTEGER
    || !Object.hasOwn(value, "state")
  ) {
    throw new TypeError("Native Project catalog runtime received an invalid record");
  }
  return Object.freeze({
    revision: value.revision,
    state: validateProjectStoreState(value.state),
  });
}

function validateCasResult(value, expectedRevision) {
  if (!value || typeof value !== "object" || typeof value.accepted !== "boolean") {
    throw new TypeError("Native Project catalog runtime received an invalid CAS result");
  }
  if (value.accepted) {
    if (value.revision !== expectedRevision + 1) {
      throw new TypeError("Native Project catalog CAS revision is invalid");
    }
    return Object.freeze({ accepted: true, revision: value.revision });
  }
  if (value.revision !== null) {
    throw new TypeError("Native Project catalog rejected CAS revision must remain unknown until readback");
  }
  return Object.freeze({ accepted: false, revision: null });
}

export async function createNativeProjectCatalogCasRuntime({
  transport: transportValue,
  now = Date.now,
  maxAttempts = DEFAULT_MAX_CAS_ATTEMPTS,
} = {}) {
  const transport = assertTransport(transportValue);
  if (typeof now !== "function") {
    throw new TypeError("Native Project catalog runtime requires a clock function");
  }
  const attempts = maxCasAttempts(maxAttempts);
  const initial = validateRecord(await transport.read());
  let revision = initial.revision;
  let state = initial.state;
  let queue = Promise.resolve();
  const listeners = new Set();

  const getSnapshot = () => validateProjectCatalogSnapshot({
    persistence: "device",
    projects: state.projects,
  });

  const emit = () => {
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) listener(snapshot);
  };

  const adopt = (record, { emitChange = true } = {}) => {
    const normalized = validateRecord(record);
    const changed = normalized.revision !== revision || !sameProjectStoreState(normalized.state, state);
    revision = normalized.revision;
    state = normalized.state;
    if (changed && emitChange) emit();
    return changed;
  };

  const refresh = async ({ emitChange = true } = {}) => {
    adopt(await transport.read(), { emitChange });
  };

  const enqueue = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  const mutate = (transition) => enqueue(async () => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const expectedRevision = revision;
      const nextState = validateProjectStoreState(transition(state));
      if (sameProjectStoreState(nextState, state)) return getSnapshot();

      const result = validateCasResult(
        await transport.compareAndSwap(expectedRevision, nextState),
        expectedRevision,
      );
      if (result.accepted) {
        revision = result.revision;
        state = nextState;
        emit();
        return getSnapshot();
      }

      await refresh();
    }
    throw new Error("Native Project catalog state changed concurrently too many times");
  });

  const reader = Object.freeze({
    schema: PROJECT_CATALOG_SCHEMA,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Project catalog listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  const mutations = Object.freeze({
    schema: PROJECT_MUTATIONS_SCHEMA,
    create(input = {}) {
      return mutate((current) => createProjectState(current, input, now));
    },
    rename(id, name) {
      return mutate((current) => renameProjectState(current, id, name));
    },
    recordOpened(id) {
      return mutate((current) => recordProjectOpenedState(current, id, now));
    },
    recordFileOpened(id, filePath) {
      return mutate((current) => recordProjectFileOpenedState(current, id, filePath, now));
    },
    clearLastFile(id) {
      return mutate((current) => clearProjectLastFileState(current, id));
    },
    relocateLastFilePath(previousPath, nextPath) {
      return mutate((current) => relocateProjectLastFilePathState(current, previousPath, nextPath));
    },
    remove(id) {
      return mutate((current) => removeProjectState(current, id));
    },
  });

  assertProjectCatalogReader(reader);
  assertProjectMutations(mutations);

  return Object.freeze({
    reader,
    mutations,
    async refresh() {
      await enqueue(async () => refresh());
      return getSnapshot();
    },
  });
}
