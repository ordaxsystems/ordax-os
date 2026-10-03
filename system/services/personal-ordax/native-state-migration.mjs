import {
  assertPersonalOrdaxStore,
  validatePersonalOrdaxOwner,
  validatePersonalOrdaxStoreState,
} from "../../contracts/personal-ordax-store.mjs";

function assertNativeStateTransport(value) {
  if (
    !value
    || typeof value !== "object"
    || typeof value.read !== "function"
    || typeof value.compareAndSwap !== "function"
  ) {
    throw new TypeError("Personal OrdaX Native migration requires an async Native state transport");
  }
  return value;
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readLegacy(store, owner) {
  const value = store.load(owner);
  return value == null ? null : validatePersonalOrdaxStoreState(value, owner);
}

function validateNativeRecord(value, owner) {
  if (value === null) return null;
  if (
    !value
    || typeof value !== "object"
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !Object.hasOwn(value, "state")
  ) {
    throw new TypeError("Personal OrdaX Native migration received an invalid record");
  }
  return Object.freeze({
    revision: value.revision,
    state: validatePersonalOrdaxStoreState(value.state, owner),
  });
}

export function createPersonalOrdaxNativeStateMigration({
  legacyStore: legacyStoreValue,
  nativeTransport: nativeTransportValue,
} = {}) {
  const legacyStore = assertPersonalOrdaxStore(legacyStoreValue);
  const nativeTransport = assertNativeStateTransport(nativeTransportValue);

  const inspectInternal = async (ownerValue) => {
    const owner = validatePersonalOrdaxOwner(ownerValue);
    const legacy = readLegacy(legacyStore, owner);
    const native = validateNativeRecord(await nativeTransport.read(owner), owner);
    let status;
    if (legacy === null && native === null) status = "empty";
    else if (legacy !== null && native === null) status = "legacy-only";
    else if (legacy === null) status = "native-only";
    else status = sameState(legacy, native.state) ? "mirrored-identical" : "conflict";
    return { owner, legacy, native, status };
  };

  return Object.freeze({
    async inspect(ownerValue) {
      const current = await inspectInternal(ownerValue);
      return Object.freeze({
        status: current.status,
        nativeRevision: current.native?.revision ?? 0,
        legacyPresent: current.legacy !== null,
        nativePresent: current.native !== null,
      });
    },

    async migrate(ownerValue) {
      const before = await inspectInternal(ownerValue);
      if (before.status === "empty") {
        return Object.freeze({ status: "empty", revision: 0 });
      }
      if (before.status === "native-only" || before.status === "mirrored-identical") {
        return Object.freeze({ status: "already-native", revision: before.native.revision });
      }
      if (before.status === "conflict") {
        throw new Error("Personal OrdaX legacy and Native states diverged; automatic migration is blocked");
      }

      const write = await nativeTransport.compareAndSwap(before.owner, 0, before.legacy);
      if (
        !write
        || typeof write !== "object"
        || typeof write.accepted !== "boolean"
        || !Number.isSafeInteger(write.revision)
        || write.revision < 0
      ) {
        throw new TypeError("Personal OrdaX Native migration received an invalid CAS result");
      }

      const after = validateNativeRecord(await nativeTransport.read(before.owner), before.owner);
      if (after === null || !sameState(after.state, before.legacy)) {
        throw new Error("Personal OrdaX Native migration could not verify the exact legacy state durably");
      }
      if (write.accepted && after.revision !== write.revision) {
        throw new Error("Personal OrdaX Native migration revision changed before verification");
      }
      if (!write.accepted) {
        return Object.freeze({ status: "race-converged", revision: after.revision });
      }
      return Object.freeze({ status: "migrated", revision: after.revision });
    },
  });
}
