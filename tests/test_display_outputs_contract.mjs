import assert from "node:assert/strict";
import test from "node:test";
import { mountDisplayOutputControls } from "../system/surface/ui/display-output-controls.mjs";

import {
  DISPLAY_OUTPUTS_SCHEMA,
  assertDisplayOutputsPort,
  validateDisplayOutputsSnapshot,
} from "../system/contracts/display-outputs.mjs";

const available = {
  schema: DISPLAY_OUTPUTS_SCHEMA,
  available: true,
  reason: null,
  outputs: [{
    id: "DP-1",
    name: "Monitor principal",
    enabled: true,
    modes: [
      { id: "1920x1080@60", width: 1920, height: 1080, refreshHz: 60, current: true },
      { id: "1280x720@60", width: 1280, height: 720, refreshHz: 60, preferred: true },
    ],
  }],
  preview: null,
};

test("display output contract derives the active mode and freezes the snapshot", () => {
  const snapshot = validateDisplayOutputsSnapshot(available);
  assert.equal(snapshot.outputs[0].currentModeId, "1920x1080@60");
  assert.equal(Object.isFrozen(snapshot.outputs[0].modes), true);
});

test("an available capability must expose a real enabled output and current mode", () => {
  assert.throws(() => validateDisplayOutputsSnapshot({
    ...available,
    outputs: [{ ...available.outputs[0], enabled: false }],
  }), /enabled output/);
  assert.throws(() => validateDisplayOutputsSnapshot({
    ...available,
    outputs: [{
      ...available.outputs[0],
      modes: available.outputs[0].modes.map(({ current, ...mode }) => mode),
    }],
  }), /exactly one current mode/);
});

test("unavailable capability cannot leak a fabricated output list", () => {
  assert.throws(() => validateDisplayOutputsSnapshot({
    schema: DISPLAY_OUTPUTS_SCHEMA,
    available: false,
    reason: "provider-missing",
    outputs: available.outputs,
    preview: null,
  }), /cannot report modes/);
});

test("display output adapter port requires all lifecycle operations", () => {
  const port = {
    schema: DISPLAY_OUTPUTS_SCHEMA,
    read() {},
    preview() {},
    confirm() {},
    revert() {},
  };
  assert.equal(assertDisplayOutputsPort(port), port);
  assert.throws(() => assertDisplayOutputsPort({ ...port, revert: undefined }), /revert/);
});

test("shared display UI rejects missing or invalid translation authority in Native and Web", () => {
  const host = { ownerDocument: {} };
  assert.throws(() => mountDisplayOutputControls(host, { mode: "web" }),
    /require a container, document, and translator/);
  assert.throws(() => mountDisplayOutputControls(host, {
    mode: "native",
    translate: "unsafe-static-text",
  }), /require a container, document, and translator/);
});
