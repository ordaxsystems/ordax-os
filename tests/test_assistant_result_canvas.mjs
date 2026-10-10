import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createAssistantConversationRuntime } from "../system/apps/assistant/conversation.mjs";
import {
  ASSISTANT_RESULT_CANVAS_SCHEMA,
  projectAssistantResultCanvas,
} from "../system/apps/assistant/ui/result-view-model.mjs";

const ready = {
  schema: "ordax.assistant-conversation/1", state: "ready",
  messages: [], lastError: null, inferencePending: false,
  authority: "none", toolExecution: false, persistence: "session",
};
const answer = {
  id: "assistant-message-2", role: "assistant",
  text: "Resposta confirmada pelo runtime", engineId: "llama.cpp", modelId: "qwen",
};
const prompt = {
  id: "assistant-message-1", role: "user", text: "Olá",
  engineId: null, modelId: null,
};

test("command-first idle and real unavailability do not synthesize a result", () => {
  const idle = projectAssistantResultCanvas(ready);
  assert.equal(idle.schema, ASSISTANT_RESULT_CANVAS_SCHEMA);
  assert.equal(idle.state, "idle");
  assert.deepEqual(idle.blocks, []);
  assert.deepEqual(idle.steps, []);
  assert.equal(idle.completionPercent, null);
  assert.equal(idle.authority, "none");
  const unavailable = projectAssistantResultCanvas({ ...ready, state: "unavailable" });
  assert.equal(unavailable.state, "unavailable");
  assert.deepEqual(unavailable.blocks, []);
});

test("actual committed Assistant model response becomes only a plain-text canvas block", () => {
  const content = "<script>alert(1)</script> ![file](https://wrong.invalid) \\n1,2,3";
  const view = projectAssistantResultCanvas({
    ...ready, messages: [prompt, { ...answer, text: content }],
  });
  assert.equal(view.state, "result");
  assert.equal(view.resultMessageId, answer.id);
  assert.deepEqual(view.blocks, [{
    kind: "text", text: content,
    provenance: { engineId: "llama.cpp", modelId: "qwen" },
  }]);
  assert.equal(view.history.length, 2);
  assert.equal(view.steps.length, 0);
  assert.equal(view.completionPercent, null);
  assert.equal(view.toolExecution, false);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.blocks[0]));
  assert.equal("html" in view.blocks[0], false);
  assert.equal("url" in view.blocks[0], false);
});

test("pending, discarded, error and unanswered next turn do not expose previous answer as new", () => {
  const previous = [prompt, answer];
  assert.equal(projectAssistantResultCanvas({
    ...ready, messages: [...previous, { ...prompt, id: "assistant-message-3" }],
    inferencePending: true, state: "busy",
  }).state, "working");
  const newer = projectAssistantResultCanvas({
    ...ready, messages: [...previous, { ...prompt, id: "assistant-message-3" }],
  });
  assert.equal(newer.state, "unavailable");
  assert.deepEqual(newer.blocks, []);
  const discarded = projectAssistantResultCanvas({
    ...ready, messages: previous, lastError: "response-discarded",
  });
  assert.equal(discarded.state, "failed");
  assert.deepEqual(discarded.blocks, []);
  assert.equal(projectAssistantResultCanvas({ ...ready, state: "error" }).state, "failed");
});

test("untrusted or oversized messages, unauthorized snapshots and unknown schemas fail closed", () => {
  for (const snapshot of [
    { ...ready, schema: "unknown/2" },
    { ...ready, authority: "execute" },
    { ...ready, toolExecution: true },
    { ...ready, persistence: "device" },
    { ...ready, messages: "text" },
    { ...ready, messages: [prompt, { ...answer, id: prompt.id }] },
    { ...ready, messages: [prompt, { ...answer, modelId: null }] },
    { ...ready, messages: [prompt, { ...answer, text: "x".repeat(65537) }] },
    { ...ready, messages: Array.from({ length: 25 }, (_, index) => ({
      ...prompt, id: `assistant-message-${index + 1}`,
    })) },
  ]) {
    assert.throws(() => projectAssistantResultCanvas(snapshot));
  }
});

function observable(schema, value) {
  const listeners = new Set();
  let snapshot = value;
  return {
    schema, getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

test("real Assistant conversation port produces a canvas and loses it on owner/Space change", async () => {
  const identity = observable("ordax.identity-session/1", {
    state: "signed-out", subjectId: null, displayName: null,
  });
  const spaces = observable("ordax.space-selection/1", {
    schema: "ordax.space-selection/1", state: "unavailable",
  });
  const intelligence = {
    schema: "ordax.intelligence/1",
    getSnapshot() {
      return {
        schema: "ordax.intelligence/1", state: "ready",
        inferenceAvailable: true, engineId: "llama.cpp", modelId: "qwen",
        authority: "none", toolExecution: false,
      };
    },
    subscribe: () => () => {},
    async respond() {
      return {
        schema: "ordax.intelligence-response/1",
        text: "Resposta de teste local", engineId: "llama.cpp", modelId: "qwen",
        authority: "none",
      };
    },
  };
  const runtime = createAssistantConversationRuntime({
    identitySessionPort: identity, spaceSelectionPort: spaces,
    intelligencePort: intelligence,
  });
  try {
    assert.equal(projectAssistantResultCanvas(runtime.getSnapshot()).state, "idle");
    await runtime.send("Teste autorizado");
    const result = projectAssistantResultCanvas(runtime.getSnapshot());
    assert.equal(result.state, "result");
    assert.equal(result.blocks[0].text, "Resposta de teste local");
    identity.update({ state: "signed-in", subjectId: "owner-a", displayName: "Conta" });
    const changed = projectAssistantResultCanvas(runtime.getSnapshot());
    assert.equal(changed.state, "unavailable");
    assert.deepEqual(changed.blocks, []);
    assert.deepEqual(changed.history, []);
  } finally {
    runtime.dispose();
  }
});

test("Assistant UI uses only safe textContent and existing send/discard; no fake file, audio or action path", async () => {
  const source = await readFile(
    new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8",
  );
  assert.match(source, /projectAssistantResultCanvas\(snapshot\)/);
  assert.match(source, /dataset\.assistantCanvasState/);
  assert.match(source, /node\(documentObject, "p", "ordax-assistant-result-body", block\.text\)/);
  assert.match(source, /conversation\.discardPendingResponse\(\)/);
  assert.match(source, /conversation\.send\(value\)/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage|new Worker|fakeResult/);
});
