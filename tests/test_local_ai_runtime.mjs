import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES,
  LOCAL_AI_MAX_MODEL_DISCOVERY_BYTES,
  LOCAL_AI_MAX_RESPONSE_CHARS,
} from "../system/contracts/local-ai.mjs";
import { createLocalAiRuntime } from "../system/services/local-ai/runtime.mjs";

function abortablePendingRequest(options = {}) {
  return new Promise((resolve, reject) => {
    const rejectAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (options.signal?.aborted) {
      rejectAbort();
      return;
    }
    options.signal?.addEventListener("abort", rejectAbort, { once: true });
  });
}

test("local AI discovers the active loopback model without Surface model coupling", async () => {
  const requests = [];
  const runtime = createLocalAiRuntime({
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          async json() {
            return { data: [{ id: "ordax-discovered-model" }] };
          },
        };
      }
      if (url.endsWith("/health")) return { ok: true };
      throw new Error("unexpected request");
    },
    modelId: null,
  });
  assert.equal(runtime.getSnapshot().state, "unavailable");
  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(runtime.getSnapshot().modelId, "ordax-discovered-model");
  assert.deepEqual(
    requests.map((url) => new URL(url).pathname),
    ["/v1/models", "/health"],
  );
});

test("local AI rejects oversized model-discovery envelope before accepting identity", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({
          data: [{ id: "would-have-been-valid" }],
          padding: "x".repeat(LOCAL_AI_MAX_MODEL_DISCOVERY_BYTES),
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      throw new Error("unexpected request");
    },
  });

  const snapshot = await runtime.probe();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.modelId, null);
  assert.equal(healthCalls, 0);
});

test("local AI fails closed when a fetch-like response cannot expose a bounded stream", async () => {
  let jsonCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: null,
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          body: null,
          async json() {
            jsonCalls += 1;
            return { data: [{ id: "must-not-be-read-unbounded" }] };
          },
        };
      }
      throw new Error("health must not be reached");
    },
  });

  const snapshot = await runtime.probe();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.modelId, null);
  assert.equal(jsonCalls, 0);
});

test("local AI rejects malformed discovered model identity without poisoning probe state", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    fetchImpl: async (url) => {
      if (url.endsWith("/v1/models")) {
        return {
          ok: true,
          async json() {
            return { data: [{ id: "bad\0model" }] };
          },
        };
      }
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      throw new Error("unexpected request");
    },
    modelId: null,
  });

  const snapshot = await runtime.probe();
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.modelId, null);
  assert.equal(snapshot.engineId, null);
  assert.equal(healthCalls, 0);
});

test("local AI validates configured engine and model identity before network work", () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return { ok: false };
  };

  assert.throws(
    () => createLocalAiRuntime({ fetchImpl, engineId: "", modelId: null }),
    /engineId is outside its allowed bounds/,
  );
  assert.throws(
    () => createLocalAiRuntime({ fetchImpl, engineId: "bad\0engine", modelId: null }),
    /engineId must be a string/,
  );
  assert.throws(
    () => createLocalAiRuntime({ fetchImpl, engineId: "llama.cpp", modelId: "bad\0model" }),
    /modelId must be a string/,
  );
  assert.throws(
    () => createLocalAiRuntime({ fetchImpl, engineId: "llama.cpp", modelId: "x".repeat(161) }),
    /modelId is outside its allowed bounds/,
  );
  assert.equal(fetchCalls, 0);
});

test("local AI remains unavailable when no loopback backend can be discovered", async () => {
  const runtime = createLocalAiRuntime({
    fetchImpl: async () => { throw new Error("backend absent"); },
    modelId: null,
  });
  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "unavailable");
  assert.equal(runtime.getSnapshot().offline, true);
  assert.equal(runtime.getSnapshot().migratable, true);
});

test("local AI probes loopback and separates system policy from user prompt", async () => {
  const requests = [];
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith("/health")) return { ok: true };
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "resposta local" } }] };
        },
      };
    },
  });
  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "ready");
  const result = await runtime.generate({
    systemPrompt: "política de sistema",
    prompt: "teste",
    maxTokens: 32,
  });
  assert.equal(result.text, "resposta local");
  assert.equal(requests.length, 2);
  assert.match(requests[0][0], /^http:\/\/127\.0\.0\.1:/);
  assert.match(requests[1][0], /\/v1\/chat\/completions$/);
  assert.equal(requests.every(([, options]) => options.signal instanceof AbortSignal), true);
  const body = JSON.parse(requests[1][1].body);
  assert.deepEqual(body.messages, [
    { role: "system", content: "política de sistema" },
    { role: "user", content: "teste" },
  ]);
});

