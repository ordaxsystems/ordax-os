import {
  assertProjectStore,
  createEmptyProjectStoreState,
  validateProjectStoreState,
} from "../../contracts/project-store.mjs";

function assertNativeTransport(value) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.read !== "function"
    || typeof value.compareAndSwap !== "function"
  ) {
    throw new TypeError("Project Native migration requires an async Native state transport");
  }
  return value;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function sameState(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function isEmpty(state) {
  return state.nextOrdinal === 1 && state.projects.length === 0;
}

function readLegacy(store) {
  return validateProjectStoreState(store.load());
}

function validateNativeRecord(value) {
  if (value === null) return null;
  if (
    !value
    || typeof value !== "object"
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !Object.hasOwn(value, "state")
  ) {
    throw new TypeError("Project Native migration received an invalid record");
  }
  return Object.freeze({
    revision: value.revision,
    state: validateProjectStoreState(value.state),
  });
}

function validateCasResult(value) {
  if (!value || typeof value !== "object" || typeof value.accepted !== "boolean") {
    throw new TypeError("Project Native migration received an invalid CAS result");
  }
  if (value.accepted) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
      throw new TypeError("Project Native migration received an invalid accepted revision");
    }
  } else if (value.revision !== null) {
    throw new TypeError("Project Native migration conflict revision must remain unknown until readback");
  }
  return value;
}

export function createProjectNativeStateMigration({
  legacyStore: legacyStoreValue,
  nativeTransport: nativeTransportValue,
} = {}) {
  const legacyStore = assertProjectStore(legacyStoreValue);
  const nativeTransport = assertNativeTransport(nativeTransportValue);

  const inspectInternal = async () => {
    const legacy = readLegacy(legacyStore);
    const native = validateNativeRecord(await nativeTransport.read());
    let status;
    if (native === null && isEmpty(legacy)) status = "empty";
    else if (native === null) status = "legacy-only";
    else if (isEmpty(legacy)) status = "native-only";
    else status = sameState(legacy, native.state) ? "mirrored-identical" : "conflict";
    return { legacy, native, status };
  };

  return Object.freeze({
    async inspect() {
      const current = await inspectInternal();
      return Object.freeze({
        status: current.status,
        nativeRevision: current.native?.revision ?? 0,
        legacyEmpty: isEmpty(current.legacy),
        nativePresent: current.native !== null,
      });
    },

    async migrate() {
      const before = await inspectInternal();
      if (before.status === "empty") {
        return Object.freeze({ status: "empty", revision: 0 });
      }
      if (before.status === "native-only" || before.status === "mirrored-identical") {
        return Object.freeze({ status: "already-native", revision: before.native.revision });
      }
      if (before.status === "conflict") {
        throw new Error("Project legacy and Native states diverged; automatic migration is blocked");
      }

      const write = validateCasResult(
        await nativeTransport.compareAndSwap(0, before.legacy),
      );
      const after = validateNativeRecord(await nativeTransport.read());
      if (after === null || !sameState(after.state, before.legacy)) {
        throw new Error("Project Native migration could not verify the exact legacy state durably");
      }
      if (write.accepted && after.revision !== write.revision) {
        throw new Error("Project Native migration revision changed before verification");
      }
      if (!write.accepted) {
        return Object.freeze({ status: "race-converged", revision: after.revision });
      }
      return Object.freeze({ status: "migrated", revision: after.revision });
    },

    emptyState() {
      return createEmptyProjectStoreState();
    },
  });
}
