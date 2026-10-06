import {
  MAX_PERSONAL_ORDAX_STORE_BYTES,
  validatePersonalOrdaxOwner,
  validatePersonalOrdaxStoreState,
} from "../../contracts/personal-ordax-store.mjs";
import {
  createNativeBoundedJsonTransport,
  DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS,
} from "./bounded-json-transport.mjs";

export const PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT = "/__ordax/native/personal-ordax-state";
export const PERSONAL_ORDAX_NATIVE_RECORD_SCHEMA = "ordax.native-personal-ordax-record/1";
const MAX_RESPONSE_BYTES = 6 * MAX_PERSONAL_ORDAX_STORE_BYTES + 8192;
const encoder = new TextEncoder();

function queryFor(owner) {
  const query = new URLSearchParams({ ownerKind: owner.ownerKind });
  if (owner.ownerKind === "account") query.set("ownerId", owner.ownerId);
  return `${PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT}?${query.toString()}`;
}

function validateRecord(value, expectedOwner) {
  if (value === null) return null;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 5
    || value.$schema !== PERSONAL_ORDAX_NATIVE_RECORD_SCHEMA
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || value.ownerKind !== expectedOwner.ownerKind
    || value.ownerId !== expectedOwner.ownerId
    || typeof value.payload !== "string"
  ) {
    throw new TypeError("Native Personal OrdaX record shape is invalid");
  }
  if (encoder.encode(value.payload).byteLength > MAX_PERSONAL_ORDAX_STORE_BYTES) {
    throw new TypeError("Native Personal OrdaX payload exceeds byte limit");
  }
  let parsed;
  try {
    parsed = JSON.parse(value.payload);
  } catch {
    throw new TypeError("Native Personal OrdaX payload is invalid JSON");
  }
  const state = validatePersonalOrdaxStoreState(parsed, expectedOwner);
  return Object.freeze({ revision: value.revision, state });
}

export function createNativePersonalOrdaxStateTransport(
  windowRef = globalThis.window,
  { requestTimeoutMs = DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS } = {},
) {
  const transport = createNativeBoundedJsonTransport(windowRef, {
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxRequestBytes: MAX_RESPONSE_BYTES,
    requestTimeoutMs,
    label: "Native Personal OrdaX",
  });

  return Object.freeze({
    async read(ownerValue) {
      const owner = validatePersonalOrdaxOwner(ownerValue);
      return await transport.request(
        queryFor(owner),
        { method: "GET", operation: "state load" },
        async (response) => {
          if (!response.ok) {
            transport.cancel(response);
            throw new Error(`Native Personal OrdaX state unavailable: ${response.status}`);
          }
          const envelope = await transport.readJson(response);
          if (
            !envelope
            || typeof envelope !== "object"
            || Array.isArray(envelope)
            || Object.keys(envelope).length !== 1
            || !Object.hasOwn(envelope, "record")
          ) {
            throw new TypeError("Native Personal OrdaX read response shape is invalid");
          }
          return validateRecord(envelope.record, owner);
        },
      );
    },

    async compareAndSwap(ownerValue, expectedRevision, stateValue) {
      const owner = validatePersonalOrdaxOwner(ownerValue);
      if (
        !Number.isSafeInteger(expectedRevision)
        || expectedRevision < 0
        || expectedRevision > Number.MAX_SAFE_INTEGER - 1
      ) {
        throw new TypeError("Native Personal OrdaX expected revision is invalid");
      }
      const state = validatePersonalOrdaxStoreState(stateValue, owner);
      const request = JSON.stringify({
        action: "compare-and-swap",
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        expectedRevision,
        payload: JSON.stringify(state),
      });
      return await transport.request(
        PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT,
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
            throw new Error(`Native Personal OrdaX mutation failed: ${response.status}`);
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
            throw new TypeError("Native Personal OrdaX mutation response shape is invalid");
          }
          return Object.freeze({ accepted: true, revision: result.revision });
        },
      );
    },
  });
}