test("local AI keeps backward-compatible user-only messages when no system prompt is supplied", async () => {
  let completionBody = null;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) return { ok: true };
      completionBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "ok" } }] };
        },
      };
    },
  });
  await runtime.probe();
  await runtime.generate({ prompt: "somente usuário" });
  assert.deepEqual(completionBody.messages, [
    { role: "user", content: "somente usuário" },
  ]);
});

test("local AI rejects oversized completion envelope before JSON parsing", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: "small valid completion" } }],
        padding: "x".repeat(LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  await runtime.probe();
  await assert.rejects(
    () => runtime.generate({ prompt: "teste" }),
    /Local AI inference response exceeds its byte limit/,
  );
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(healthCalls, 2);
});

test("local AI keeps inference timeout active while reading the completion body", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    inferenceTimeoutMs: 100,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":['));
          options.signal.addEventListener("abort", () => {
            controller.error(new Error("body aborted"));
          }, { once: true });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  await runtime.probe();
  await assert.rejects(
    () => runtime.generate({ prompt: "teste" }),
    /timed out after 100ms/,
  );
  assert.equal(runtime.getSnapshot().state, "ready");
  assert.equal(healthCalls, 2);
});

test("local AI rejects malformed or oversized completion text at the provider boundary", async () => {
  for (const invalidContent of [
    "bad\0completion",
    "x".repeat(LOCAL_AI_MAX_RESPONSE_CHARS + 1),
  ]) {
    let healthCalls = 0;
    const runtime = createLocalAiRuntime({
      modelId: "ordax-small",
      fetchImpl: async (url) => {
        if (url.endsWith("/health")) {
          healthCalls += 1;
          return { ok: true };
        }
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: invalidContent } }] };
          },
        };
      },
    });

    await runtime.probe();
    await assert.rejects(
      () => runtime.generate({ prompt: "teste" }),
      /Local AI response text/,
    );
    assert.equal(runtime.getSnapshot().state, "ready");
    assert.equal(healthCalls, 2);
  }
});

test("local AI inference timeout revalidates a healthy backend instead of leaving it bricked", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    inferenceTimeoutMs: 100,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      return abortablePendingRequest(options);
    },
  });
  await runtime.probe();
  await assert.rejects(
    () => runtime.generate({ prompt: "teste" }),
    /timed out after 100ms/,
  );
  assert.equal(healthCalls, 2);
  assert.equal(runtime.getSnapshot().state, "ready");
});

test("local AI inference failure degrades to stopped when backend health disappears", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls === 1) return { ok: true };
        throw new Error("backend down");
      }
      throw new Error("connection lost");
    },
  });
  await runtime.probe();
  await assert.rejects(
    () => runtime.generate({ prompt: "teste" }),
    /connection lost/,
  );
  assert.equal(runtime.getSnapshot().state, "stopped");
});

test("local AI probe does not reset a busy inference", async () => {
  let releaseCompletion;
  let healthCalls = 0;
  const completion = new Promise((resolve) => { releaseCompletion = resolve; });
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      await completion;
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: "ok" } }] };
        },
      };
    },
  });
  await runtime.probe();
  const generation = runtime.generate({ prompt: "teste" });
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().state, "busy");
  const duringBusy = await runtime.probe();
  assert.equal(duringBusy.state, "busy");
  assert.equal(healthCalls, 1);
  releaseCompletion();
  await generation;
  assert.equal(runtime.getSnapshot().state, "ready");
});

test("local AI dispose aborts active inference and refuses new work", async () => {
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) return { ok: true };
      return abortablePendingRequest(options);
    },
  });
  await runtime.probe();
  const generation = runtime.generate({ prompt: "teste" });
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().state, "busy");
  runtime.dispose();
  await assert.rejects(() => generation, /runtime is disposed/);
  await assert.rejects(() => runtime.probe(), /runtime is disposed/);
  await assert.rejects(() => runtime.generate({ prompt: "novo" }), /runtime is disposed/);
});

test("local AI probe timeout degrades without blocking the caller", async () => {
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    probeTimeoutMs: 100,
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) return abortablePendingRequest(options);
      throw new Error("unexpected request");
    },
  });
  await runtime.probe();
  assert.equal(runtime.getSnapshot().state, "stopped");
});

test("local AI rejects unsafe timeout configuration", () => {
  assert.throws(
    () => createLocalAiRuntime({ modelId: "x", probeTimeoutMs: 99 }),
    /probe timeout/,
  );
  assert.throws(
    () => createLocalAiRuntime({ modelId: "x", inferenceTimeoutMs: 300001 }),
    /inference timeout/,
  );
});

