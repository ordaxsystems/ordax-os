import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  FIRST_RUN_CURSOR_SCHEMA,
  safeFirstRunResumeStep,
  validateFirstRunCursor,
} from "../system/contracts/first-run-cursor.mjs";
import { createNativeFirstRunCursor } from "../system/adapters/native/first-run-cursor.mjs";
import { FIRST_RUN_STEP_IDS, getFirstRunStepIndex } from "../system/services/first-run/journey.mjs";

test("resume cursor never persists later-stage account/identity state", () => {
  for (const step of ["security", "privacy", "name", "ready"]) {
    assert.equal(safeFirstRunResumeStep(step), "account");
  }
  assert.equal(safeFirstRunResumeStep("regional"), "welcome");
  assert.equal(safeFirstRunResumeStep("network"), "network");
  assert.equal(safeFirstRunResumeStep("invalid"), "welcome");
  assert.throws(() => validateFirstRunCursor({
    schema: FIRST_RUN_CURSOR_SCHEMA, step: "privacy",
  }), /cursor/);
  assert.throws(() => validateFirstRunCursor({
    schema: FIRST_RUN_CURSOR_SCHEMA, step: "account", subjectId: "secret",
  }), /cursor/);
});

test("native cursor adapter uses single-owner same-origin bounded JSON", async () => {
  let state = {schema: FIRST_RUN_CURSOR_SCHEMA, step: "regional"};
  const calls = [];
  const windowRef = {async fetch(url, options) {
    calls.push({url, options});
    assert.equal(url, "/__ordax/native/first-run-cursor");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    if (options.method === "POST") state = JSON.parse(options.body);
    return {ok: true, async json() {return state;}};
  }};
  const cursor = await createNativeFirstRunCursor(windowRef);
  assert.equal(cursor.load().step, "regional");
  assert.equal((await cursor.save("ready")).step, "account");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    schema: FIRST_RUN_CURSOR_SCHEMA, step: "account",
  });
});

test("optional Windows First Run cursor bootstrap GET can be cancelled without changing durable writes", async () => {
  const controller = new AbortController();
  let initialRead = null;
  const pending = createNativeFirstRunCursor({
    fetch(path, options) {
      initialRead = { path, options };
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    },
  }, { signal: controller.signal });
  assert.equal(initialRead?.path, "/__ordax/native/first-run-cursor");
  assert.equal(initialRead.options.method, "GET");
  assert.equal(initialRead.options.signal, controller.signal);
  controller.abort(new Error("Optional Native cursor read deadline"));
  await assert.rejects(pending, /Optional Native cursor read deadline/);
});

test("native First Run resumes with independent cursor, never a second receipt", async () => {
  const ui = await readFile(new URL("../system/surface/ui/first-run.mjs", import.meta.url), "utf8");
  const native = await readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");
  const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));
  assert.equal(contract.resume_cursor.resume_later_steps_at_account, true);
  assert.equal(contract.resume_cursor.windows_read_deadline_ms, 5000);
  assert.equal(contract.resume_cursor.completion_receipt_unchanged, true);
  assert.match(ui, /safeFirstRunResumeStep\(cursorPort\?\.load\(\)\.step\)/);
  assert.match(ui, /cursorPort\.save\(safeStep\)/);
  assert.doesNotMatch(ui, /draft\.resumeStep\s*=/);
  assert.match(native, /createNativeFirstRunCursor\(window, \{ signal: firstRunOptionalReadSignal \}\)/);
});

test("First Run resume reads the bounded cursor once and resolves indices through the canonical journey", async () => {
  const ui = await readFile(new URL("../system/surface/ui/first-run.mjs", import.meta.url), "utf8");
  assert.equal((ui.match(/cursorPort\?\.load\(\)\.step/g) ?? []).length, 1);
  assert.match(ui, /let stepIndex = Math\.max\(0, stepIndexFor\(resumedStep\)\)/);
  assert.match(ui, /FIRST_RUN_JOURNEY\.filter/);
  assert.doesNotMatch(ui, /STEPS\.indexOf\(/);
  assert.equal(getFirstRunStepIndex(safeFirstRunResumeStep("ready")), getFirstRunStepIndex("account"));
  for (const [index, step] of FIRST_RUN_STEP_IDS.entries()) {
    assert.equal(getFirstRunStepIndex(step), index);
  }
  assert.throws(() => getFirstRunStepIndex("unknown"), /Unknown first-run step/);
});
