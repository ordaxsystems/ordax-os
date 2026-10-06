import assert from "node:assert/strict";
import test from "node:test";

import {
  validateComponentPackagePath,
  validateComponentSlotResolution,
} from "../system/contracts/component-slot-source.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";

const SHA = "7".repeat(40);

function windowRef(href = "http://127.0.0.1:43121/") {
  return { location: { href } };
}

function resolution(overrides = {}) {
  return {
    componentId: "internet",
    state: "pending",
    source: "slot",
    sourceRepository: "washingtonmsdj/prototipo-ordax-os",
    revision: 4,
    version: "0.4.0",
    sourceCommit: SHA,
    entrypoint: "system/apps/internet/runtime.mjs",
    pendingHealth: "unknown",
    ...overrides,
  };
}

test("slot resolution requires exact identity and safe package entrypoint", () => {
  const value = validateComponentSlotResolution(resolution());
  assert.equal(value.componentId, "internet");
  assert.equal(value.sourceRepository, "washingtonmsdj/prototipo-ordax-os");
  assert.equal(value.version, "0.4.0");
  assert.equal(value.sourceCommit, SHA);
  assert.equal(value.entrypoint, "system/apps/internet/runtime.mjs");

  assert.throws(
    () => validateComponentSlotResolution(resolution({ sourceCommit: "ABC" })),
    /40-hex/,
  );
  assert.throws(
    () => validateComponentSlotResolution(resolution({ sourceRepository: "not-a-repository" })),
    /owner\/repository/,
  );
  assert.throws(
    () => validateComponentSlotResolution(resolution({ source: "bundled" })),
    /verified slots/,
  );
  assert.throws(
    () => validateComponentPackagePath("../escape.mjs"),
    /unsafe segment/,
  );
  assert.throws(
    () => validateComponentPackagePath("system/apps/internet/%2e%2e/x.mjs"),
    /invalid/,
  );
});

test("native slot source is exact loopback only", () => {
  assert.throws(
    () => createNativeComponentSlotSource(windowRef("http://localhost:43121/")),
    /canonical loopback/,
  );
  assert.throws(
    () => createNativeComponentSlotSource(windowRef("https://127.0.0.1:43121/")),
    /canonical loopback/,
  );
  assert.throws(
    () => createNativeComponentSlotSource(windowRef("http://127.0.0.1/")),
    /canonical loopback/,
  );
});

test("metadata URL is same-origin and contains only component plus state", () => {
  const source = createNativeComponentSlotSource(windowRef());
  const url = new URL(source.metadataUrl("internet", "pending"));
  assert.equal(url.origin, "http://127.0.0.1:43121");
  assert.equal(url.pathname, "/__ordax/native/component-runtime");
  assert.equal(url.searchParams.get("component"), "internet");
  assert.equal(url.searchParams.get("state"), "pending");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["component", "state"]);
});

test("runtime URL embeds state version source commit and package path", () => {
  const source = createNativeComponentSlotSource(windowRef());
  const url = new URL(source.runtimeUrl(resolution()));
  assert.equal(url.origin, "http://127.0.0.1:43121");
  assert.equal(
    url.pathname,
    "/__ordax/native/component-module/internet/pending/0.4.0/"
      + SHA
      + "/system/apps/internet/runtime.mjs",
  );
  assert.equal(url.search, "");
});

test("relative imports and assets remain inside the exact component identity", () => {
  const source = createNativeComponentSlotSource(windowRef());
  const runtimeUrl = source.runtimeUrl(resolution());

  const contract = new URL("../../contracts/component-runtime.mjs", runtimeUrl);
  assert.equal(
    contract.pathname,
    "/__ordax/native/component-module/internet/pending/0.4.0/"
      + SHA
      + "/system/contracts/component-runtime.mjs",
  );

  const css = new URL("./internet.css", runtimeUrl);
  assert.equal(
    css.pathname,
    "/__ordax/native/component-module/internet/pending/0.4.0/"
      + SHA
      + "/system/apps/internet/internet.css",
  );
});
