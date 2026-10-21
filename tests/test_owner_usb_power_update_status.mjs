import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateUpdateStatusSnapshot } from "../system/contracts/update-status.mjs";

const base = Object.freeze({
  sourceSha: "c96ec366c2be32e08b3dae924d9cd380cb60663c",
  status: "running",
  phase: "idle",
  applyMode: "none",
});
const receipt = Object.freeze({
  lastAction: "shutdown",
  lastStatus: "failed",
  lastStage: "root-readonly",
  lastFailure: "remount-failed",
});

test("Surface retains bounded, immutable host power receipts in update watcher state", () => {
  const result = validateUpdateStatusSnapshot({ ...base, hostPower: receipt });
  assert.deepEqual(result.hostPower, receipt);
  assert.equal(Object.isFrozen(result.hostPower), true);
});

test("older or Stable/MVP update snapshots remain compatible", () => {
  assert.equal(validateUpdateStatusSnapshot(base).hostPower, null);
});

test("unexpected power code is never accepted into diagnostic presentation", () => {
  for (const [field, malicious] of [
    ["lastAction", "shutdown;rm -rf /"],
    ["lastStatus", "success"],
    ["lastStage", "/state/ordax/private"],
    ["lastFailure", "secret-token"],
  ]) {
    assert.throws(
      () => validateUpdateStatusSnapshot({
        ...base,
        hostPower: { ...receipt, [field]: malicious },
      }),
      TypeError,
    );
  }
});

test("System updates exposes exact canonical receipt keys without any new power action", () => {
  const source = readFileSync(
    new URL("../system/surface/ui/system-overview-controls.mjs", import.meta.url),
    "utf8",
  );
  for (const field of ["lastAction", "lastStatus", "lastStage", "lastFailure"]) {
    const key = `power.last_${field.slice(4).toLowerCase()}`;
    assert.ok(source.includes(`addFact("${key}", updateSnapshot.hostPower.${field})`));
  }
});
