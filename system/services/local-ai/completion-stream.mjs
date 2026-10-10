import {
  LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES,
  LOCAL_AI_MAX_RESPONSE_CHARS,
  validateLocalAiModelId,
  validateLocalAiResponseText,
} from "../../contracts/local-ai.mjs";

const MAX_STREAM_EVENTS = 16384;

// OpenAI-compatible, data-only SSE. Tokens are tentative until [DONE] and
// finish_reason are checked; callers must not persist or execute partial text.
export async function readLocalAiCompletionStream(response, { modelId, onDelta } = {}) {
  if (typeof onDelta !== "function") {
    throw new TypeError("Local AI streaming requires onDelta()");
  }
  const expectedModel = validateLocalAiModelId(modelId);
  const mime = response?.headers?.get?.("content-type");
  if (typeof mime !== "string" || !/^text\/event-stream(?:\s*;|\s*$)/i.test(mime.trim())) {
    throw new Error("Local AI streaming requires text/event-stream");
  }
  const rawLength = response.headers.get("content-length");
  if (typeof rawLength === "string" && /^\d+$/.test(rawLength.trim())) {
    if (Number(rawLength) > LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES) {
      throw new Error("Local AI streaming response exceeds its byte limit");
    }
  }
  const body = response.body;
  if (!body || typeof body.getReader !== "function") {
    throw new Error("Local AI streaming requires a bounded response stream");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let partial = "";
  let data = [];
  let result = "";
  let ended = false;
  let finished = false;
  let events = 0;
  let succeeded = false;

  const processEvent = async () => {
    if (data.length === 0) return;
    const frame = data.join("\n");
    data = [];
    if (ended) throw new Error("Local AI streaming received data after [DONE]");
    if (frame.trim() === "[DONE]") {
      if (!finished) throw new Error("Local AI streaming ended before finish_reason");
      ended = true;
      return;
    }
    events += 1;
    if (events > MAX_STREAM_EVENTS) {
      throw new Error("Local AI streaming exceeds its event limit");
    }
    let chunk;
    try {
      chunk = JSON.parse(frame);
    } catch {
      throw new Error("Local AI streaming event is not valid JSON");
    }
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) {
      throw new Error("Local AI streaming event must be an object");
    }
    if (chunk.model !== undefined && chunk.model !== null
      && validateLocalAiModelId(chunk.model) !== expectedModel) {
      throw new Error("Local AI streaming model identity mismatch");
    }
    if (!Array.isArray(chunk.choices) || chunk.choices.length !== 1) {
      throw new Error("Local AI streaming must return exactly one choice");
    }
    const choice = chunk.choices[0];
    if (!choice || typeof choice !== "object" || Array.isArray(choice)
      || (choice.index !== undefined && choice.index !== 0)) {
      throw new Error("Local AI streaming choice is invalid");
    }
    if (!choice.delta || typeof choice.delta !== "object" || Array.isArray(choice.delta)
      || choice.delta.role && choice.delta.role !== "assistant"
      || choice.delta.tool_calls !== undefined
      || choice.delta.function_call !== undefined
      || choice.message !== undefined) {
      throw new Error("Local AI streaming accepts assistant text only");
    }
    if (finished) throw new Error("Local AI streaming received another chunk after finish");
    const reason = choice.finish_reason;
    if (reason !== undefined && reason !== null) {
      if (!["stop", "length"].includes(reason)) {
        throw new Error("Local AI streaming finish reason is invalid");
      }
      finished = true;
    }
    const delta = choice.delta.content;
    if (delta === undefined || delta === null || delta === "") return;
    if (typeof delta !== "string" || delta.includes("\0")
      || result.length + delta.length > LOCAL_AI_MAX_RESPONSE_CHARS) {
      throw new Error("Local AI streaming text exceeds its bounds");
    }
    result += delta;
    // Deliberately await the consumer to apply backpressure and preserve order.
    // Emissions are provisional until the final verified result is returned.
    await onDelta(delta);
  };

  const processLine = async (line) => {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") {
      await processEvent();
    } else if (line.startsWith(":")) {
      // SSE keepalive comments do not change the inference transcript.
    } else if (line.startsWith("data:")) {
      if (ended) throw new Error("Local AI streaming received data after [DONE]");
      data.push(line.slice(5).replace(/^ /, ""));
    } else {
      throw new Error("Local AI streaming contains an unsupported SSE field");
    }
  };

  const receive = async (text) => {
    partial += text;
    if (partial.length > LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES) {
      throw new Error("Local AI streaming event exceeds its byte limit");
    }
    while (true) {
      const newline = partial.indexOf("\n");
      if (newline === -1) break;
      const line = partial.slice(0, newline);
      partial = partial.slice(newline + 1);
      await processLine(line);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new Error("Local AI streaming response contains invalid bytes");
      }
      bytes += value.byteLength;
      if (bytes > LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES) {
        throw new Error("Local AI streaming response exceeds its byte limit");
      }
      await receive(decoder.decode(value, { stream: true }));
    }
    await receive(decoder.decode());
    if (partial.length > 0) {
      await processLine(partial);
    }
    await processEvent();
    if (!ended || !finished) {
      throw new Error("Local AI streaming ended without a verified [DONE]");
    }
    const text = validateLocalAiResponseText(result);
    succeeded = true;
    return text;
  } finally {
    if (!succeeded) {
      try { await reader.cancel(); } catch {}
    }
    reader.releaseLock();
  }
}
