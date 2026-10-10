import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FIRST_PARTY_APP_SCHEMA, defineFirstPartyApp } from "../system/contracts/first-party-app.mjs";
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

import {
  IDENTITY_SESSION_SCHEMA,
  validateIdentitySessionSnapshot,
  assertIdentitySessionPort,
} from "../system/contracts/identity-session.mjs";
import {
  PROFILE_ACTIVATION_STATE_SCHEMA,
  PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
  createEmptyProfileActivationState,
  assertProfileActivationStatePort,
} from "../system/contracts/profile-activation-state.mjs";
import {
  SPACE_SELECTION_SCHEMA,
  validateSpaceSelectionSnapshot,
} from "../system/contracts/space-selection.mjs";
import {
  SPACES_PORT_SCHEMA,
  SPACES_SNAPSHOT_SCHEMA,
  assertSpacesPort,
} from "../system/contracts/spaces.mjs";
import {
  PROJECT_WEB_REFERENCES_SCHEMA,
  validateProjectWebReferences,
} from "../system/contracts/project-web-references.mjs";

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
  assert.equal(bundle.bundle_version, "1.16.0");
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
  const firstParty = lookup.get("first-party-app");
  assert.equal(firstParty?.schema, FIRST_PARTY_APP_SCHEMA);
  assert.equal(firstParty?.source_path, "system/contracts/first-party-app.mjs");
  assert.match(firstParty?.source_git_blob, /^[0-9a-f]{40}$/);
  assert.equal(typeof defineFirstPartyApp, "function");
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

test("SDK 1.14 publishes identity, profile, space and web-reference source contracts without native authority", async () => {
  const bundle = JSON.parse(await readFile(new URL("sdk/app-sdk-v1/bundle.json", base), "utf8"));
  const byName = new Map(bundle.contracts.map(item => [item.name, item]));
  const requirements = new Map([
    ["identity-session", IDENTITY_SESSION_SCHEMA],
    ["profile-activation-state", PROFILE_ACTIVATION_STATE_SCHEMA],
    ["profile-activation-state-port", PROFILE_ACTIVATION_STATE_PORT_SCHEMA],
    ["project-web-references", PROJECT_WEB_REFERENCES_SCHEMA],
    ["space-selection", SPACE_SELECTION_SCHEMA],
    ["space-selection-record", "ordax.space-selection-record/1"],
    ["space-selection-store", "ordax.space-selection-store/1"],
    ["spaces", SPACES_PORT_SCHEMA],
    ["spaces-profile-packs", "ordax.profile-packs/1"],
    ["spaces-snapshot", SPACES_SNAPSHOT_SCHEMA],
  ]);
  for (const [name, schema] of requirements) {
    const item = byName.get(name);
    assert.ok(item, name);
    assert.equal(item.schema, schema);
    assert.equal(item.major, 1);
    assert.match(item.source_path, /^system\/contracts\/[a-z-]+\.mjs$/);
    assert.match(item.source_git_blob, /^[0-9a-f]{40}$/);
  }
  const snapshot = validateIdentitySessionSnapshot({ state: "signed-out" });
  assert.deepEqual(snapshot, { state: "signed-out", subjectId: null, displayName: null });
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  };
  assert.equal(assertIdentitySessionPort(identity), identity);
  assert.equal(createEmptyProfileActivationState().spaces.length, 0);
  assert.throws(() => assertProfileActivationStatePort({
    schema: PROFILE_ACTIVATION_STATE_PORT_SCHEMA,
    getSnapshot: () => createEmptyProfileActivationState(),
    refresh: () => {},
  }), /dispose/);
  assert.equal(validateSpaceSelectionSnapshot({
    schema: SPACE_SELECTION_SCHEMA,
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  }).selectedSpace, null);
  assert.deepEqual(validateProjectWebReferences([]), []);
  const readOnlySpaces = {
    schema: SPACES_PORT_SCHEMA,
    getSnapshot: () => ({ schema: SPACES_SNAPSHOT_SCHEMA, state: "ready", spaces: [] }),
    subscribe: () => () => {},
    refresh: () => {},
    reset: () => {},
  };
  assert.equal(assertSpacesPort(readOnlySpaces), readOnlySpaces);
  assert.throws(() => assertSpacesPort({ ...readOnlySpaces, execute() {} }), /must not implement/);
});
