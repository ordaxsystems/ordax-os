import test from "node:test";
import assert from "node:assert/strict";
import { notifySurfaceRenderObservers } from "../system/surface/ui/render-observers.mjs";

test("a failing Native view cannot block later UI and attestation observers", () => {
  const calls = [];
  const errors = [];
  const failure = new Error("optional view failed");
  const observers = new Set([
    () => { calls.push("account"); throw failure; },
    () => { calls.push("settings"); },
    () => { calls.push("native-reporter"); },
  ]);
  notifySurfaceRenderObservers(observers, error => errors.push(error));
  assert.deepEqual(calls, ["account", "settings", "native-reporter"]);
  assert.deepEqual(errors, [failure]);
  assert.equal(observers.size, 3, "subscriptions are owned by their existing lifecycle");
});

test("observer failures never fabricate a healthy Surface state", () => {
  const calls = [];
  const errors = [];
  notifySurfaceRenderObservers(new Set([
    () => { calls.push("window"); },
    () => { throw new Error("report not ready"); },
    () => { calls.push("another view"); },
  ]), e => errors.push(e.message));
  assert.deepEqual(calls, ["window", "another view"]);
  assert.deepEqual(errors, ["report not ready"]);
  assert.throws(() => notifySurfaceRenderObservers([], null), TypeError);
});
