import {
  LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES,
  LOCAL_AI_MAX_MODEL_DISCOVERY_BYTES,
  LOCAL_AI_PORT_SCHEMA,
  LOCAL_AI_NATIVE_ENDPOINT,
  validateLocalAiEngineId,
  validateLocalAiModelId,
  validateLocalAiRequest,
  validateLocalAiResponseText,
  validateLocalAiSnapshot,
} from "../../contracts/local-ai.mjs";

const DEFAULT_ENDPOINT = "http://127.0.0.1:17865";
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 120000;
const DISPOSE_ABORT_REASON = "ordax-local-ai-disposed";
const LITERAL_LOOPBACK_ENDPOINT_RE = /^http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?(?:[/?#]|$)/;

function normalizeEndpoint(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Local AI endpoint must be literal 127.0.0.1 HTTP");
  }
  const raw = value.trim();
  // The Native Surface uses the already-authorized Host same-origin gateway.
  // No arbitrary relative URL, external origin or generic proxy is allowed.
  if (raw === LOCAL_AI_NATIVE_ENDPOINT) return raw;
  if (!LITERAL_LOOPBACK_ENDPOINT_RE.test(raw)) {
    throw new TypeError("Local AI endpoint must be literal 127.0.0.1 HTTP");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Local AI endpoint must be literal 127.0.0.1 HTTP");
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.username
    || url.password
  ) {
    throw new TypeError("Local AI endpoint must be literal 127.0.0.1 HTTP");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function timeoutMs(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 100 || selected > 300000) {
    throw new TypeError(`${label} must be between 100 and 300000 milliseconds`);
  }
  return selected;
}

function discoveredModelId(value) {
  try {
    return validateLocalAiModelId(value);
  } catch {
    return null;
  }
}

function singleDiscoveredModelId(payload) {
  const models = payload?.data;
  if (
    !Array.isArray(models)
    || models.length !== 1
    || !models[0]
    || typeof models[0] !== "object"
    || Array.isArray(models[0])
  ) {
    return null;
  }
  return discoveredModelId(models[0].id);
}

function declaredContentLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (typeof raw !== "string" || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
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
    // Status-only callers do not need a response body. Cancellation failure must
    // not replace the actual HTTP status/health decision.
  }
}

async function readBoundedJson(response, maxBytes, label) {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > maxBytes) {
    throw new Error(`${label} exceeds its byte limit`);
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
        throw new Error(`${label} returned an invalid response body`);
      }
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(`${label} exceeds its byte limit`);
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
      throw new Error(`${label} is not valid UTF-8`);
    }
    return parseJsonText(text, label);
  }

  // A real Fetch Response always has a body property. If it cannot expose a
  // readable stream, fail closed instead of buffering it through text()/json().
  if (response && typeof response === "object" && "body" in response) {
    throw new Error(`${label} does not expose a bounded response stream`);
  }

  // Test doubles may expose only json(). Production window.fetch responses take
  // the stream-bounded path above or fail closed.
  if (typeof response?.json === "function") return response.json();
  throw new Error(`${label} returned an unreadable response body`);
}

