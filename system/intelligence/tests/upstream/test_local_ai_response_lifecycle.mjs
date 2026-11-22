// Regression adapted from ordax-os/tests/test_local_ai_response_lifecycle.mjs @ c07ec6082dd4ea08bd5fa06c12ba812f74cbf12e
import assert from "node:assert/strict";
import test from "node:test";

import { createLocalAiRuntime } from "./runtime-adapter.mjs";
import * as localAi from "../../../../system/contracts/local-ai.mjs";
import { bindLocalAiStreamContracts } from "../../src/index.mjs";

const { readLocalAiCompletionStream } = bindLocalAiStreamContracts(localAi);

function cancellableResponse(status, onCancel, headers = {}) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("unused"));
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(stream, { status, headers });
}

test("Local AI health probe cancels an unused response body", async () => {
  let cancelled = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (!url.endsWith("/health")) throw new Error("unexpected request");
      return cancellableResponse(200, () => { cancelled += 1; });
    },
  });

  const snapshot = await runtime.probe();
  assert.equal(snapshot.state, "ready");
  assert.equal(cancelled, 1);
});

test("Local AI cancels a non-OK completion body before health revalidation", async () => {
  let healthCalls = 0;
  let cancelled = 0;
  const runtime = createLocalAiRuntime({
    modelId: "ordax-small",
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        return { ok: true };
      }
      if (url.endsWith("/v1/chat/completions")) {
        return cancellableResponse(500, () => { cancelled += 1; });
      }
      throw new Error("unexpected request");
    },
  });

  await runtime.probe();
  await assert.rejects(
    () => runtime.generate({ prompt: "teste" }),
    /HTTP 500/,
  );
  assert.equal(cancelled, 1);
  assert.equal(healthCalls, 2);
  assert.equal(runtime.getSnapshot().state, "ready");
});


test("streaming rejects invalid MIME and oversized headers without leaking the HTTP body", async t => {
  const cases = [
    { name: "invalid MIME", headers: { "content-type": "application/json" }, error: /text\/event-stream/ },
    {
      name: "declared content too large",
      headers: {
        "content-type": "text/event-stream",
        "content-length": String(localAi.LOCAL_AI_MAX_COMPLETION_RESPONSE_BYTES + 1),
      },
      error: /byte limit/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let canceled = 0;
      let healthChecks = 0;
      let deltas = 0;
      const runtime = createLocalAiRuntime({
        modelId: "ordax-small",
        fetchImpl: async (url) => {
          if (url.endsWith("/health")) {
            healthChecks += 1;
            return { ok: true };
          }
          return cancellableResponse(200, () => { canceled += 1; }, scenario.headers);
        },
      });
      try {
        await runtime.probe();
        await assert.rejects(runtime.generate({ prompt: "do not leak response" }, {
          onDelta() { deltas += 1; },
        }), scenario.error);
        assert.equal(canceled, 1, "rejected response must release its HTTP body");
        assert.equal(deltas, 0);
        assert.equal(healthChecks, 2, "failure revalidation must still run");
        assert.equal(runtime.getSnapshot().state, "ready");
      } finally {
        runtime.dispose();
      }
    });
  }
});

test("direct SSE port releases the response if its input is invalid or already cancelled", async t => {
  const cases = [
    { name: "missing callback", options: { modelId: "ordax-small" }, error: /requires onDelta/ },
    {
      name: "invalid model ID",
      options: { modelId: "bad\u0000id", onDelta() {} },
      error: /model/i,
    },
    {
      name: "already aborted signal",
      options: { modelId: "ordax-small", onDelta() {}, signal: AbortSignal.abort() },
      error: /cancelled/,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      let canceled = 0;
      const response = cancellableResponse(200, () => { canceled += 1; }, {
        "content-type": "text/event-stream",
      });
      await assert.rejects(readLocalAiCompletionStream(response, scenario.options), scenario.error);
      assert.equal(canceled, 1, "direct stream consumer must release the rejected body");
    });
  }
});
