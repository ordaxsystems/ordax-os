import assert from "node:assert/strict";
import test from "node:test";

import {
  KEYBOARD_LAYOUT_SCHEMA,
  assertKeyboardLayoutPort,
  validateKeyboardLayoutSnapshot,
} from "../system/contracts/keyboard-layout.mjs";
import { createNativeKeyboardLayout } from "../system/adapters/native/keyboard-layout.mjs";

function snapshot(configuredLayoutId, appliedLayoutId = configuredLayoutId) {
  return {
    configuredLayoutId,
    appliedLayoutId,
    supportedLayoutIds: ["br-abnt2", "us"],
    restartRequired: configuredLayoutId !== appliedLayoutId,
  };
}

test("keyboard layout contract distinguishes configured and applied state", () => {
  assert.deepEqual(
    validateKeyboardLayoutSnapshot(snapshot("us", "br-abnt2")),
    snapshot("us", "br-abnt2"),
  );
  assert.throws(
    () => validateKeyboardLayoutSnapshot({
      ...snapshot("us", "br-abnt2"),
      restartRequired: false,
    }),
    /restartRequired/,
  );
  assert.throws(
    () => validateKeyboardLayoutSnapshot(snapshot("de")),
    /supported keyboard layout/,
  );
});

test("native keyboard layout adapter is GET/POST bounded and validated", async () => {
  let state = snapshot("br-abnt2");
  const calls = [];
  const windowRef = {
    async fetch(url, options) {
      calls.push({ url, options });
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        state = snapshot(body.layoutId, state.appliedLayoutId);
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return state;
        },
      };
    },
  };

  const port = await createNativeKeyboardLayout(windowRef);
  assert.equal(port.schema, KEYBOARD_LAYOUT_SCHEMA);
  assertKeyboardLayoutPort(port);
  assert.equal(calls[0].url, "/__ordax/native/keyboard-layout");
  assert.equal(calls[0].options.method, "GET");

  const configured = await port.configure("us");
  assert.equal(configured.configuredLayoutId, "us");
  assert.equal(configured.appliedLayoutId, "br-abnt2");
  assert.equal(configured.restartRequired, true);
  assert.equal(calls.at(-1).options.method, "POST");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { layoutId: "us" });

  const pending = await port.apply("us");
  assert.equal(pending.configuredLayoutId, "us");
  assert.equal(pending.appliedLayoutId, "br-abnt2");
  assert.equal(pending.restartRequired, true);
  assert.equal(calls.at(-1).url, "/__ordax/native/keyboard-layout/apply");
  assert.equal(calls.at(-1).options.method, "POST");
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { layoutId: "us" });
});
