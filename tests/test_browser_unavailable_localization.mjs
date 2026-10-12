import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BROWSER_UNAVAILABLE_REASONS,
  createUnavailableBrowserSession,
} from "../system/contracts/browser-session.mjs";
import { createNativeBrowserSession } from "../system/adapters/native/browser-session.mjs";
import { createWebBrowserSession } from "../system/adapters/web/browser-session.mjs";
import { translateSurfaceMessage } from "../system/services/i18n/surface.mjs";

function source(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url)),
    "utf8",
  );
}

test("unavailable browser snapshots expose semantic codes instead of human-language adapter copy", () => {
  const generic = createUnavailableBrowserSession();
  assert.deepEqual(generic.getSnapshot(), {
    supported: false,
    reason: "",
    reasonCode: BROWSER_UNAVAILABLE_REASONS.HOST_UNAVAILABLE,
    activeTabId: null,
    tabs: [],
  });

  const web = createWebBrowserSession().getSnapshot();
  assert.equal(web.supported, false);
  assert.equal(web.reason, "");
  assert.equal(web.reasonCode, BROWSER_UNAVAILABLE_REASONS.WEB_EMBEDDING_DISABLED);

  const native = createNativeBrowserSession({}).getSnapshot();
  assert.equal(native.supported, false);
  assert.equal(native.reason, "");
  assert.equal(native.reasonCode, BROWSER_UNAVAILABLE_REASONS.NATIVE_ENGINE_UNAVAILABLE);
});

test("Internet product localization is no longer silently bundled in the OS", () => {
  assert.throws(() => translateSurfaceMessage("en-US", "internet.home.unavailable"),
    /Unknown Surface localization message/);
  assert.throws(() => translateSurfaceMessage("pt-BR", "internet.home.unavailable"),
    /Unknown Surface localization message/);
  const surface = source("system/services/i18n/surface.mjs");
  assert.doesNotMatch(surface, /catalog\\/internet\\.mjs/);
});

test("first-party browser protocol boundaries contain no Portuguese unavailable prose", () => {
  for (const path of [
    "system/contracts/browser-session.mjs",
    "system/adapters/web/browser-session.mjs",
    "system/adapters/native/browser-session.mjs",
  ]) {
    const text = source(path);
    assert.doesNotMatch(text, /Navega(?:ção|cao)|não incorpora|não expôs|indisponível neste host/i, path);
  }
});