test("local AI rejects non-loopback endpoints", () => {
  assert.throws(
    () => createLocalAiRuntime({ endpoint: "https://example.com", modelId: "x" }),
    /literal 127\.0\.0\.1 HTTP/,
  );
});

test("local AI rejects a successful completion that reports a different model", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      return {
        ok: true,
        async json() {
          return {
            model: "unexpected-model",
            choices: [{ message: { content: "wrong model" } }],
          };
        },
      };
    },
  });
  await runtime.probe();
  await assert.rejects(
    () => runtime.generate({ prompt: "teste" }),
    /completion model identity mismatch/,
  );
  assert.equal(healthCalls, 2);
});

test("local AI accepts a completion reporting its configured model", async () => {
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return { ok: true };
      return {
        ok: true,
        async json() {
          return {
            model: "ordax-small",
            choices: [{ message: { content: "valid result" } }],
          };
        },
      };
    },
  });
  await runtime.probe();
  assert.equal((await runtime.generate({ prompt: "teste" })).text, "valid result");
});

test("Local AI pre-aborted inference does not issue any completion request", async () => {
  let completions = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return { ok: true };
      completions += 1;
      throw new Error("completion should not be sent");
    },
  });
  await runtime.probe();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runtime.generate({ prompt: "não enviar" }, { signal: controller.signal }),
    /request cancelled/,
  );
  assert.equal(completions, 0);
  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.dispose();
});

test("Local AI caller cancellation aborts only inference transport and rechecks health", async () => {
  let completionSignal = null;
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) { healthCalls += 1; return { ok: true }; }
      completionSignal = options.signal;
      return abortablePendingRequest(options);
    },
  });
  await runtime.probe();
  const controller = new AbortController();
  const pending = runtime.generate({ prompt: "interromper transporte" }, { signal: controller.signal });
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().state, "busy");
  assert.ok(completionSignal instanceof AbortSignal);
  controller.abort();
  await assert.rejects(pending, /request cancelled/);
  assert.equal(completionSignal.aborted, true);
  assert.equal(healthCalls, 2);
  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.dispose();
});

test("Local AI discards a late completion from a fetch adapter that ignores abort", async () => {
  let finish;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return { ok: true };
      return new Promise((resolve) => {
        finish = () => resolve({
          ok: true,
          async json() { return { choices: [{ message: { content: "late private answer" } }] }; },
        });
      });
    },
  });
  await runtime.probe();
  const controller = new AbortController();
  const pending = runtime.generate({ prompt: "cancelar" }, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  finish();
  await assert.rejects(pending, /request cancelled/);
  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.dispose();
});

function streamedCompletion(frames, { contentType = "text/event-stream; charset=utf-8", segments = null } = {}) {
  const encoded = new TextEncoder().encode(frames.join(""));
  const chunks = segments === null
    ? [encoded]
    : segments.map(([from, to]) => encoded.slice(from, to));
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": contentType } });
}

function streamFrame(content, { model = "ordax-small", finishReason = null } = {}) {
  return `data: ${JSON.stringify({
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  })}\n\n`;
}

test("Local AI opt-in SSE delivers ordered UTF-8 deltas and the verified final answer", async () => {
  const sent = [];
  let requestBody = null;
  const first = streamFrame("Olá ");
  const second = streamFrame("mundo", { finishReason: "stop" });
  const frames = [first, second, "data: [DONE]\r\n\r\n"];
  const joined = frames.join("").replaceAll("\n\n", "\r\n\r\n");
  const bytes = new TextEncoder().encode(joined);
  // Split in the middle of an accented UTF-8 character and SSE boundaries.
  const splitAt = bytes.findIndex((value) => value === 0xc3) + 1;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith("/health")) return { ok: true };
      requestBody = JSON.parse(options.body);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, splitAt));
          controller.enqueue(bytes.slice(splitAt, splitAt + 3));
          controller.enqueue(bytes.slice(splitAt + 3));
          controller.close();
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  await runtime.probe();
  const result = await runtime.generate({ prompt: "responda" }, {
    async onDelta(delta) {
      await Promise.resolve();
      sent.push(delta);
    },
  });
  assert.equal(requestBody.stream, true);
  assert.deepEqual(sent, ["Olá ", "mundo"]);
  assert.equal(result.text, "Olá mundo");
  assert.equal(result.engineId, "llama.cpp");
  assert.equal(result.modelId, "ordax-small");
  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.dispose();
});

