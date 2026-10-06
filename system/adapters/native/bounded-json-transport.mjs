export const DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS = 3000;

const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 300_000;
const MAX_TRANSPORT_BYTES = 128 * 1024 * 1024;
const NATIVE_ENDPOINT_PREFIX = "/__ordax/native/";
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const encoder = new TextEncoder();

function positiveInteger(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function timeoutMs(value, label) {
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new TypeError(`${label} request timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds`);
  }
  return value;
}

function boundedLabel(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Native JSON transport label must be text");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 96) {
    throw new TypeError("Native JSON transport label is outside bounds");
  }
  return normalized;
}

function nativeEndpoint(value) {
  if (typeof value !== "string" || value.includes("\0") || !value.startsWith("/")) {
    throw new TypeError("Native JSON transport endpoint must be an absolute same-origin path");
  }
  if (value.startsWith("//")) {
    throw new TypeError("Native JSON transport endpoint must not be protocol-relative");
  }
  let parsed;
  try {
    parsed = new URL(value, "https://ordax.invalid");
  } catch {
    throw new TypeError("Native JSON transport endpoint is invalid");
  }
  if (parsed.origin !== "https://ordax.invalid" || !parsed.pathname.startsWith(NATIVE_ENDPOINT_PREFIX)) {
    throw new TypeError("Native JSON transport endpoint must stay inside the Native same-origin boundary");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function requestMethod(value) {
  const normalized = typeof value === "string" ? value.toUpperCase() : "GET";
  if (!ALLOWED_METHODS.has(normalized)) {
    throw new TypeError("Native JSON transport method is invalid");
  }
  return normalized;
}

function declaredContentLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function createNativeBoundedJsonTransport(
  windowRef = globalThis.window,
  {
    maxResponseBytes,
    maxRequestBytes = maxResponseBytes,
    requestTimeoutMs = DEFAULT_NATIVE_JSON_REQUEST_TIMEOUT_MS,
    label = "Native",
  } = {},
) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native JSON transport requires window.fetch");
  }
  const normalizedLabel = boundedLabel(label);
  const responseLimit = positiveInteger(
    maxResponseBytes,
    `${normalizedLabel} response byte limit`,
    MAX_TRANSPORT_BYTES,
  );
  const requestLimit = positiveInteger(
    maxRequestBytes,
    `${normalizedLabel} request byte limit`,
    MAX_TRANSPORT_BYTES,
  );
  const requestTimeout = timeoutMs(requestTimeoutMs, normalizedLabel);
  const fetchImpl = windowRef.fetch.bind(windowRef);

  function cancel(response) {
    const body = response?.body;
    if (!body || typeof body.cancel !== "function") return;
    try {
      const cancellation = body.cancel();
      if (cancellation && typeof cancellation.catch === "function") void cancellation.catch(() => {});
    } catch {
      // Status handling already decides the caller-visible result.
    }
  }

  function assertRequestBody(body, operationLabel = "request") {
    if (typeof body !== "string") {
      throw new TypeError(`${normalizedLabel} ${operationLabel} body must be serialized text`);
    }
    if (encoder.encode(body).byteLength > requestLimit) {
      throw new Error(`${normalizedLabel} ${operationLabel} exceeds its byte limit`);
    }
    return body;
  }

  async function readJson(response, responseLabel = "response") {
    const declared = declaredContentLength(response);
    if (declared !== null && declared > responseLimit) {
      cancel(response);
      throw new Error(`${normalizedLabel} ${responseLabel} exceeds its byte limit`);
    }
    if (!response?.body || typeof response.body.getReader !== "function") {
      throw new Error(`${normalizedLabel} ${responseLabel} does not expose a bounded stream`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        try { await reader.cancel(); } catch {}
        throw new Error(`${normalizedLabel} ${responseLabel} chunk is invalid`);
      }
      total += value.byteLength;
      if (total > responseLimit) {
        try { await reader.cancel(); } catch {}
        throw new Error(`${normalizedLabel} ${responseLabel} exceeds its byte limit`);
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let decoded;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`${normalizedLabel} ${responseLabel} is not valid UTF-8`);
    }
    try {
      return JSON.parse(decoded);
    } catch {
      throw new Error(`${normalizedLabel} ${responseLabel} is not valid JSON`);
    }
  }

  async function request(
    endpointValue,
    {
      method = "GET",
      headers = null,
      body = null,
      operation = "request",
    } = {},
    consume,
  ) {
    if (typeof consume !== "function") {
      throw new TypeError("Native JSON transport request requires a response consumer");
    }
    const endpoint = nativeEndpoint(endpointValue);
    const normalizedMethod = requestMethod(method);
    if (normalizedMethod === "GET" && body !== null) {
      throw new TypeError("Native JSON transport GET request cannot carry a body");
    }
    if (headers !== null && (!headers || typeof headers !== "object" || Array.isArray(headers))) {
      throw new TypeError("Native JSON transport headers must be an object");
    }
    const serializedBody = body === null ? null : assertRequestBody(body, operation);
    const controller = new AbortController();
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`${normalizedLabel} ${operation} timed out after ${requestTimeout}ms`));
      }, requestTimeout);
    });
    const fetchOperation = (async () => {
      const options = {
        method: normalizedMethod,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      };
      if (headers !== null) options.headers = headers;
      if (serializedBody !== null) options.body = serializedBody;
      const response = await fetchImpl(endpoint, options);
      return await consume(response);
    })();
    try {
      return await Promise.race([fetchOperation, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  return Object.freeze({
    request,
    readJson,
    cancel,
    assertRequestBody,
  });
}
