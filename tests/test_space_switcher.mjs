import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import { deriveSpaceSwitcherView } from "../system/surface/ui/space-switcher-controls.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const subjectId = "subject-owner";
const spaces = [
  { id: "pizza", name: "Minha Pizzaria", kind: "professional", state: "active" },
  { id: "legal", name: "Advocacia", kind: "professional", state: "archived" },
];
const signedIn = { state: "signed-in", subjectId };
const ready = { state: "ready", spaces };
const selected = {
  state: "selected",
  subjectId,
  selectedSpace: { id: "pizza", name: "Minha Pizzaria", state: "active" },
};

test("Space switcher derives active identity exclusively from authenticated catalog and selection", () => {
  const view = deriveSpaceSwitcherView(signedIn, ready, selected);
  assert.equal(view.active?.name, "Minha Pizzaria");
  assert.deepEqual(view.visibleSpaces, spaces);
  assert.ok(Object.isFrozen(view));
  const foreignSubject = deriveSpaceSwitcherView(signedIn, ready, {
    ...selected, subjectId: "other-user",
  });
  assert.equal(foreignSubject.active, null);
  assert.deepEqual(foreignSubject.visibleSpaces, []);
  assert.deepEqual(foreignSubject.profilesBySpace, []);
  const unavailableSelection = deriveSpaceSwitcherView(signedIn, ready, {
    schema: "ordax.space-selection/1",
    state: "unavailable",
    subjectId: null,
    selectedSpace: null,
  });
  assert.deepEqual(unavailableSelection.visibleSpaces, []);
  assert.equal(unavailableSelection.active, null);
  const currentUnselected = deriveSpaceSwitcherView(signedIn, ready, {
    schema: "ordax.space-selection/1",
    state: "unselected",
    subjectId,
    selectedSpace: null,
  });
  assert.deepEqual(currentUnselected.visibleSpaces, spaces);
  assert.equal(
    deriveSpaceSwitcherView(signedIn, ready, {
      ...selected, selectedSpace: { id: "not-in-catalog" },
    }).active,
    null,
  );
  assert.equal(
    deriveSpaceSwitcherView(signedIn, ready, {
      ...selected, selectedSpace: { id: "legal" },
    }).active,
    null,
  );
});

test("Space switcher clears identities and catalog items on logout or stale catalog", () => {
  for (const identity of [{ state: "signed-out" }, { state: "unavailable" }]) {
    const view = deriveSpaceSwitcherView(identity, ready, selected);
    assert.deepEqual(view.visibleSpaces, []);
    assert.equal(view.active, null);
  }
  for (const state of ["loading", "unavailable", "error", "idle"]) {
    const view = deriveSpaceSwitcherView(signedIn, { state, spaces: [] }, selected);
    assert.deepEqual(view.visibleSpaces, []);
    assert.equal(view.active, null);
  }
});

