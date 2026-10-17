import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FIRST_RUN_JOURNEY, FIRST_RUN_STEP_IDS, FIRST_RUN_STEP_LABELS, getFirstRunStep } from "../system/services/first-run/journey.mjs";

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

test("optional and skippable semantics live with canonical step metadata", () => {
  assert.equal(getFirstRunStep("network").skippable, true);
  assert.equal(getFirstRunStep("security").optional, true);
  assert.equal(getFirstRunStep("account").optional, true);
  assert.throws(() => getFirstRunStep("unknown"), /Unknown first-run step/);
});
