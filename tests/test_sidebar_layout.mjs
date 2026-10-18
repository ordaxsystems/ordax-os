import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SIDEBAR_LAYOUT, createSidebarMarkup, sidebarNavigationCapacity, mountNativeSidebarFit } from "../system/surface/ui/sidebar-layout.mjs";
import { projectSidebarAccount, sidebarAccountMarkup, mountNativeSidebarAccount } from "../system/surface/ui/sidebar-account.mjs";
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

test("shared account connection state follows verified identity, offline and logout", () => {
  const identity = {state:"signed-in",subjectId:"test-subject",displayName:"Maria Santos"};
  const online = projectSidebarAccount(identity);
  assert.equal(online.connected,true);
  assert.equal(online.status,"Sessão verificada");
  assert.ok(sidebarAccountMarkup(online,true).includes('class="account-open meridian-rail-account"'));
  assert.ok(sidebarAccountMarkup(online,true).includes('data-connected="true"'));
  const offline = projectSidebarAccount(identity,true,id=>SIDEBAR_ENGLISH_MESSAGES[id]);
  assert.equal(offline.connected,false);
  assert.equal(offline.status,"Offline");
  assert.equal(offline.displayName,"Maria Santos");
  for (const state of ["signed-out","unavailable"]) {
    const view=projectSidebarAccount({state,displayName:"stale",subjectId:"test-subject"});
    assert.equal(view.connected,false);
    assert.equal(view.initials,null);
    assert.ok(!sidebarAccountMarkup(view,true).includes("stale"));
    assert.ok(sidebarAccountMarkup(view,true).includes('data-connected="false"'));
  }
});

test("Native account binding clears stale identity and updates the shared indicator on capability loss", () => {
  let identity={state:"signed-in",subjectId:"test-subject",displayName:"Maria Santos"};
  let host={capabilityIds:["account.identity"],connectivity:"online"};
  const callbacks=new Map();
  const port=(key,getSnapshot)=>({schema:"ordax.identity-session/1",getSnapshot,subscribe(fn){callbacks.set(key,fn);return()=>callbacks.delete(key);}});
  const nodes=new Map();
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{textContent:"",innerHTML:"",attributes:new Map(),setAttribute(name,value){this.attributes.set(name,value);}});
    return nodes.get(selector);
  };
  const card={...node("card"),querySelector:node};
  const binding=mountNativeSidebarAccount({querySelector:()=>card},port("identity",()=>identity),port("host",()=>host),{
    localization:{translate:id=>SIDEBAR_ENGLISH_MESSAGES[id],subscribe:fn=>{callbacks.set("locale",fn);return()=>callbacks.delete("locale");}},
  });
  assert.equal(node("[data-sidebar-account-connected]").attributes.get("data-connected"),"true");
  host={...host,connectivity:"offline"};callbacks.get("host")();
  assert.equal(node("[data-sidebar-account-status]").textContent,"Offline");
  assert.equal(node("[data-sidebar-account-connected]").attributes.get("data-connected"),"false");
  host={capabilityIds:[],connectivity:"online"};callbacks.get("host")();
  assert.equal(node("[data-sidebar-account-name]").textContent,"Account not connected");
  assert.ok(node("[data-sidebar-avatar]").innerHTML.includes("<svg"));
  identity={state:"signed-out",subjectId:null,displayName:null};
  host={...host,capabilityIds:["account.identity"]};callbacks.get("identity")();
  assert.equal(node("[data-sidebar-account-name]").textContent,"Sign in to account");
  assert.equal(node("[data-sidebar-account-status]").textContent,"Connect account");
  assert.equal(node("[data-sidebar-account-connected]").attributes.get("data-connected"),"false");
  binding.destroy();
  assert.equal(callbacks.size,0);
});

test("Web and Native load one Meridian sidebar profile stylesheet owner", async () => {
  const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
  const [shared,webStyles,native,web]=await Promise.all([
    read("system/surface/ui/sidebar-layout.css"),
    read("system/surface/workspace/components/central/meridian.css"),
    read("system/composition/native/index.html"),
    read("system/composition/web/main.tsx"),
  ]);
  assert.ok(shared.includes(".ordax-product-sidebar .meridian-rail-account {"));
  assert.doesNotMatch(webStyles,/^\.meridian-rail-account\s*\{/m);
  for(const entry of [native,web])assert.ok(entry.includes("surface/ui/sidebar-layout.css"));
});
