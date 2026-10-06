import { validateProjectStoreState } from "../../contracts/project-store.mjs";
import {
  createNativeBoundedJsonTransport,
  DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS,
} from "./bounded-json-transport.mjs";

export const PROJECT_NATIVE_STATE_ENDPOINT = "/__ordax/native/project-state";
export const PROJECT_NATIVE_RECORD_SCHEMA = "ordax.native-project-store-record/1";
export const PROJECT_NATIVE_FORMAT_VERSION = 1;
export const MAX_PROJECT_NATIVE_STATE_BYTES = 1024 * 1024;

function validateRecordRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateExpectedRevision(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateRecord(value) {
  if (value === null) return null;
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 4
    || value.$schema !== PROJECT_NATIVE_RECORD_SCHEMA
    || value.formatVersion !== PROJECT_NATIVE_FORMAT_VERSION
  ) {
    throw new TypeError("Native Project record shape is invalid");
  }
  return Object.freeze({
    revision: validateRecordRevision(value.revision, "Native Project revision"),
    state: validateProjectStoreState(value.state),
  });
}

function validateReadEnvelope(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || !Object.hasOwn(value, "record")
  ) {
    throw new TypeError("Native Project read response shape is invalid");
  }
  return validateRecord(value.record);
}

function validateMutationResult(value, expectedRevision) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 2
    || value.ok !== true
    || value.revision !== expectedRevision + 1
  ) {
    throw new TypeError("Native Project mutation response shape is invalid");
  }
  return Object.freeze({ accepted: true, revision: value.revision });
}

export function createNativeProjectStateTransport(
  windowRef = globalThis.window,
  { requestTimeoutMs = DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS } = {},
) {
  const transport = createNativeBoundedJsonTransport(windowRef, {
    maxResponseBytes: MAX_PROJECT_NATIVE_STATE_BYTES + 8192,
    maxRequestBytes: MAX_PROJECT_NATIVE_STATE_BYTES + 8192,
    requestTimeoutMs,
    label: "Native Projects",
  });

  return Object.freeze({
    async read() {
      return await transport.request(
        PROJECT_NATIVE_STATE_ENDPOINT,
        { method: "GET", operation: "state load" },
        async (response) => {
          if (!response.ok) {
            transport.cancel(response);
            throw new Error(`Native Project state unavailable: ${response.status}`);
          }
          return validateReadEnvelope(await transport.readJson(response));
        },
      );
    },

    async compareAndSwap(expectedRevisionValue, stateValue) {
      const expectedRevision = validateExpectedRevision(
        expectedRevisionValue,
        "Native Project expected revision",
      );
      const state = validateProjectStoreState(stateValue);
      const body = JSON.stringify({
        action: "compare-and-swap",
        expectedRevision,
        state,
      });
      return await transport.request(
        PROJECT_NATIVE_STATE_ENDPOINT,
        {
          method: "POST",
          operation: "state mutation",
          headers: { "Content-Type": "application/json" },
          body,
        },
        async (response) => {
          if (response.status === 409) {
            transport.cancel(response);
            return Object.freeze({ accepted: false, revision: null });
          }
          if (!response.ok) {
            transport.cancel(response);
            throw new Error(`Native Project mutation failed: ${response.status}`);
          }
          return validateMutationResult(
            await transport.readJson(response),
            expectedRevision,
          );
        },
      );
    },
  });
}
