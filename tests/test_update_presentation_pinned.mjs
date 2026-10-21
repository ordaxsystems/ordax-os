import test from "node:test";
import assert from "node:assert/strict";

import {
  isRepositoryOnlyUpdate,
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

const OLD_SHA = "6262b50c94616d704d889d311aee675667359ecf";
const NEW_SHA = "ed1138a43940db747d8e362a2faf53a3ec6eb6e8";

test("repository-only Git delivery explains legitimate Surface SHA difference", () => {
  const snapshot = {
    status: "running",
    applyMode: "none",
    sourceSha: NEW_SHA,
    runtimeSurfaceSha: OLD_SHA,
    bootRefreshRequired: false,
  };
  assert.equal(isRepositoryOnlyUpdate(snapshot), true);
  assert.equal(updateIsAlerting(snapshot), false);
});

test("Surface SHA difference must not conceal failed or pending UI activation", () => {
  const shared = {
    status: "running",
    applyMode: "none",
    sourceSha: NEW_SHA,
    runtimeSurfaceSha: OLD_SHA,
  };
  assert.equal(isRepositoryOnlyUpdate({ ...shared, runtimeSurfaceSha: NEW_SHA }), false);
  assert.equal(isRepositoryOnlyUpdate({ ...shared, applyMode: "reload" }), false);
  assert.equal(isRepositoryOnlyUpdate({ ...shared, applyMode: "surface-restart" }), false);
  assert.equal(isRepositoryOnlyUpdate({ ...shared, status: "pull-error" }), false);
  assert.equal(isRepositoryOnlyUpdate({ ...shared, runtimeSurfaceSha: "" }), false);
  assert.equal(isRepositoryOnlyUpdate({ ...shared, sourceSha: "not-a-sha" }), false);
  assert.equal(isRepositoryOnlyUpdate(null), false);
});