test("Native and Web compose the same visible shell UI using real ports", () => {
  const shell = read("system/surface/ui/desktop-shell.mjs");
  const native = read("system/composition/native/main.mjs");
  const web = read("system/composition/web/main.mjs");
  const account = read("system/services/i18n/catalog/account.mjs");
  const component = read("system/surface/ui/space-switcher-controls.mjs");
  assert.match(shell, /data-space-switcher-slot/);
  for (const composition of [native, web]) {
    assert.match(composition, /mountSpaceSwitcherControls\(/);
    assert.match(composition, /spaceSwitcherControls\.destroy\(\)/);
    assert.match(composition, /identitySession,\s*spaces,/);
    assert.match(composition, /appActivation,\s*surface,/);
  }
  assert.match(native, /spaces,\s*spaceSelection,\s*appActivation/);
  assert.match(web, /spaces,\s*null,\s*appActivation/);
  assert.match(component, /assertSpaceSelectionPort/);
  assert.match(component, /selectionPort\.select\(match\.id\)/);
  assert.match(component, /activationPort\.publish\(\{ appId: "account", target: "spaces" \}\)/);
  assert.doesNotMatch(component, /\.createSpace\(|\.create\(|localStorage|sessionStorage/);
  assert.equal(account.split('"account.spaces.switcher.manage"').length - 1, 2);
  for (const composition of ["native", "web"]) {
    assert.match(read(`system/composition/${composition}/index.html`), /space-switcher\.css/);
  }
});

test("Professional Profile derives only from current activation on authorized Spaces", () => {
  const activation = {
    schema: "ordax.profile-activation-state/1",
    spaces: [
      {
        spaceId: "pizza", spaceKind: "professional",
        current: { profile: { slug: "pizzaria-br", version: 1 } },
        previous: { profile: { slug: "developer", version: 1 } },
      },
      {
        spaceId: "legal", spaceKind: "professional",
        current: { profile: { slug: "legal-br", version: 1 } }, previous: null,
      },
      {
        spaceId: "hidden", spaceKind: "professional",
        current: { profile: { slug: "developer", version: 1 } }, previous: null,
      },
    ],
  };
  const view = deriveSpaceSwitcherView(signedIn, ready, selected, activation);
  assert.deepEqual(view.activeProfile, { slug: "pizzaria-br", version: 1 });
  assert.deepEqual(view.profilesBySpace, [
    { spaceId: "pizza", profile: { slug: "pizzaria-br", version: 1 } },
    { spaceId: "legal", profile: null },
  ]);
  assert.equal(deriveSpaceSwitcherView(signedIn, ready,
    { ...selected, subjectId: "other-user" }, activation).activeProfile, null);
  assert.deepEqual(deriveSpaceSwitcherView(
    { state: "signed-out" }, ready, selected, activation).profilesBySpace, []);
  assert.equal(deriveSpaceSwitcherView(signedIn, ready, selected, {
    schema: "ordax.profile-activation-state/1",
    spaces: [{ spaceId: "pizza", spaceKind: "personal",
      current: { profile: { slug: "pizzaria-br", version: 1 } } }],
  }).activeProfile, null);
  assert.equal(deriveSpaceSwitcherView(signedIn, ready, selected, {
    schema: "ordax.profile-activation-state/1",
    spaces: [{ spaceId: "pizza", spaceKind: "professional",
      current: null, previous: { profile: { slug: "pizzaria-br", version: 1 } } }],
  }).activeProfile, null);
});

test("Native wires canonical Profile state to shell while Web remains without it", () => {
  const native = read("system/composition/native/main.mjs");
  const web = read("system/composition/web/main.mjs");
  const selector = read("system/surface/ui/space-switcher-controls.mjs");
  assert.match(native, /spaceSelection,\s*appActivation,\s*surface,\s*profileActivationState/);
  assert.match(web, /spaces,\s*null,\s*appActivation,\s*surface,\s*null/);
  assert.match(selector, /assertProfileActivationStatePort/);
  assert.match(selector, /lifecycle\.subscribeRender\(render\)/);
  assert.match(selector, /profilePort\?\.subscribe\?\.\(render\)/);
  assert.match(read("system/surface/ui/account-overview-controls.mjs"),
    /profileActivationPort\?\.subscribe\?\.\(/);
});

test("Space selector retains catalog choices after transient selection failure", () => {
  const component = read("system/surface/ui/space-switcher-controls.mjs");
  assert.match(component, /selectionFailed = true;\s*render\(\);/);
  assert.match(component, /if \(selectionFailed\) \{[\s\S]*?role", "alert"/);
  assert.match(component, /menu\.append\(list\);\s*if \(selectionFailed\)/);
  assert.doesNotMatch(component, /catch \{\s*error = true;\s*render\(\);/);
  assert.match(component, /if \(open\) \{ error = false; selectionFailed = false; \}/);
});

test("Space selector keeps navigable, dismissible, focus-safe popup on updates", () => {
  const component = read("system/surface/ui/space-switcher-controls.mjs");
  const smoke = read("tools/surface-web/browser-smoke.mjs");
  assert.match(component, /aria-haspopup", "dialog"/);
  assert.match(component, /menu\.setAttribute\("role", "dialog"\)/);
  assert.match(component, /const focusOption = \(key\) =>/);
  assert.match(component, /\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(component, /doc\.addEventListener\("focusin", onFocusIn\)/);
  assert.match(component, /doc\.removeEventListener\("focusin", onFocusIn\)/);
  assert.match(component, /focusedSpaceId/);
  assert.match(smoke, /spaceSwitcherKeyboardOpens/);
  assert.match(smoke, /spaceSwitcherKeyboardFocusesAction/);
  assert.match(smoke, /spaceSwitcherKeyboardRestoresFocus/);
});
