import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  FIRST_RUN_CURSOR_SCHEMA,
  safeFirstRunResumeStep,
  validateFirstRunCursor,
} from "../system/contracts/first-run-cursor.mjs";
import { createNativeFirstRunCursor } from "../system/adapters/native/first-run-cursor.mjs";

test("resume cursor never persists later-stage account/identity state", () => {
  for (const step of ["privacy", "name", "ready"]) {
    assert.equal(safeFirstRunResumeStep(step), "account");
  }
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

test("native First Run resumes with independent cursor, never a second receipt", async () => {
  const ui = await readFile(new URL("../system/surface/ui/first-run.mjs", import.meta.url), "utf8");
  const native = await readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");
  const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));
  assert.equal(contract.resume_cursor.resume_later_steps_at_account, true);
  assert.equal(contract.resume_cursor.completion_receipt_unchanged, true);
  assert.match(ui, /safeFirstRunResumeStep\(cursorPort\?\.load\(\)\.step\)/);
  assert.match(ui, /cursorPort\.save\(safeStep\)/);
  assert.doesNotMatch(ui, /draft\.resumeStep\s*=/);
  assert.match(native, /createNativeFirstRunCursor\(window\)/);
});
