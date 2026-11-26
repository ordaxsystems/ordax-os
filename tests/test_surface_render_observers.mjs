import test from "node:test";
import assert from "node:assert/strict";
import { notifySurfaceRenderObservers, renderWithObserverRecovery } from "../system/surface/ui/render-observers.mjs";

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

test("core renderer failure still notifies independent extensions and preserves its error", () => {
  const calls = [];
  const original = new Error("core renderer failed");
  const views = new Set([
    () => calls.push("settings"),
    () => calls.push("system"),
  ]);
  assert.throws(() => renderWithObserverRecovery(
    () => { calls.push("core"); throw original; },
    error => {
      assert.equal(error, original);
      notifySurfaceRenderObservers(views, () => {});
    },
  ), error => error === original);
  assert.deepEqual(calls, ["core", "settings", "system"]);
});

test("successful render does not notify extensions twice or fabricate an error", () => {
  let count = 0;
  assert.equal(renderWithObserverRecovery(() => 42, () => count++), 42);
  assert.equal(count, 0);
  assert.throws(() => renderWithObserverRecovery(null, () => {}), TypeError);
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
