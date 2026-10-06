import {
  MAX_WORK_COORDINATION_STORE_BYTES,
  WORK_COORDINATION_STORE_SCHEMA,
  validateWorkCoordinationPartition,
  validateWorkCoordinationStoreState,
} from "../../contracts/work-coordination-store.mjs";
import {
  createNativeBoundedJsonTransport,
  DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS,
} from "./bounded-json-transport.mjs";

export const WORK_COORDINATION_NATIVE_STATE_ENDPOINT = "/__ordax/native/work-coordination-state";
export const WORK_COORDINATION_NATIVE_RECORD_SCHEMA = "ordax.native-work-coordination-record/1";
const MAX_RESPONSE_BYTES = 6 * MAX_WORK_COORDINATION_STORE_BYTES + 8192;
const encoder = new TextEncoder();

function queryFor(partition) {
  const query = new URLSearchParams({ ownerKind: partition.ownerKind });
  if (partition.ownerKind === "account") query.set("ownerId", partition.ownerId);
  if (partition.projectId !== null) query.set("projectId", partition.projectId);
  return `${WORK_COORDINATION_NATIVE_STATE_ENDPOINT}?${query.toString()}`;
}

function validateRecord(value, expectedPartition) {
  if (value === null) return null;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 6
    || value.$schema !== WORK_COORDINATION_NATIVE_RECORD_SCHEMA
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || value.ownerKind !== expectedPartition.ownerKind
    || value.ownerId !== expectedPartition.ownerId
    || value.projectId !== expectedPartition.projectId
    || typeof value.payload !== "string"
  ) {
    throw new TypeError("Native Work coordination record shape is invalid");
  }
  if (encoder.encode(value.payload).byteLength > MAX_WORK_COORDINATION_STORE_BYTES) {
    throw new TypeError("Native Work coordination payload exceeds byte limit");
  }
  let parsed;
  try {
    parsed = JSON.parse(value.payload);
  } catch {
    throw new TypeError("Native Work coordination payload is invalid JSON");
  }
  const state = validateWorkCoordinationStoreState(parsed, expectedPartition);
  return Object.freeze({ revision: value.revision, state });
}

export function createNativeWorkCoordinationStateTransport(
  windowRef = globalThis.window,
  { requestTimeoutMs = DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS } = {},
) {
  const transport = createNativeBoundedJsonTransport(windowRef, {
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxRequestBytes: MAX_RESPONSE_BYTES,
    requestTimeoutMs,
    label: "Native Work coordination",
  });

  return Object.freeze({
    async read(partitionValue) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      return await transport.request(
        queryFor(partition),
        { method: "GET", operation: "state load" },
        async (response) => {
          if (!response.ok) {
            transport.cancel(response);
            throw new Error(`Native Work coordination state unavailable: ${response.status}`);
          }
          const envelope = await transport.readJson(response);
          if (
            !envelope
            || typeof envelope !== "object"
            || Array.isArray(envelope)
            || Object.keys(envelope).length !== 1
            || !Object.hasOwn(envelope, "record")
          ) {
            throw new TypeError("Native Work coordination read response shape is invalid");
          }
          return validateRecord(envelope.record, partition);
        },
      );
    },

    async compareAndSwap(partitionValue, expectedRevision, stateValue) {
      const partition = validateWorkCoordinationPartition(partitionValue);
      if (
        !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 0
        || expectedRevision > Number.MAX_SAFE_INTEGER - 1
      ) {
        throw new TypeError("Native Work coordination expected revision is invalid");
      }
      const state = validateWorkCoordinationStoreState(stateValue, partition);
      const request = JSON.stringify({
        action: "compare-and-swap",
        ownerKind: partition.ownerKind,
        ownerId: partition.ownerId,
        projectId: partition.projectId,
        expectedRevision,
        payload: JSON.stringify(state),
      });
      return await transport.request(
        WORK_COORDINATION_NATIVE_STATE_ENDPOINT,
        {
          method: "POST",
          operation: "state mutation",
          headers: { "Content-Type": "application/json" },
          body: request,
        },
        async (response) => {
          if (response.status === 409) {
            transport.cancel(response);
            return Object.freeze({ accepted: false, revision: null });
          }
          if (!response.ok) {
            transport.cancel(response);
            throw new Error(`Native Work coordination mutation failed: ${response.status}`);
          }
          const result = await transport.readJson(response);
          if (
            !result
            || typeof result !== "object"
            || Array.isArray(result)
            || Object.keys(result).length !== 2
            || result.ok !== true
            || !Number.isSafeInteger(result.revision)
            || result.revision !== expectedRevision + 1
          ) {
            throw new TypeError("Native Work coordination mutation response shape is invalid");
          }
          return Object.freeze({ accepted: true, revision: result.revision });
        },
      );
    },
  });
}

export function createNativeWorkCoordinationStore(
  windowRef = globalThis.window,
  options = {},
) {
  const stateTransport = createNativeWorkCoordinationStateTransport(windowRef, options);
  return Object.freeze({
    schema: WORK_COORDINATION_STORE_SCHEMA,
    scope: "device",
    async load(partitionValue) {
      return await stateTransport.read(partitionValue);
    },
    async compareAndSwap(partitionValue, expectedRevision, stateValue) {
      const result = await stateTransport.compareAndSwap(
        partitionValue,
        expectedRevision,
        stateValue,
      );
      return result.accepted;
    },
  });
}
