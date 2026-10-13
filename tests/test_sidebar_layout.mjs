import test from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR_LAYOUT, createSidebarMarkup, sidebarNavigationCapacity, mountNativeSidebarFit } from "../system/surface/ui/sidebar-layout.mjs";
import { projectSidebarAccount, sidebarAccountMarkup } from "../system/surface/ui/sidebar-account.mjs";
import { SIDEBAR_ENGLISH_MESSAGES } from "../system/services/i18n/catalog/sidebar.mjs";

test("sidebar slots preserve the same brand, home, navigation, account and auxiliary order", () => {
  assert.deepEqual(SIDEBAR_LAYOUT.map(slot => slot.key), ["brand", "home", "navigation", "account", "auxiliary"]);
  const html = createSidebarMarkup({ id: 'test"injection', label: '<unsafe>', content: { brand: '<span>Brand</span>' } });
  assert.ok(html.includes('id="test&quot;injection"'));
  assert.ok(html.includes('aria-label="&lt;unsafe&gt;"'));
  assert.ok(html.indexOf('data-sidebar-slot="navigation"') < html.indexOf('data-sidebar-slot="account"'));
});
test("account presentation escapes public names and does not invent storage, plan or credentials", () => {
  const view = projectSidebarAccount({ state: "signed-in", subjectId: "private-id", displayName: '<img src=x onerror="run()"> Maria' });
  const html = sidebarAccountMarkup(view);
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('private-id'));
  assert.ok(!html.includes('500 GB'));
  assert.ok(html.includes('Uso indisponível'));
  assert.ok(!html.includes('data-launch-app'));
});
test("logout and loss of identity erase the signed-in name and initials immediately", () => {
  const signed = projectSidebarAccount({ state: "signed-in", subjectId: "id", displayName: "Maria Santos" });
  assert.equal(signed.initials, "MS");
  for (const state of ["signed-out", "unavailable"]) {
    const view = projectSidebarAccount({ state, displayName: "stale", subjectId: "id" });
    assert.equal(view.initials, null);
    assert.ok(!sidebarAccountMarkup(view).includes('Maria Santos'));
    assert.ok(!sidebarAccountMarkup(view).includes('stale'));
  }
});
test("Native uses the canonical account target while preview notification and localization stay explicit", () => {
  const view = projectSidebarAccount({ state: "unavailable" }, true, id => SIDEBAR_ENGLISH_MESSAGES[id]);
  const html = sidebarAccountMarkup(view, true);
  assert.equal(view.status, "Offline");
  assert.ok(html.includes('data-launch-app="account" data-app-target="overview"'));
  assert.ok(html.includes('Notifications unavailable in this preview'));
  assert.ok(html.includes('data-sidebar-notifications disabled'));
  assert.throws(() => projectSidebarAccount({ state: "signed-in" }), TypeError);
});

test("available navigation height includes row gaps without hiding a slot that fits", () => {
  const nav = { clientHeight: 236, ownerDocument: { defaultView: { getComputedStyle: () => ({ rowGap: "4px" }) } }, querySelector: () => ({ getBoundingClientRect: () => ({ height: 44 }) }) };
  assert.equal(sidebarNavigationCapacity(nav), 5);
  nav.clientHeight = 235;
  assert.equal(sidebarNavigationCapacity(nav), 4);
  nav.querySelector = () => null;
  assert.equal(sidebarNavigationCapacity(nav), 0);
});
test("Native overflow keeps a launcher and recovers all shortcuts after growing", () => {
  const apps = Array.from({ length: 6 }, () => ({ hidden: false, getBoundingClientRect: () => ({ height: 44 }) }));
  const more = { hidden: true, getBoundingClientRect: () => ({ height: 44 }) };
  let resize, disconnected = false;
  const nav = {
    clientHeight: 236,
    ownerDocument: { defaultView: {
      getComputedStyle: () => ({ rowGap: "4px" }),
      ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() { disconnected = true; } },
    } },
    querySelectorAll: () => apps,
    querySelector: selector => selector === "[data-launcher-toggle]" ? more : [...apps, more].find(button => !button.hidden),
  };
  const fit = mountNativeSidebarFit(nav, () => {});
  assert.equal(apps.filter(button => !button.hidden).length, 4);
  assert.equal(more.hidden, false);
  nav.clientHeight = 44; resize();
  assert.ok(apps.every(button => button.hidden));
  assert.equal(more.hidden, false);
  nav.clientHeight = 284; resize();
  assert.ok(apps.every(button => !button.hidden));
  assert.equal(more.hidden, true);
  fit.destroy();
  assert.equal(disconnected, true);
});
