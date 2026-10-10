import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  projectAssistantWorkStrip,
  ASSISTANT_WORK_STRIP_SCHEMA,
} from "../system/apps/assistant/ui/work-strip.mjs";
import { createPersonalOrdaxRuntime } from "../system/services/personal-ordax/runtime.mjs";

const identity = (state = "signed-out", subjectId = null) => ({
  state, subjectId, displayName: state === "signed-in" ? "Conta" : null,
});
const unavailableSpace = () => ({
  schema: "ordax.space-selection/1", state: "unavailable",
  subjectId: null, selectedSpace: null,
});
const selectedSpace = (id = "space-a", subjectId = "owner-a") => ({
  schema: "ordax.space-selection/1", state: "selected", subjectId,
  selectedSpace: {
    id, name: "Empresa", kind: "professional", ownerId: subjectId,
    profilePack: "pizzaria-br", state: "active",
  },
});

function port(schema, initial, extra = {}) {
  let value = initial;
  const listeners = new Set();
  return {
    schema, getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSnapshot(next) {
      value = next;
      for (const listener of [...listeners]) listener(next);
    },
    ...extra,
  };
}

function model() {
  return {
    schema: "ordax.intelligence/1",
    getSnapshot() {
      return {
        schema: "ordax.intelligence/1", state: "ready",
        inferenceAvailable: true, engineId: "llama.cpp", modelId: "verified",
        authority: "none", toolExecution: false,
      };
    },
    subscribe() { return () => {}; },
    async respond() {
      return {
        schema: "ordax.intelligence-response/1", text: "Plano registrado",
        engineId: "llama.cpp", modelId: "verified", authority: "none",
      };
    },
  };
}

test("Personal OrdaX device Work appears only from verified runtime Activity and Result", async () => {
  const id = port("ordax.identity-session/1", identity());
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: id, intelligencePort: model(),
    now: (() => { let t = 10000; return () => t++; })(),
  });
  try {
    const initial = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(initial.schema, ASSISTANT_WORK_STRIP_SCHEMA);
    assert.deepEqual(initial.cards, []);
    const work = runtime.create("Organizar arquivo autorizado");
    const queued = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(queued.cards.length, 1);
    assert.equal(queued.cards[0].state, "working");
    assert.deepEqual(queued.cards[0].steps.map(step => step.type), ["queued"]);
    assert.equal(queued.cards[0].completionPercent, null);
    assert.equal(queued.cards[0].result, null);
    await runtime.run(work.id);
    const completed = projectAssistantWorkStrip(runtime.getSnapshot(), id.getSnapshot(), unavailableSpace());
    assert.equal(completed.cards[0].state, "result");
    assert.equal(completed.cards[0].result.text, "Plano registrado");
    assert.deepEqual(completed.cards[0].steps.map(step => step.type), ["queued", "started", "completed"]);
    assert.equal(completed.cards[0].authority, "none");
    assert.equal(Object.isFrozen(completed.cards), true);
  } finally {
    runtime.dispose();
  }
});

test("account and Space fences hide foreign and stale work without retaining a cached result", () => {
  const idPort = port("ordax.identity-session/1", identity("signed-in", "owner-a"));
  const selection = port("ordax.space-selection/1", selectedSpace(),
    { select() {}, clear() {} });
  let tick = 10000;
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: idPort, spaceSelectionPort: selection, now: () => tick++,
  });
  try {
    runtime.create("Trabalho da empresa", { spaceId: "space-a" });
    const same = projectAssistantWorkStrip(runtime.getSnapshot(),
      idPort.getSnapshot(), selection.getSnapshot());
    assert.equal(same.cards.length, 1);
    assert.equal(same.cards[0].spaceId, "space-a");
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      identity("signed-in", "owner-b"), selection.getSnapshot()).cards, []);
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      idPort.getSnapshot(), selectedSpace("space-b")).cards, []);
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      idPort.getSnapshot(), unavailableSpace()).cards, []);
  } finally {
    runtime.dispose();
  }
});

test("unavailable identity, missing runtime, mixed scope and unsupported schema fail closed", () => {
  assert.deepEqual(projectAssistantWorkStrip(null, identity(), unavailableSpace()).cards, []);
  assert.deepEqual(projectAssistantWorkStrip(null, null, null).cards, []);
  assert.throws(() => projectAssistantWorkStrip({
    schema: "unknown/2",
  }, identity(), unavailableSpace()), /schema/);
  const id = port("ordax.identity-session/1", identity());
  const runtime = createPersonalOrdaxRuntime({ identitySessionPort: id });
  try {
    runtime.create("Dispositivo");
    assert.deepEqual(projectAssistantWorkStrip(runtime.getSnapshot(),
      identity("signed-in", "owner-a"), selectedSpace()).cards, []);
  } finally {
    runtime.dispose();
  }
});

test("Native Assistant reads the existing Personal runtime; UI never executes mission or grants", async () => {
  const [native, runtime, ui] = await Promise.all([
    readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/apps/assistant/runtime.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/apps/assistant/ui/conversation-controls.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(native, /personalOrdax,\s*identitySessionPort: identitySession/);
  assert.match(runtime, /personalOrdax,\s*identitySessionPort,/);
  assert.match(ui, /projectAssistantWorkStrip\(/);
  assert.match(ui, /personalOrdax\.getSnapshot\(\)/);
  assert.match(ui, /personalOrdax\?\.subscribe\?\.\(\(\) => render\(\)\)/);
  assert.doesNotMatch(ui, /personalOrdax\.run\(|personalOrdax\.create\(|personalOrdax\.approve\(/);
});
