import { requireContractPort } from "../contract-bindings.mjs";
import { bindLocalAiStreamContracts } from "./completion-stream.mjs";
import { notifySnapshotListeners } from "../snapshot-notification.mjs";

export function bindLocalAiContracts(localAi) {
  requireContractPort("localAi",localAi,"LOCAL_AI_PORT_SCHEMA","ordax.local-ai/1",["validateLocalAiEngineId","validateLocalAiModelId","validateLocalAiRequest","validateLocalAiResponseText","validateLocalAiSnapshot"]);
  const { LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES, LOCAL_AI_MAX_MODEL_DISCOVERY_BYTES, LOCAL_AI_PORT_SCHEMA, LOCAL_AI_NATIVE_ENDPOINT, validateLocalAiEngineId, validateLocalAiModelId, validateLocalAiRequest, validateLocalAiResponseText, validateLocalAiSnapshot } = localAi;
  const { readLocalAiCompletionStream } = bindLocalAiStreamContracts(localAi);
  // Source: ordaxsystems/ordax-os/system/services/local-ai/runtime.mjs @ 8660cb9e0af12f0bd6ea834c69bab0476b469260; extracted without OS-private imports.
const DEFAULT_ENDPOINT = "http://127.0.0.1:17865";
const DEFAULT_PROBE_TIMEOUT_MS = 3000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 120000;
const DISPOSE_ABORT_REASON = "ordax-local-ai-disposed";
const REQUEST_ABORT_REASON = "ordax-local-ai-request-cancelled";

function assertInferenceSignal(signal) {
  if (signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("Local AI inference signal must be an AbortSignal");
  }
  if (signal?.aborted) throw new Error("Local AI inference request cancelled");
}
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

// Buffered completion must enforce the same consultative, text-only boundary
// as the SSE reader. Validating text alone would silently accept tool calls or
// a truncated answer while reporting a successful inference.
function validatedBufferedCompletion(payload) {
  const choices = payload?.choices;
  if (!Array.isArray(choices) || choices.length !== 1) {
    throw new Error("Local AI completion is invalid or contains unsupported tool authority");
  }
  const choice = choices[0];
  const message = choice?.message;
  if (
    !choice || typeof choice !== "object" || Array.isArray(choice)
    || (choice.index !== undefined && choice.index !== 0)
    // Without a terminal stop marker, buffered text has not been verified as complete.
    || choice.finish_reason !== "stop"
    || !message || typeof message !== "object" || Array.isArray(message)
    || (message.role !== undefined && message.role !== "assistant")
    || message.tool_calls !== undefined
    || message.function_call !== undefined
    || message.tool_call_id !== undefined
    || message.refusal !== undefined
    || choice.tool_calls !== undefined
    || choice.function_call !== undefined
    || choice.tool_call_id !== undefined
    || choice.refusal !== undefined
    || choice.delta !== undefined
  ) {
    throw new Error("Local AI completion is invalid or contains unsupported tool authority");
  }
  return validateLocalAiResponseText(message.content);
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

async function readBoundedJson(response, maxBytes, label, signal = null) {
  const declared = declaredContentLength(response);
  if (declared !== null && declared > maxBytes) {
    cancelResponseBody(response);
    throw new Error(`${label} exceeds its byte limit`);
  }

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let complete = false;
    // Readers from external Fetch adapters may ignore abort or return a
    // never-settling cancel() Promise. Cancellation must not hang health.
    const cancelReader = () => {
      try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    };
    signal?.addEventListener("abort", cancelReader, { once: true });
    try {
      if (signal?.aborted) throw new Error(`${label} was cancelled`);
      while (true) {
        const { done, value } = await reader.read();
        if (signal?.aborted) throw new Error(`${label} was cancelled`);
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw new Error(`${label} returned an invalid response body`);
        }
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`${label} exceeds its byte limit`);
        }
        chunks.push(value);
      }
      complete = true;
    } finally {
      signal?.removeEventListener("abort", cancelReader);
      if (!complete) cancelReader();
      try { reader.releaseLock(); } catch {}
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
  requestSignal = null,
) {
  const controller = new AbortController();
  const abortRequest = () => controller.abort(REQUEST_ABORT_REASON);
  // The caller's cancellation must not cancel unrelated probes or requests.
  if (requestSignal !== null) {
    assertInferenceSignal(requestSignal);
    requestSignal.addEventListener("abort", abortRequest, { once: true });
    if (requestSignal.aborted) abortRequest();
  }
  activeControllers.add(controller);
  // A nonconforming HTTP adapter may never settle fetch(), reader.read() or
  // json() after AbortSignal fires. Race the complete operation, not only the
  // initial HTTP headers, so timeout and dispose remain effective.
  let rejectAborted;
  const aborted = new Promise((_, reject) => { rejectAborted = reject; });
  let activeResponse = null;
  const rejectOnAbort = () => {
    rejectAborted(new Error(`${label} aborted`));
    if (activeResponse !== null) cancelResponseBody(activeResponse);
  };
  controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    if (controller.signal.aborted) throw new Error("Local AI inference request cancelled");
    // The URL gate protects only the initial destination. Fetch follows
    // HTTP redirects by default, allowing a local server to reroute a
    // prompt or probe to another origin. Refuse redirects at the transport.
    const pendingFetch = Promise.resolve().then(() => fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    }));
    // Even after the timeout/abort race rejects, a noncooperative adapter
    // can deliver headers later. Close that body rather than leaving an
    // orphaned response/connection behind. Never await this late cleanup.
    void pendingFetch.then(
      (lateResponse) => {
        if (controller.signal.aborted) cancelResponseBody(lateResponse);
      },
      () => {},
    );
    const response = await Promise.race([pendingFetch, aborted]);
    activeResponse = response;
    if (controller.signal.aborted) throw new Error("Local AI inference request cancelled");
    // Also refuse a nonstandard injected adapter that reports a followed
    // redirect even though the request explicitly prohibited it.
    if (response?.redirected === true) {
      cancelResponseBody(response);
      throw new Error(`${label} returned a redirected response`);
    }
    const value = consume === null ? response : await Promise.race([
      Promise.resolve().then(() => consume(response, controller.signal)),
      aborted,
    ]);
    // Also reject if an adapter ignores the abort signal and responds late.
    if (controller.signal.aborted) throw new Error("Local AI inference request cancelled");
    return value;
  } catch (error) {
    if (controller.signal.aborted) {
      if (controller.signal.reason === DISPOSE_ABORT_REASON) {
        throw new Error("Local AI runtime is disposed");
      }
      if (controller.signal.reason === REQUEST_ABORT_REASON) {
        throw new Error("Local AI inference request cancelled");
      }
      throw new Error(`${label} timed out after ${milliseconds}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", rejectOnAbort);
    requestSignal?.removeEventListener("abort", abortRequest);
    activeControllers.delete(controller);
  }
}

function createLocalAiRuntime({
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
    notifySnapshotListeners(listeners, snapshot);
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

  const requestJson = (url, options, milliseconds, label, maxBytes, requestSignal = null) => fetchWithTimeout(
    fetchImpl,
    url,
    options,
    milliseconds,
    label,
    activeControllers,
    async (response, controllerSignal) => {
      if (!response.ok) {
        cancelResponseBody(response);
        return Object.freeze({ response, payload: null });
      }
      return Object.freeze({
        response,
        payload: await readBoundedJson(response, maxBytes, `${label} response`, controllerSignal),
      });
    },
    requestSignal,
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
      // Discovery is provisional until health and probe revision are verified.
      // Publishing a new model ID early would let concurrent inference send
      // a prompt under the previous ready snapshot to an unverified model.
      let candidateModelId = activeModelId;
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
          candidateModelId = discovered;
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
        if (configuredModelId === null) activeModelId = candidateModelId;
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
        if (configuredModelId === null) activeModelId = candidateModelId;
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
    async generate(requestValue, { signal = null, onDelta = null } = {}) {
      assertAlive();
      const input = validateLocalAiRequest(requestValue);
      assertInferenceSignal(signal);
      if (onDelta !== null && typeof onDelta !== "function") {
        throw new TypeError("Local AI onDelta must be a function");
      }
      if (snapshot.state !== "ready") {
        throw new Error("Local AI is not ready");
      }
      activityRevision += 1;
      publish({ ...snapshot, state: "busy" });
      // A subscriber may synchronously dispose the runtime on busy.
      // Never initiate HTTP after disposal has been requested.
      assertAlive();
      try {
        const messages = input.systemPrompt === null
          ? [{ role: "user", content: input.prompt }]
          : [
              { role: "system", content: input.systemPrompt },
              { role: "user", content: input.prompt },
            ];
        const options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          credentials: "omit",
          body: JSON.stringify({
            model: activeModelId,
            messages,
            max_tokens: input.maxTokens,
            stream: onDelta !== null,
          }),
        };
        const url = base + "/v1/chat/completions";
        const label = "Local AI inference";
        let text;
        if (onDelta === null) {
          const { response, payload } = await requestJson(
            url, options, inferenceTimeout, label,
            LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES, signal,
          );
          if (!response.ok) throw new Error(`Local AI inference failed: HTTP ${response.status}`);
          // OpenAI-compatible backends can report the actual serving model.
          if (
            payload?.model !== undefined
            && payload?.model !== null
            && validateLocalAiModelId(payload.model) !== activeModelId
          ) {
            throw new Error("Local AI completion model identity mismatch");
          }
          text = validatedBufferedCompletion(payload);
        } else {
          text = await fetchWithTimeout(
            fetchImpl, url, options, inferenceTimeout, label, activeControllers,
            async (response, transportSignal) => {
              if (!response.ok) {
                cancelResponseBody(response);
                throw new Error(`Local AI inference failed: HTTP ${response.status}`);
              }
              return readLocalAiCompletionStream(response, {
                modelId: activeModelId,
                onDelta,
                signal: transportSignal,
              });
            },
            signal,
          );
        }
        publish({ ...snapshot, state: "ready" });
        // Ready subscribers may also dispose synchronously. A disposed
        // runtime must never return a newly approved inference result.
        assertAlive();
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

  return Object.freeze({ createLocalAiRuntime });
}