async function fetchWithTimeout(
  fetchImpl,
  url,
  options,
  milliseconds,
  label,
  activeControllers,
  consume = null,
) {
  const controller = new AbortController();
  activeControllers.add(controller);
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return consume === null ? response : await consume(response);
  } catch (error) {
    if (controller.signal.aborted) {
      if (controller.signal.reason === DISPOSE_ABORT_REASON) {
        throw new Error("Local AI runtime is disposed");
      }
      throw new Error(`${label} timed out after ${milliseconds}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    activeControllers.delete(controller);
  }
}

export function createLocalAiRuntime({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_ENDPOINT,
  engineId = "llama.cpp",
  modelId = null,
  probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  inferenceTimeoutMs = DEFAULT_INFERENCE_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Local AI runtime requires fetch");
  }
  const base = normalizeEndpoint(endpoint);
  const activeEngineId = validateLocalAiEngineId(engineId);
  const configuredModelId = modelId == null ? null : validateLocalAiModelId(modelId);
  let activeModelId = configuredModelId;
  const probeTimeout = timeoutMs(probeTimeoutMs, DEFAULT_PROBE_TIMEOUT_MS, "Local AI probe timeout");
  const inferenceTimeout = timeoutMs(
    inferenceTimeoutMs,
    DEFAULT_INFERENCE_TIMEOUT_MS,
    "Local AI inference timeout",
  );
  let snapshot = validateLocalAiSnapshot({
    schema: LOCAL_AI_PORT_SCHEMA,
    state: activeModelId ? "stopped" : "unavailable",
    engineId: activeModelId ? activeEngineId : null,
    modelId: activeModelId,
    offline: true,
    migratable: true,
  });
  const listeners = new Set();
  const activeControllers = new Set();
  let destroyed = false;
  let activityRevision = 0;
  let probeRevision = 0;

  const assertAlive = () => {
    if (destroyed) throw new Error("Local AI runtime is disposed");
  };

  const publish = (next) => {
    if (destroyed) return;
    snapshot = validateLocalAiSnapshot(next);
    for (const listener of listeners) listener(snapshot);
  };

  const requestStatus = (url, options, milliseconds, label) => fetchWithTimeout(
    fetchImpl,
    url,
    options,
    milliseconds,
    label,
    activeControllers,
    async (response) => {
      cancelResponseBody(response);
      return response;
    },
  );

  const requestJson = (url, options, milliseconds, label, maxBytes) => fetchWithTimeout(
    fetchImpl,
    url,
    options,
    milliseconds,
    label,
    activeControllers,
    async (response) => {
      if (!response.ok) {
        cancelResponseBody(response);
        return Object.freeze({ response, payload: null });
      }
      return Object.freeze({
        response,
        payload: await readBoundedJson(response, maxBytes, `${label} response`),
      });
    },
  );

  const discoverModel = async (label) => {
    const { response, payload } = await requestJson(
      base + "/v1/models",
      {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
      },
      probeTimeout,
      label,
      LOCAL_AI_MAX_MODEL_DISCOVERY_BYTES,
    );
    if (!response.ok) return null;
    return singleDiscoveredModelId(payload);
  };

  const revalidateAfterInferenceFailure = async () => {
    if (destroyed) return;
    let refreshedDynamicIdentity = configuredModelId !== null;
    try {
      if (configuredModelId === null) {
        const discovered = await discoverModel("Local AI failure model rediscovery");
        if (destroyed) return;
        if (discovered === null) {
          activeModelId = null;
          publish({
            schema: LOCAL_AI_PORT_SCHEMA,
            state: "unavailable",
            engineId: null,
            modelId: null,
            offline: true,
            migratable: true,
          });
          return;
        }
        activeModelId = discovered;
        refreshedDynamicIdentity = true;
      }

      const response = await requestStatus(
        base + "/health",
        {
          method: "GET",
          cache: "no-store",
          credentials: "omit",
        },
        probeTimeout,
        "Local AI failure health probe",
      );
      publish({
        schema: LOCAL_AI_PORT_SCHEMA,
        state: response.ok ? "ready" : "error",
        engineId: activeEngineId,
        modelId: activeModelId,
        offline: true,
        migratable: true,
      });
    } catch {
      if (destroyed) return;
      if (configuredModelId === null && !refreshedDynamicIdentity) {
        activeModelId = null;
        publish({
          schema: LOCAL_AI_PORT_SCHEMA,
          state: "unavailable",
          engineId: null,
          modelId: null,
          offline: true,
          migratable: true,
        });
        return;
      }
      publish({
        schema: LOCAL_AI_PORT_SCHEMA,
        state: activeModelId ? "stopped" : "unavailable",
        engineId: activeModelId ? activeEngineId : null,
        modelId: activeModelId,
        offline: true,
        migratable: true,
      });
    }
  };

  return Object.freeze({
    schema: LOCAL_AI_PORT_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Local AI listener must be a function");
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async probe() {
      assertAlive();
      if (snapshot.state === "busy") return snapshot;
      const currentProbe = ++probeRevision;
      const activityAtStart = activityRevision;
      const probeIsCurrent = () => (
        !destroyed
        && currentProbe === probeRevision
        && activityAtStart === activityRevision
      );
      let refreshedDynamicIdentity = configuredModelId !== null;
      try {
        if (configuredModelId === null) {
          const discovered = await discoverModel("Local AI model discovery");
          if (!probeIsCurrent()) return snapshot;
          if (discovered === null) {
            activeModelId = null;
            publish({
              schema: LOCAL_AI_PORT_SCHEMA,
              state: "unavailable",
              engineId: null,
              modelId: null,
              offline: true,
              migratable: true,
            });
            return snapshot;
          }
          activeModelId = discovered;
          refreshedDynamicIdentity = true;
        }

        const response = await requestStatus(
          base + "/health",
          {
            method: "GET",
            cache: "no-store",
            credentials: "omit",
          },
          probeTimeout,
          "Local AI health probe",
        );
        if (!probeIsCurrent()) return snapshot;
        publish({
          schema: LOCAL_AI_PORT_SCHEMA,
          state: response.ok ? "ready" : "error",
          engineId: activeEngineId,
          modelId: activeModelId,
          offline: true,
          migratable: true,
        });
      } catch (error) {
        if (destroyed) throw error;
        if (!probeIsCurrent()) return snapshot;
        if (configuredModelId === null && !refreshedDynamicIdentity) {
          publish({
            schema: LOCAL_AI_PORT_SCHEMA,
            state: "unavailable",
            engineId: null,
            modelId: null,
            offline: true,
            migratable: true,
          });
          return snapshot;
        }
        publish({
          schema: LOCAL_AI_PORT_SCHEMA,
          state: activeModelId ? "stopped" : "unavailable",
          engineId: activeModelId ? activeEngineId : null,
          modelId: activeModelId,
          offline: true,
          migratable: true,
        });
      }
      return snapshot;
    },
    async generate(requestValue) {
      assertAlive();
      const input = validateLocalAiRequest(requestValue);
      if (snapshot.state !== "ready") {
        throw new Error("Local AI is not ready");
      }
      activityRevision += 1;
      publish({ ...snapshot, state: "busy" });
      try {
        const messages = input.systemPrompt === null
          ? [{ role: "user", content: input.prompt }]
          : [
              { role: "system", content: input.systemPrompt },
              { role: "user", content: input.prompt },
            ];
        const { response, payload } = await requestJson(
          base + "/v1/chat/completions",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            credentials: "omit",
            body: JSON.stringify({
              model: activeModelId,
              messages,
              max_tokens: input.maxTokens,
              stream: false,
            }),
          },
          inferenceTimeout,
          "Local AI inference",
          LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES,
        );
        if (!response.ok) throw new Error(`Local AI inference failed: HTTP ${response.status}`);
        // Some OpenAI-compatible backends report the model that actually served
        // a completion. Do not assert the requested model as a verified result
        // when the server explicitly reports a different identity.
        if (
          payload?.model !== undefined
          && payload?.model !== null
          && validateLocalAiModelId(payload.model) !== activeModelId
        ) {
          throw new Error("Local AI completion model identity mismatch");
        }
        const text = validateLocalAiResponseText(payload?.choices?.[0]?.message?.content);
        publish({ ...snapshot, state: "ready" });
        return Object.freeze({ text, engineId: activeEngineId, modelId: activeModelId });
      } catch (error) {
        if (!destroyed) await revalidateAfterInferenceFailure();
        throw error;
      }
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      activityRevision += 1;
      probeRevision += 1;
      for (const controller of activeControllers) {
        controller.abort(DISPOSE_ABORT_REASON);
      }
      activeControllers.clear();
      listeners.clear();
    },
  });
}
