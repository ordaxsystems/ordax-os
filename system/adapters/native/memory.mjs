import {
  MAX_MEMORY_SNAPSHOT_BYTES,
  MEMORY_STORE_SCHEMA,
  assertMemoryStore,
  parseMemorySnapshotPayload,
  validateMemorySnapshot,
} from "../../contracts/memory-store.mjs";

export const MEMORY_ENDPOINT = "/__ordax/native/intelligence-memory";
export const MAX_NATIVE_MEMORY_ENVELOPE_BYTES = 6 * MAX_MEMORY_SNAPSHOT_BYTES + 1024;
const DEFAULT_NATIVE_MEMORY_REQUEST_TIMEOUT_MS = 3000;

const encoder = new TextEncoder();

function validateDeviceSnapshot(snapshot) {
  const validated = validateMemorySnapshot(snapshot);
  if (validated.items.some((item) => item.scope === "session")) {
    throw new TypeError("Native device memory cannot persist session-scoped memory");
  }
  return validated;
}

function parseDevicePayload(payload) {
  const validated = parseMemorySnapshotPayload(payload);
  if (validated.items.some((item) => item.scope === "session")) {
    throw new TypeError("Native device memory cannot load session-scoped memory");
  }
  return validated;
}

function requestTimeoutMs(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 300000) {
    throw new TypeError("Native memory request timeout must be between 100 and 300000 milliseconds");
  }
  return value;
}

function declaredContentLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Native Intelligence memory response is not valid JSON");
  }
}

function cancelResponseBody(response) {
  const body = response?.body;
  if (!body || typeof body.cancel !== "function") return;
  try {
    const cancellation = body.cancel();
    if (cancellation && typeof cancellation.catch === "function") {
      void cancellation.catch(() => {});
    }
  } catch {
    // Status-only callers do not need the response body. Cancellation failure
    // must not replace the actual persistence decision.
  }
}

async function readBoundedEnvelope(response) {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > MAX_NATIVE_MEMORY_ENVELOPE_BYTES) {
    throw new Error("Native Intelligence memory response exceeds its byte limit");
  }

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        try { await reader.cancel(); } catch {}
        throw new Error("Native Intelligence memory response body is invalid");
      }
      total += value.byteLength;
      if (total > MAX_NATIVE_MEMORY_ENVELOPE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw new Error("Native Intelligence memory response exceeds its byte limit");
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
      throw new Error("Native Intelligence memory response is not valid UTF-8");
    }
    return parseJsonText(text);
  }

  if (response && typeof response === "object" && "body" in response) {
    throw new Error("Native Intelligence memory response does not expose a bounded stream");
  }

  // Compatibility for injected test doubles only. Production fetch Response
  // objects expose body and therefore take the bounded stream path or fail closed.
  if (typeof response?.json === "function") return response.json();
  throw new Error("Native Intelligence memory response body is unreadable");
}

async function fetchWithTimeout(fetchImpl, url, options, milliseconds, label, consume = null) {
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
    return consume === null ? response : await consume(response);
  })();
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function validateEnvelope(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || !Object.hasOwn(value, "payload")
  ) {
    throw new TypeError("Native Intelligence memory response shape is invalid");
  }
  if (value.payload !== null && typeof value.payload !== "string") {
    throw new TypeError("Native Intelligence memory response payload is invalid");
  }
  return value;
}

export async function createNativeMemoryStore(
  windowRef = globalThis.window,
  { requestTimeoutMs: requestedTimeoutMs = DEFAULT_NATIVE_MEMORY_REQUEST_TIMEOUT_MS } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native memory store requires window.fetch");
  }
  const fetchImpl = windowRef.fetch.bind(windowRef);
  const requestTimeout = requestTimeoutMs(requestedTimeoutMs);

  let memory = null;
  const initialRequest = await fetchWithTimeout(
    fetchImpl,
    MEMORY_ENDPOINT,
    {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    },
    requestTimeout,
    "Native Intelligence memory load",
    async (response) => {
      if (!response.ok) {
        cancelResponseBody(response);
        return Object.freeze({ response, envelope: null });
      }
      return Object.freeze({
        response,
        envelope: validateEnvelope(await readBoundedEnvelope(response)),
      });
    },
  );
  if (!initialRequest.response.ok) {
    throw new Error(
      `Native Intelligence memory persistence unavailable: ${initialRequest.response.status}`,
    );
  }
  if (initialRequest.envelope.payload !== null) {
    memory = parseDevicePayload(initialRequest.envelope.payload);
  }

  let desiredRevision = 0;
  let durableRevision = 0;
  let drainPromise = null;
  let lastPersistError = null;

  const persist = async (snapshot) => {
    const body = JSON.stringify({ payload: JSON.stringify(snapshot) });
    if (encoder.encode(body).byteLength > MAX_NATIVE_MEMORY_ENVELOPE_BYTES) {
      throw new Error("Native Intelligence memory request exceeds its byte limit");
    }
    const next = await fetchWithTimeout(
      fetchImpl,
      MEMORY_ENDPOINT,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body,
      },
      requestTimeout,
      "Native Intelligence memory persistence",
      async (response) => {
        cancelResponseBody(response);
        return response;
      },
    );
    if (!next.ok) {
      throw new Error(`Native Intelligence memory persistence failed: ${next.status}`);
    }
    return true;
  };

  const drainDesiredSnapshot = async () => {
    while (durableRevision < desiredRevision) {
      const revision = desiredRevision;
      const snapshot = memory;
      try {
        await persist(snapshot);
        durableRevision = Math.max(durableRevision, revision);
        if (revision === desiredRevision) lastPersistError = null;
      } catch (error) {
        if (revision < desiredRevision) {
          continue;
        }
        lastPersistError = error instanceof Error
          ? error
          : new Error("Native Intelligence memory persistence failed");
        return false;
      }
    }
    return true;
  };

  const scheduleDrain = () => {
    if (drainPromise !== null) return drainPromise;
    // Defer one microtask so a burst of synchronous edits collapses into the
    // newest snapshot instead of issuing one fsync-backed POST per keystroke.
    drainPromise = Promise.resolve()
      .then(drainDesiredSnapshot)
      .finally(() => {
        drainPromise = null;
      });
    return drainPromise;
  };

  const store = {
    schema: MEMORY_STORE_SCHEMA,
    scope: "device",
    load() {
      return memory;
    },
    save(snapshot) {
      const validated = validateDeviceSnapshot(snapshot);
      memory = validated;
      desiredRevision += 1;
      scheduleDrain();
      return true;
    },
    async flush() {
      const targetRevision = desiredRevision;
      if (durableRevision >= targetRevision) return true;

      await scheduleDrain();
      if (durableRevision >= targetRevision) return true;

      // Retry the newest desired snapshot once. Durability remains revision
      // based, so an obsolete failed snapshot never forces an unnecessary write.
      await scheduleDrain();
      if (durableRevision < targetRevision) {
        throw lastPersistError ?? new Error("Native Intelligence memory persistence failed");
      }
      return true;
    },
  };

  assertMemoryStore(store);
  return Object.freeze(store);
}
