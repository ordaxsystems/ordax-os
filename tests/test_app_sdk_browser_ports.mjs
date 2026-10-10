import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BROWSER_SESSION_SCHEMA,
  createUnavailableBrowserSession,
  assertBrowserSessionPort,
} from "../system/contracts/browser-session.mjs";
import {
  BROWSER_NAVIGATION_POLICY_SCHEMA,
  resolveBrowserNavigation,
} from "../system/contracts/browser-navigation.mjs";
import {
  BROWSER_DOWNLOAD_PORT_SCHEMA,
  validateBrowserDownloadEvent,
} from "../system/contracts/browser-download.mjs";
import {
  BROWSER_PAGE_SELECTION_PORT_SCHEMA,
  BROWSER_PAGE_SELECTION_SCHEMA,
  browserSelectionIntelligenceRequest,
} from "../system/contracts/browser-page-selection.mjs";

const base = new URL("../", import.meta.url);
const EXPECTED = new Map([
  ["browser-download", "ordax.browser-download-port/1"],
  ["browser-favorites", "ordax.browser-favorites/1"],
  ["browser-favorites-store", "ordax.browser-favorites-store/1"],
  ["browser-history", "ordax.browser-history/1"],
  ["browser-history-store", "ordax.browser-history-store/1"],
  ["browser-navigation", "ordax.browser-navigation-policy/1"],
  ["browser-page-find", "ordax.browser-page-find-port/1"],
  ["browser-page-selection", "ordax.browser-page-selection-port/1"],
  ["browser-page-selection-data", "ordax.browser-page-selection/1"],
  ["browser-search-preferences", "ordax.browser-search-preferences/1"],
  ["browser-search-preferences-store", "ordax.browser-search-preferences-store/1"],
  ["browser-session", "ordax.browser-session/1"],
]);

test("SDK 1.14 Browser interfaces use canonical sources without private host authority", async () => {
  const bundle = JSON.parse(await readFile(new URL("sdk/app-sdk-v1/bundle.json", base), "utf8"));
  assert.equal(bundle.bundle_version, "1.14.0");
  assert.equal(bundle.authority, "none");
  assert.equal(bundle.compatibility_policy, "contract-major");
  const lookup = new Map(bundle.contracts.map(x => [x.name, x]));
  assert.equal(lookup.size, bundle.contracts.length);
  for (const [name, schema] of EXPECTED) {
    const contract = lookup.get(name);
    assert.ok(contract, name);
    assert.equal(contract.schema, schema);
    assert.equal(contract.major, 1);
    assert.match(contract.source_path, /^system\/contracts\/browser-[a-z-]+\.mjs$/);
    assert.match(contract.source_git_blob, /^[0-9a-f]{40}$/);
  }
  for (const contract of bundle.contracts) {
    assert.doesNotMatch(contract.source_path, /adapters\/(?:native|web)|surface\/runtime|secrets/);
  }
  assert.equal(BROWSER_SESSION_SCHEMA, EXPECTED.get("browser-session"));
  assert.equal(BROWSER_NAVIGATION_POLICY_SCHEMA, EXPECTED.get("browser-navigation"));
  assert.equal(BROWSER_DOWNLOAD_PORT_SCHEMA, EXPECTED.get("browser-download"));
  assert.equal(BROWSER_PAGE_SELECTION_PORT_SCHEMA, EXPECTED.get("browser-page-selection"));
  assert.equal(BROWSER_PAGE_SELECTION_SCHEMA, EXPECTED.get("browser-page-selection-data"));
});

test("Browser interfaces do not provide a WebKit instance, filesystem access or implicit consent", () => {
  const unavailable = createUnavailableBrowserSession();
  assert.equal(assertBrowserSessionPort(unavailable), unavailable);
  assert.equal(unavailable.getSnapshot().supported, false);
  assert.equal(unavailable.openTab("tab-1", "https://example.org"), false);
  const nav = resolveBrowserNavigation("https://example.org");
  assert.equal(nav.url, "https://example.org/");
  assert.throws(() => resolveBrowserNavigation("http://127.0.0.1"), TypeError);
  assert.throws(() => validateBrowserDownloadEvent({
    type: "browser-download",
    id: "download-0123456789abcdef",
    fileName: "sample.zip",
    status: "saved",
    path: "/etc/passwd",
  }), TypeError);

  const selection = {
    schema: BROWSER_PAGE_SELECTION_SCHEMA,
    kind: "selection",
    source: "untrusted-web-content",
    tabId: "tab-1",
    url: "https://example.org/docs",
    title: "Manual",
    text: "untrusted page text",
    truncated: false,
  };
  assert.throws(() => browserSelectionIntelligenceRequest({
    selection, question: "resuma", confirmed: false,
  }), /explicitly confirm/);
});
