import {
  MAX_PERSONAL_ORDAX_STORE_BYTES,
  validatePersonalOrdaxOwner,
  validatePersonalOrdaxStoreState,
} from "../../contracts/personal-ordax-store.mjs";

export const PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT = "/__ordax/native/personal-ordax-state";
export const PERSONAL_ORDAX_NATIVE_RECORD_SCHEMA = "ordax.native-personal-ordax-record/1";
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 6 * MAX_PERSONAL_ORDAX_STORE_BYTES + 8192;
const encoder = new TextEncoder();

function timeoutMs(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 300_000) {
    throw new TypeError("Native Personal OrdaX request timeout is invalid");
  }
  return value;
}

function cancelBody(response) {
  try {
    const cancelled = response?.body?.cancel?.();
    if (cancelled && typeof cancelled.catch === "function") void cancelled.catch(() => {});
  } catch {}
}

async function boundedJson(response) {
  const declaredRaw = response?.headers?.get?.("content-length");
  if (typeof declaredRaw === "string" && /^\d+$/.test(declaredRaw.trim())) {
    const declared = Number(declaredRaw);
    if (Number.isSafeInteger(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new Error("Native Personal OrdaX response exceeds byte limit");
    }
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw new Error("Native Personal OrdaX response does not expose a bounded stream");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      try { await reader.cancel(); } catch {}
      throw new Error("Native Personal OrdaX response chunk is invalid");
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch {}
      throw new Error("Native Personal OrdaX response exceeds byte limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Native Personal OrdaX response is not valid UTF-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Native Personal OrdaX response is not valid JSON");
  }
}

async function withTimeout(fetchImpl, url, options, milliseconds, label, consume) {
  const controller = new AbortController();
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${milliseconds}ms`));
    }, milliseconds);
  });
  const operation = (async () => {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await consume(response);
  })();
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

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
  { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native Personal OrdaX transport requires window.fetch");
  }
  const fetchImpl = windowRef.fetch.bind(windowRef);
  const requestTimeout = timeoutMs(requestTimeoutMs);

  return Object.freeze({
    async read(ownerValue) {
      const owner = validatePersonalOrdaxOwner(ownerValue);
      return await withTimeout(
        fetchImpl,
        queryFor(owner),
        { method: "GET", cache: "no-store", credentials: "same-origin" },
        requestTimeout,
        "Native Personal OrdaX state load",
        async (response) => {
          if (!response.ok) {
            cancelBody(response);
            throw new Error(`Native Personal OrdaX state unavailable: ${response.status}`);
          }
          const envelope = await boundedJson(response);
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
      const payload = JSON.stringify(state);
      const request = JSON.stringify({
        action: "compare-and-swap",
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        expectedRevision,
        payload,
      });
      if (encoder.encode(request).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("Native Personal OrdaX mutation exceeds byte limit");
      }
      return await withTimeout(
        fetchImpl,
        PERSONAL_ORDAX_NATIVE_STATE_ENDPOINT,
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: request,
        },
        requestTimeout,
        "Native Personal OrdaX state mutation",
        async (response) => {
          if (response.status === 409) {
            cancelBody(response);
            return Object.freeze({ accepted: false, revision: expectedRevision });
          }
          if (!response.ok) {
            cancelBody(response);
            throw new Error(`Native Personal OrdaX mutation failed: ${response.status}`);
          }
          const result = await boundedJson(response);
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
