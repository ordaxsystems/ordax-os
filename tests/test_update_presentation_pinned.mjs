import test from "node:test";
import assert from "node:assert/strict";

import {
  updateIsAlerting,
  updateStatusLabel,
} from "../system/services/update/presentation.mjs";

test("pinned rollback is presented as a user-visible update alert", () => {
  assert.equal(updateStatusLabel("pinned"), "Atualizações pausadas por rollback");
  assert.equal(updateIsAlerting({ status: "pinned", bootRefreshRequired: false }), true);
});

test("healthy running state remains non-alerting", () => {
  assert.equal(updateIsAlerting({ status: "running", bootRefreshRequired: false }), false);
});
