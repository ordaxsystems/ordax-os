import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  KEYBOARD_LAYOUT_IDS,
  validateKeyboardLayoutSnapshot,
} from "../system/contracts/keyboard-layout.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const contract = JSON.parse(await read("docs/contracts/keyboard-layout.json"));
const firstRun = JSON.parse(await read("docs/contracts/first-run.json"));
const launcher = await read("system/surface/bin/ordax-surface");
const host = await read("system/surface/runtime/native_host_server.py");
const firstRunUi = await read("system/surface/ui/first-run.mjs");

test("First Run never promises live keyboard apply without an actual handoff", () => {
  assert.equal(contract.application.compositor, "cage");
  assert.equal(contract.application.live_reconfigure_supported, false);
  assert.equal(contract.application.restart_required_when_configured_differs_from_applied, true);
  assert.equal(contract.first_run.selector_exposed, false);
  assert.equal(firstRun.regional.keyboard_layout_selector_exposed, false);
  assert.equal(firstRun.regional.keyboard_layout_selector_gate, "safe-current-session-apply-or-pre-surface-handoff");
  assert.doesNotMatch(firstRunUi, /data-first-run-keyboard-layout/);
});

test("Native owner distinguishes persisted selection from the layout applied at compositor launch", () => {
  assert.deepEqual([...KEYBOARD_LAYOUT_IDS], ["br-abnt2", "us"]);
  assert.match(launcher, /configure_keyboard_layout\(\)/);
  assert.match(launcher, /XKB_DEFAULT_LAYOUT/);
  assert.match(launcher, /ORDAX_KEYBOARD_LAYOUT_ID/);
  assert.match(host, /def keyboard_layout_snapshot\(\)/);
  assert.match(host, /configuredLayoutId/);
  assert.match(host, /appliedLayoutId/);
  assert.match(host, /restartRequired/);
  const pending = validateKeyboardLayoutSnapshot({
    configuredLayoutId: "us",
    appliedLayoutId: "br-abnt2",
    supportedLayoutIds: [...KEYBOARD_LAYOUT_IDS],
    restartRequired: true,
  });
  assert.equal(pending.restartRequired, true);
  assert.throws(() => validateKeyboardLayoutSnapshot({
    ...pending,
    restartRequired: false,
  }), /restartRequired/);
  assert.equal(validateKeyboardLayoutSnapshot({
    ...pending,
    appliedLayoutId: "us",
    restartRequired: false,
  }).restartRequired, false);
});

test("regional First Run reads canonical Native keyboard status without persisting a second layout", async () => {
  const nativeMain = await read("system/composition/native/main.mjs");
  const chromiumSmoke = await read("tools/surface-native/first-run-browser-smoke.mjs");

  assert.equal(contract.first_run.status_read_only_exposed, true);
  assert.equal(firstRun.regional.keyboard_status_read_only, true);
  assert.equal(firstRun.regional.keyboard_status_owner, "keyboard-layout");
  assert.equal(firstRun.regional.keyboard_layout_selector_exposed, false);
  assert.match(nativeMain, /mountFirstRunExperience\(root, \{[\s\S]*?keyboardLayout,/);
  assert.match(firstRunUi, /assertKeyboardLayoutPort\(keyboardLayout\)/);
  assert.match(firstRunUi, /validateKeyboardLayoutSnapshot\(await keyboardLayoutPort\.read\(\)\)/);
  assert.match(firstRunUi, /keyboardLayoutOption\(keyboardLayoutSnapshot\.configuredLayoutId\)/);
  assert.match(firstRunUi, /status\.dataset\.firstRunKeyboardStatus/);
  assert.doesNotMatch(firstRunUi, /keyboardLayoutPort\.(?:configure|apply)\(/);
  assert.doesNotMatch(firstRunUi, /draft\.(?:keyboardLayout|keyboardLayoutId)\s*=/);
  assert.match(chromiumSmoke, /relaunchRefreshesNativeKeyboard/);
  assert.match(chromiumSmoke, /noKeyboardOwnerInReceipt/);
});
