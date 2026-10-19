import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SIDEBAR_LAYOUT, createSidebarMarkup, sidebarBrandMarkup, sidebarNavigationCapacity, sidebarItemIsActive, mountNativeSidebarFit } from "../system/surface/ui/sidebar-layout.mjs";
import { projectSidebarAccount, sidebarAccountMarkup, sidebarProfileButtonMarkup, sidebarProfileMarkup, mountNativeSidebarAccount } from "../system/surface/ui/sidebar-account.mjs";
import { SIDEBAR_ENGLISH_MESSAGES } from "../system/services/i18n/catalog/sidebar.mjs";
import { MERIDIAN_RAIL_DESTINATIONS } from "../system/services/surface/meridian-navigation.mjs";
import { syncDesktopSidebarToggle } from "../system/surface/ui/desktop-shell.mjs";

test("sidebar slots preserve the same brand, home, navigation, account and auxiliary order", () => {
  assert.deepEqual(SIDEBAR_LAYOUT.map(slot => slot.key), ["brand", "home", "navigation", "account", "auxiliary"]);
  const html = createSidebarMarkup({ id: 'test"injection', label: '<unsafe>', content: { brand: '<span>Brand</span>' } });
  assert.ok(html.includes('id="test&quot;injection"'));
  assert.ok(html.includes('aria-label="&lt;unsafe&gt;"'));
  assert.ok(html.indexOf('data-sidebar-slot="navigation"') < html.indexOf('data-sidebar-slot="account"'));
});
test("Web and Native sidebar render one Meridian OrdaX OS wordmark", async () => {
  const [webNavigation, nativeShell, sharedStyles, webComposition] = await Promise.all([
    readFile(new URL("../system/surface/workspace/components/central/meridian-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/sidebar-layout.css", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8"),
  ]);
  const markup = sidebarBrandMarkup();
  assert.ok(markup.includes('class="brand-name">OrdaX</span>'));
  assert.ok(markup.includes('class="brand-sub">OS</span>'));
  assert.ok(!markup.includes("WEB"));
  assert.ok(webNavigation.includes("sidebarBrandMarkup()"));
  assert.ok(nativeShell.includes('brand: `<button type="button" class="meridian-brand-home"'));
  assert.ok(nativeShell.includes('home: `<div class="meridian-native-home-nav"><div class="ordax-space-switcher-slot" data-space-switcher-slot></div><button type="button" class="ordax-rail-button os-nav-item meridian-home-destination"'));
  assert.ok(nativeShell.includes('auxiliary: `<div class="ordax-power-slot" data-power-slot></div><button type="button" class="sidebar-collapse ordax-sidebar-toggle" data-sidebar-toggle'));
  const nativeRail = nativeShell.slice(nativeShell.indexOf("function meridianNavigation("), nativeShell.indexOf("function meridianNavigationMenu("));
  assert.ok(!nativeRail.includes("meridian-home-destination"));
  assert.ok(sharedStyles.includes(".brand-wordmark { display:block; }"));
  assert.ok(sharedStyles.includes(".brand-name { font-size:1.5rem; font-weight:550; letter-spacing:-.06em; line-height:1.05; }"));
  assert.ok(webComposition.includes("../../surface/ui/brand/symbol.css"));
});
test("Native and Web headers share Meridian dimensions and search styling", async () => {
  const [sharedHeader, nativeStyles] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
  ]);
  assert.match(sharedHeader, /\.meridian-workspace\s*\{\s*font:400 \.8125rem\/1\.5 var\(--md-font\);/);
  assert.match(sharedHeader, /--md-home-content-max:1320px;/);
  assert.match(sharedHeader, /--md-home-heading-size:clamp\(1\.75rem,3vw,2\.625rem\);/);
  assert.match(sharedHeader, /\.meridian-system-header \{height:66px;flex-shrink:0;display:flex;/);
  assert.match(sharedHeader, /\.meridian-system-search \{display:flex;align-items:center;gap:12px;width:min\(350px,36%\);/);
  assert.match(sharedHeader, /\.meridian-system-search kbd \{padding:0;border:0;background:transparent;/);
  assert.doesNotMatch(nativeStyles, /\.meridian-native-workspace \.ordax-native-header \{ display:grid/);
  assert.doesNotMatch(nativeStyles, /\.meridian-native-workspace \.meridian-system-search \{\s*height:42px/);
});
test("Web and Native share the Meridian rail destination order and grouping", async () => {
  const [webConfig, nativeShell, sharedSidebarStyles] = await Promise.all([
    readFile(new URL("../system/surface/workspace/components/central/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/sidebar-layout.css", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(MERIDIAN_RAIL_DESTINATIONS.map(item => item.key), ["home", "intelligence", "spaces", "apps", "profiles", "devices", "store"]);
  assert.deepEqual(MERIDIAN_RAIL_DESTINATIONS.filter(item => item.group === "principal").map(item => item.key), ["intelligence", "spaces", "apps"]);
  assert.deepEqual(MERIDIAN_RAIL_DESTINATIONS.filter(item => item.group === "ecossistema").map(item => item.key), ["profiles", "devices", "store"]);
  assert.match(webConfig, /MERIDIAN_RAIL_DESTINATIONS/);
  assert.match(nativeShell, /MERIDIAN_RAIL_DESTINATIONS/);
  assert.ok(nativeShell.includes('<p class="meridian-nav-label" data-nav-group-label="ecossistema">Ecossistema</p>'));
  assert.match(sharedSidebarStyles, /\.meridian-native-nav-group \{ display:flex; flex-direction:column; gap:5px;/);
});
test("Native Meridian navigation markup has matching styles and a clean collapsed rail", async () => {
  const [nativeShell, nativeStyles, sharedSidebarStyles] = await Promise.all([
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/sidebar-layout.css", import.meta.url), "utf8"),
  ]);
  for (const className of ["ordax-native-navigation-heading", "ordax-native-navigation-search", "ordax-native-navigation-list"]) {
    assert.ok(nativeShell.includes(`class="${className}"`));
    assert.match(nativeStyles, new RegExp(`\\.${className} \\{`));
  }
  assert.match(sharedSidebarStyles, /\.meridian-nav-label \{ display: none !important; \}/);
  assert.match(sharedSidebarStyles, /span:not\(\.ordax-rail-icon\) \{ display: none; \}/);
  assert.ok(nativeShell.includes('<span class="ordax-rail-icon">${ICONS.more}</span>'));
});
test("Native rail keeps shared Meridian destinations and exposes System as its control panel", async () => {
  const nativeShell = await readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8");
  const rail = nativeShell.slice(nativeShell.indexOf("function meridianNavigation("), nativeShell.indexOf("function meridianNavigationMenu("));
  const menu = nativeShell.slice(nativeShell.indexOf("function meridianNavigationMenu("), nativeShell.indexOf("export function createDesktopShellMarkup"));
  assert.ok(rail.includes('data-nav-group="dispositivo"'));
  assert.match(rail, /data-sidebar-app="system" data-launch-app="system"/);
  assert.match(rail, /data-nav-group-label="dispositivo"/);
  assert.ok(menu.includes('data-nav-menu-group="dispositivo"'));
  assert.match(menu, /const deviceApps = \["files", "studio", "settings", "system"\]/);
  assert.ok(menu.includes('data-nav-menu-app="${id}"'));
  assert.ok(nativeShell.includes('data-current-destination>${t("shell.home.title")}</span>'));
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

test("Native profile slot uses the shared compact Meridian account presentation", () => {
  const view = projectSidebarAccount({ state: "unavailable" });
  const html = sidebarProfileMarkup(view, true);
  assert.ok(html.includes('class="account-open meridian-rail-account"'));
  assert.ok(html.includes('data-launch-app="account" data-app-target="overview"'));
  assert.ok(html.includes("data-sidebar-account-status"));
  assert.ok(!html.includes("data-sidebar-storage"));
  assert.ok(!html.includes("data-sidebar-notifications"));
});
test("Web and Native profile slots share the same escaped account control and active state", async () => {
  const view = projectSidebarAccount({ state: "signed-in", subjectId: "private-id", displayName: '<img src=x onerror="run()"> Maria' });
  const webButton = sidebarProfileButtonMarkup(view, false, true);
  const nativeButton = sidebarProfileButtonMarkup(view, true);
  const nativeMarkup = sidebarProfileMarkup(view, true);
  const webNavigation = await readFile(new URL("../system/surface/workspace/components/central/meridian-navigation.tsx", import.meta.url), "utf8");
  assert.ok(webButton.includes('aria-current="page"'));
  assert.ok(webButton.includes("&lt;img"));
  assert.ok(!webButton.includes('<img'));
  assert.ok(!webButton.includes("data-launch-app"));
  assert.ok(nativeButton.includes('data-launch-app="account" data-app-target="overview"'));
  assert.ok(nativeMarkup.includes('class="account sidebar-account"'));
  assert.ok(nativeMarkup.includes('aria-label="&lt;img src=x onerror=&quot;run()&quot;&gt; Maria"'));
  assert.ok(webNavigation.includes("sidebarProfileButtonMarkup(sidebarAccount,false,activeWindow?.title==='Minha conta')"));
  assert.ok(webNavigation.includes("brand:<button type=\"button\" className=\"meridian-brand-home\""));
});
test("Web sidebar collapse control stays available in Central and desktop views", async () => {
  const webNavigation = await readFile(new URL("../system/surface/workspace/components/central/meridian-navigation.tsx", import.meta.url), "utf8");
  assert.match(webNavigation, /auxiliary:<button type="button" className="sidebar-collapse"/);
  assert.doesNotMatch(webNavigation, /auxiliary:view==='central'\?/);
  assert.match(webNavigation, /aria-controls="workspace-sidebar" aria-expanded=\{expanded\}/);
});

test("Native collapse control uses Meridian's panel glyph and state label", () => {
  const attributes = {};
  let markup = "";
  const button = {
    setAttribute(name, value) { attributes[name] = value; },
    querySelector() { return { set innerHTML(value) { markup = value; } }; },
  };
  const localization = { translate: id => id === "shell.sidebar.collapse" ? "Recolher sidebar" : "Expandir sidebar" };
  syncDesktopSidebarToggle(button, true, localization);
  assert.equal(attributes["aria-expanded"], "true");
  assert.equal(attributes["aria-label"], "Recolher sidebar");
  assert.equal(button.title, "Recolher sidebar");
  assert.match(markup, /M9 3v18/);
  syncDesktopSidebarToggle(button, false, localization);
  assert.equal(attributes["aria-expanded"], "false");
  assert.equal(attributes["aria-label"], "Expandir sidebar");
  assert.match(markup, /m14 9 3 3-3 3/);
});

test("sidebar active state distinguishes account destinations by their target", () => {
  const activeWindow = { appId: "account", target: "profiles" };
  assert.equal(sidebarItemIsActive(activeWindow, { dataset: { sidebarApp: "account", appTarget: "profiles" } }), true);
  assert.equal(sidebarItemIsActive(activeWindow, { dataset: { sidebarApp: "account", appTarget: "spaces" } }), false);
  assert.equal(sidebarItemIsActive(activeWindow, { dataset: { sidebarApp: "account" } }), false);
  assert.equal(sidebarItemIsActive(null, { dataset: { sidebarApp: "account", appTarget: "profiles" } }), false);
});

test("available navigation height includes row gaps without hiding a slot that fits", () => {
  const nav = { clientHeight: 236, ownerDocument: { defaultView: { getComputedStyle: () => ({ rowGap: "4px" }) } }, querySelector: () => ({ getBoundingClientRect: () => ({ height: 44 }) }), querySelectorAll: () => [] };
  assert.equal(sidebarNavigationCapacity(nav), 5);
  nav.clientHeight = 235;
  assert.equal(sidebarNavigationCapacity(nav), 4);
  nav.querySelector = () => null;
  assert.equal(sidebarNavigationCapacity(nav), 0);
});
test("navigation capacity measures the Ecosystem heading once and preserves it after overflow hides the group", () => {
  let headingVisible = true;
  const firstButton = { getBoundingClientRect: () => ({ height: 44, top: 33, bottom: 77 }) };
  const heading = { getBoundingClientRect: () => headingVisible ? ({ height: 30, top: 0, bottom: 30 }) : ({ height: 0, top: 0, bottom: 0 }), parentElement: { querySelector: () => firstButton } };
  const nav = {
    clientHeight: 236,
    ownerDocument: { defaultView: { getComputedStyle: element => element === nav ? ({ rowGap: "4px" }) : ({ marginTop: "0px", marginBottom: "0px" }) } },
    querySelector: () => firstButton,
    querySelectorAll: selector => selector === ".meridian-nav-label" ? [heading] : [],
  };
  assert.equal(sidebarNavigationCapacity(nav), 4);
  headingVisible = false;
  assert.equal(sidebarNavigationCapacity(nav), 4);
});
test("Native overflow measures destinations separately from the persistent Home slot", () => {
  const apps = Array.from({ length: 6 }, () => ({ hidden: false, getBoundingClientRect: () => ({ height: 44 }) }));
  const more = { hidden: true, getBoundingClientRect: () => ({ height: 44 }) };
  const groups = [
    { hidden: false, querySelector: () => apps.slice(0, 3).find(button => !button.hidden) },
    { hidden: false, querySelector: () => apps.slice(3).find(button => !button.hidden) },
  ];
  let resize, disconnected = false;
  const nav = {
    clientHeight: 188,
    ownerDocument: { defaultView: {
      getComputedStyle: () => ({ rowGap: "4px" }),
      ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() { disconnected = true; } },
    } },
    querySelectorAll: selector => selector === ".meridian-nav-destination button" ? apps : selector === "[data-nav-group]" ? groups : [],
    querySelector: selector => ["[data-nav-menu-more]", "[data-launcher-more]"].includes(selector) ? more : [...apps, more].find(button => !button.hidden),
  };
  const fit = mountNativeSidebarFit(nav, () => {});
  assert.equal(apps.filter(button => !button.hidden).length, 3);
  assert.equal(more.hidden, false);
  assert.equal(groups[0].hidden, false);
  assert.equal(groups[1].hidden, true);
  nav.clientHeight = 44; resize();
  assert.ok(apps.every(button => button.hidden));
  assert.ok(groups.every(group => group.hidden));
  assert.equal(more.hidden, false);
  nav.clientHeight = 332; resize();
  assert.ok(apps.every(button => !button.hidden));
  assert.ok(groups.every(group => !group.hidden));
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
  const [shared,webStyles,native,web,nativeStyles,brandStyles]=await Promise.all([
    read("system/surface/ui/sidebar-layout.css"),
    read("system/surface/workspace/components/central/meridian.css"),
    read("system/composition/native/index.html"),
    read("system/composition/web/main.tsx"),
    read("system/surface/ui/identity.css"),
    read("system/surface/ui/brand/symbol.css"),
  ]);
  assert.ok(shared.includes(".ordax-product-sidebar .meridian-rail-account {"));
  assert.ok(shared.includes(".meridian-workspace .ordax-product-sidebar { gap:16px; padding:27px 16px 18px; }"));
  assert.ok(shared.includes(":is(.ordax-space-switcher-trigger,.meridian-rail-space)"));
  assert.ok(brandStyles.includes('background: url("./ordax-symbol.png")'));
  assert.doesNotMatch(native,/style="mask-image:/);
  assert.doesNotMatch(webStyles,/\.meridian-workspace \.meridian-rail \{padding:/);
  assert.doesNotMatch(nativeStyles,/\.meridian-native-workspace \.ordax-rail \[data-sidebar-slot=\"navigation\"\]/);
  assert.doesNotMatch(webStyles,/^\.meridian-rail-account\s*\{/m);
  for(const entry of [native,web])assert.ok(entry.includes("surface/ui/sidebar-layout.css"));
});
test("Web and Native load the same Meridian workspace header rules", async () => {
  const [shared, webStyles, native] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(shared, /\.meridian-system-header \{[^}]*display:flex/);
  assert.doesNotMatch(webStyles, /\.meridian-system-header \{[^}]*display:flex/);
  assert.ok(native.includes("surface/ui/meridian.css"));
});