test("Local AI streaming fails closed on incomplete or untrusted SSE frames", async () => {
  const cases = [
    {
      name: "no final [DONE]",
      frames: [streamFrame("primeiro", { finishReason: "stop" })],
      match: /verified \[DONE\]/,
    },
    {
      name: "no final finish_reason",
      frames: [streamFrame("primeiro"), "data: [DONE]\n\n"],
      match: /before finish_reason/,
    },
    {
      name: "mismatched backend model",
      frames: [streamFrame("primeiro", { model: "wrong-model" }), "data: [DONE]\n\n"],
      match: /model identity mismatch/,
    },
    {
      name: "tool call in stream",
      frames: [`data: ${JSON.stringify({
        model: "ordax-small",
        choices: [{ index: 0, delta: { tool_calls: [] }, finish_reason: "stop" }],
      })}\n\n`, "data: [DONE]\n\n"],
      match: /assistant text only/,
    },
    {
      name: "untrusted field",
      frames: ["event: action\n\n"],
      match: /unsupported SSE field/,
    },
    {
      name: "data after [DONE]",
      frames: [streamFrame("ok", { finishReason: "stop" }), "data: [DONE]\n\n", streamFrame("bad")],
      match: /after \[DONE\]/,
    },
  ];
  for (const { name, frames, match } of cases) {
    let healthCalls = 0;
    const deltas = [];
    const runtime = createLocalAiRuntime({
      modelId: "ordax-small",
      fetchImpl: async (url) => {
        if (url.endsWith("/health")) { healthCalls += 1; return { ok: true }; }
        return streamedCompletion(frames);
      },
    });
    await runtime.probe();
    await assert.rejects(() => runtime.generate({ prompt: "teste" }, {
      onDelta(delta) { deltas.push(delta); },
    }), match, name);
    assert.equal(runtime.getSnapshot().state, "ready", name);
    assert.equal(healthCalls, 2, name);
    runtime.dispose();
  }
});

test("Local AI streaming rejects missing SSE MIME and mismatched model before emitting text", async () => {
  let delivered = 0;
  for (const mode of ["mime", "model"]) {
    const runtime = createLocalAiRuntime({
      modelId: "ordax-small",
      fetchImpl: async (url) => {
        if (url.endsWith("/health")) return { ok: true };
        return streamedCompletion([streamFrame("not delivered", {
          model: mode === "model" ? "wrong-model" : "ordax-small",
          finishReason: "stop",
        }), "data: [DONE]\n\n"], {
          contentType: mode === "mime" ? "application/json" : "text/event-stream",
        });
      },
    });
    await runtime.probe();
    await assert.rejects(() => runtime.generate({ prompt: "teste" }, {
      onDelta() { delivered += 1; },
    }), mode === "mime" ? /text\/event-stream/ : /model identity mismatch/);
    runtime.dispose();
  }
  assert.equal(delivered, 0);
});

test("Local AI streaming enforces raw byte limits and rejects invalid onDelta before HTTP", async () => {
  let completes = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return { ok: true };
      completes += 1;
      return streamedCompletion([": x\n\n".repeat(270000)]);
    },
  });
  await runtime.probe();
  await assert.rejects(() => runtime.generate({ prompt: "teste" }, {
    onDelta: "not-a-function",
  }), /onDelta must be a function/);
  assert.equal(completes, 0);
  await assert.rejects(() => runtime.generate({ prompt: "teste" }, {
    onDelta() {},
  }), /byte limit/);
  assert.equal(completes, 1);
  runtime.dispose();
});

test("Local AI streaming propagates onDelta callback failures and suppresses late result", async () => {
  let healthCalls = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) { healthCalls += 1; return { ok: true }; }
      return streamedCompletion([streamFrame("provisório"), streamFrame("restante", {
        finishReason: "stop",
      }), "data: [DONE]\n\n"]);
    },
  });
  await runtime.probe();
  await assert.rejects(() => runtime.generate({ prompt: "teste" }, {
    onDelta() { throw new Error("consumer refused the partial output"); },
  }), /consumer refused/);
  assert.equal(healthCalls, 2);
  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.dispose();
});

test("Local AI streaming signal cancellation does not convert partial tokens into a result", async () => {
  const controller = new AbortController();
  const pieces = [];
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return { ok: true };
      return streamedCompletion([streamFrame("parte"), streamFrame("seguinte", {
        finishReason: "stop",
      }), "data: [DONE]\n\n"]);
    },
  });
  await runtime.probe();
  await assert.rejects(() => runtime.generate({ prompt: "teste" }, {
    signal: controller.signal,
    onDelta(delta) {
      pieces.push(delta);
      controller.abort();
    },
  }), /request cancelled/);
  assert.deepEqual(pieces, ["parte"]);
  assert.equal(runtime.getSnapshot().state, "ready");
  runtime.dispose();
});
