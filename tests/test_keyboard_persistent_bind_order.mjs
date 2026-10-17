import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const launcher = (await source("system/surface/bin/ordax-surface")).replace(/\r\n/g, "\n");
const nativeHost = (await source("system/surface/runtime/native_host_server.py")).replace(/\r\n/g, "\n");
const contract = JSON.parse(await source("docs/contracts/keyboard-layout.json"));

test("persistent keyboard writes share exactly the native-state bind mounted by Surface", () => {
  assert.match(launcher, /STATE_ROOT=\$\{ORDAX_STATE_DIR:-\/state\/ordax\}/);
  assert.match(launcher, /PERSISTENT_NATIVE_STATE=\$STATE_ROOT\/native-state/);
  assert.match(launcher, /KEYBOARD_LAYOUT_STATE=\$PERSISTENT_NATIVE_STATE\/keyboard-layout/);
  assert.ok(launcher.includes('mount -o bind "$PERSISTENT_NATIVE_STATE" "$RUNTIME_ROOT/var/lib/ordax"'));
  assert.ok(nativeHost.includes('KEYBOARD_LAYOUT_FILE = "/var/lib/ordax/keyboard-layout"'));
  assert.equal(contract.persistence.path, "/var/lib/ordax/keyboard-layout");
  assert.equal(contract.persistence.persistent_usb_state, true);
  assert.equal(contract.persistence.web_storage_used, false);
});

test("launcher binds state and applies XKB before Cage, without claiming live apply", () => {
  const bind = launcher.indexOf('bind_runtime_mounts || fallback_with_reason');
  const keyboard = launcher.indexOf("\nconfigure_keyboard_layout\n", bind);
  const compositor = launcher.indexOf("/usr/bin/cage -s --", keyboard);
  assert.ok(bind >= 0 && keyboard > bind && compositor > keyboard,
    "persistent state must mount before XKB selection and Cage launch");
  assert.ok(launcher.includes('export XKB_DEFAULT_VARIANT XKB_DEFAULT_OPTIONS ORDAX_KEYBOARD_LAYOUT_ID'));
  assert.ok(nativeHost.includes('os.environ.get(\n        "ORDAX_KEYBOARD_LAYOUT_ID"'));
  assert.equal(contract.application.live_reconfigure_supported, false);
  assert.equal(contract.application.restart_required_when_configured_differs_from_applied, true);
});
