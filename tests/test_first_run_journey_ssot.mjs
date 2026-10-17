import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FIRST_RUN_JOURNEY, FIRST_RUN_STEP_IDS, FIRST_RUN_STEP_LABELS, getFirstRunStep } from "../system/services/first-run/journey.mjs";
import { FIRST_RUN_RESUME_STEP_IDS } from "../system/contracts/first-run-state-store.mjs";

const contract = JSON.parse(await readFile(new URL("../docs/contracts/first-run.json", import.meta.url), "utf8"));

test("first-run contract consumes the canonical runtime journey order", () => {
  assert.deepEqual(contract.flow, [...FIRST_RUN_STEP_IDS]);
  assert.equal(contract.owners.journey, "system/services/first-run/journey.mjs");
});

test("first-run journey identities and labels are unique and complete", () => {
  assert.equal(new Set(FIRST_RUN_STEP_IDS).size, FIRST_RUN_STEP_IDS.length);
  assert.equal(new Set(FIRST_RUN_STEP_LABELS).size, FIRST_RUN_STEP_LABELS.length);
  assert.equal(FIRST_RUN_JOURNEY.length, FIRST_RUN_STEP_IDS.length);
  for (const step of FIRST_RUN_JOURNEY) {
    assert.equal(getFirstRunStep(step.id), step);
    assert.equal(typeof step.domain, "string");
    assert.ok(step.domain.length > 0);
  }
});

test("durable safe resume steps are exactly the pre-identity-decision journey prefix", () => {
  assert.deepEqual([...FIRST_RUN_RESUME_STEP_IDS], FIRST_RUN_STEP_IDS.slice(0, 5));
  assert.deepEqual(contract.persistence.resume_safe_steps, [...FIRST_RUN_RESUME_STEP_IDS]);
  assert.equal(contract.persistence.incomplete_navigation_checkpoint_same_native_file, true);
  assert.equal(contract.persistence.completed_receipt_must_not_contain_resume_step, true);
});

test("optional and skippable semantics live with canonical step metadata", () => {
  assert.equal(getFirstRunStep("network").skippable, true);
  assert.equal(getFirstRunStep("security").optional, true);
  assert.equal(getFirstRunStep("account").optional, true);
  assert.throws(() => getFirstRunStep("unknown"), /Unknown first-run step/);
});
