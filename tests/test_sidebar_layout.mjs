import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SIDEBAR_LAYOUT, createSidebarMarkup, sidebarBrandMarkup, sidebarNavigationCapacity, sidebarItemIsActive, mountNativeSidebarFit, sidebarIsExpanded } from "../system/surface/ui/sidebar-layout.mjs";
import { projectSidebarAccount, sidebarAccountMarkup, sidebarProfileButtonMarkup, sidebarProfileMarkup, mountNativeSidebarAccount } from "../system/surface/ui/sidebar-account.mjs";
import { SIDEBAR_ENGLISH_MESSAGES } from "../system/services/i18n/catalog/sidebar.mjs";
import { MERIDIAN_RAIL_DESTINATIONS } from "../system/services/surface/meridian-navigation.mjs";
import { listSurfaceShortcutAppIds } from "../system/services/surface/shortcut-catalog.mjs";
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
  assert.ok(nativeShell.includes('home: `<div class="meridian-native-home-nav"><div class="ordax-space-switcher-slot" data-space-switcher-slot></div><div class="meridian-native-area-control">'));
  assert.ok(nativeShell.includes('class="ordax-rail-button os-nav-item meridian-home-destination"'));
  assert.ok(nativeShell.includes('auxiliary: `<div class="ordax-power-slot" data-power-slot></div><button type="button" class="sidebar-collapse ordax-sidebar-toggle" data-sidebar-toggle'));
  const nativeRail = nativeShell.slice(nativeShell.indexOf("function meridianNavigation("), nativeShell.indexOf("function meridianNavigationMenu("));
  assert.ok(!nativeRail.includes("meridian-home-destination"));
  assert.ok(sharedStyles.includes(".brand-wordmark { display:block; }"));
  assert.ok(sharedStyles.includes(".brand-name { font-size:1.5rem; font-weight:550; letter-spacing:-.06em; line-height:1.05; }"));
  assert.ok(webComposition.includes("../../surface/ui/brand/symbol.css"));
});
test("Native and Web omit the global Meridian header while keeping top controls elsewhere", async () => {
  const [sharedStyles, nativeStyles, tokens, nativeShell, webNavigation, webCentral] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/central.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(sharedStyles, /\.meridian-system-header|\.meridian-system-search|\.meridian-planned-indicator/);
  assert.doesNotMatch(nativeStyles, /ordax-native-header|meridian-system-header|meridian-system-search|meridian-header-status-actions/);
  assert.doesNotMatch(tokens, /--md-bar:/);
  assert.doesNotMatch(nativeShell, /ordax-native-header|meridian-system-header|data-current-destination/);
  assert.doesNotMatch(webNavigation, /WorkspaceHeader|meridian-system-header/);
  assert.doesNotMatch(webCentral, /WorkspaceHeader/);
  assert.match(nativeStyles, /grid-template-rows: minmax\(0, 1fr\) calc\(var\(--ordax-navigation-height\)/);
  assert.ok(nativeShell.includes('data-area-menu-toggle'));
  assert.ok(nativeShell.includes('data-update-slot'));
});
test("Web and Native share the Meridian rail destination order and grouping", async () => {
  const [webConfig, nativeShell, sharedSidebarStyles, tokens] = await Promise.all([
    readFile(new URL("../system/surface/workspace/components/central/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/sidebar-layout.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.tokens.css", import.meta.url), "utf8"),
  ]);
  assert.deepEqual(MERIDIAN_RAIL_DESTINATIONS.map(item => item.key), ["home", "intelligence", "spaces", "apps", "profiles", "devices", "store"]);
  assert.deepEqual(MERIDIAN_RAIL_DESTINATIONS.filter(item => item.group === "principal").map(item => item.key), ["intelligence", "spaces", "apps"]);
  assert.deepEqual(MERIDIAN_RAIL_DESTINATIONS.filter(item => item.group === "ecossistema").map(item => item.key), ["profiles", "devices", "store"]);
  assert.match(webConfig, /MERIDIAN_RAIL_DESTINATIONS/);
  assert.match(nativeShell, /MERIDIAN_RAIL_DESTINATIONS/);
  assert.equal((nativeShell.match(/ICONS\[destination\.glyph\]/g) ?? []).length, 3, "Native home, navigation, and overflow menu use canonical Meridian glyph metadata");
  assert.ok(nativeShell.includes('<p class="meridian-nav-label" data-nav-group-label="ecossistema">Ecossistema</p>'));
  assert.match(sharedSidebarStyles, /\.meridian-workspace \.ordax-product-sidebar \.meridian-native-nav-group \{ display:flex; flex-direction:column; gap:var\(--md-sidebar-nav-gap\);/);
  assert.match(tokens, /--md-sidebar-nav-gap:\.3125rem;/);
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
test("Web and Native desktop shortcuts share Meridian geometry tokens", async () => {
  const [tokens, nativeStyles, webStyles, meridianStyles, nativeShell, webDesktop, nativeEntry, webEntry] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/desktop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/index.html", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8"),
  ]);
  for (const definition of [
    "--md-desktop-shortcut-inset:1.5rem;",
    "--md-desktop-shortcut-cell:5.75rem;",
    "--md-desktop-shortcut-gap:.625rem;",
    "--md-desktop-shortcut-icon:2.6875rem;",
    "--md-desktop-shortcut-glyph-size:1.5rem;",
    "--md-desktop-shortcut-padding:.375rem .25rem;",
    "--md-desktop-shortcut-radius:.625rem;",
    "--md-desktop-shortcut-icon-radius:.75rem;",
    "--md-desktop-shortcut-label-size:.6875rem;",
    "--md-desktop-shortcut-label-weight:500;",
    "--md-desktop-shortcut-label-leading:1.2;",
    "--md-desktop-shortcut-label-lines:2;",
    "--md-desktop-shortcut-icon-shadow:0 2px 8px rgb(21 35 29 / 15%);",
    "--md-desktop-shortcut-label-shadow:0 1px 3px rgb(20 36 29 / 60%);",
  ]) assert.ok(tokens.includes(definition), `${definition} is owned by the shared Meridian tokens`);
  for (const definition of [
    "var(--md-desktop-shortcut-cell)", "var(--md-desktop-shortcut-gap)",
    "var(--md-desktop-shortcut-icon)", "var(--md-desktop-shortcut-glyph-size)",
    "var(--md-desktop-shortcut-radius)", "var(--md-desktop-shortcut-icon-radius)",
    "var(--md-desktop-shortcut-padding)", "var(--md-desktop-shortcut-label-size)",
    "var(--md-desktop-shortcut-label-weight)", "var(--md-desktop-shortcut-label-leading)",
    "var(--md-desktop-shortcut-icon-shadow)", "var(--md-desktop-shortcut-label-shadow)",
  ]) assert.ok(meridianStyles.includes(definition), "Shared Meridian layout is missing " + definition);  assert.ok(meridianStyles.includes(".ordax-desktop-shortcuts,.desktop-shortcuts"));
  assert.ok(meridianStyles.includes("repeat(auto-fill,var(--md-desktop-shortcut-cell))"), "available height determines the shared row count");
  assert.ok(meridianStyles.includes("-webkit-line-clamp:var(--md-desktop-shortcut-label-lines)"), "long shortcut labels stay within two lines in both hosts");
  assert.ok(nativeShell.includes('class="ordax-desktop-shortcuts"'));
  assert.ok(webDesktop.includes('className="desktop-shortcuts"'));
  assert.ok(webDesktop.includes("title={item.name}"), "truncated Web labels retain a full-name tooltip");
  assert.ok(nativeEntry.includes('href="../../surface/ui/meridian.css"'));
  assert.ok(webEntry.includes("../../surface/ui/meridian.css"));
  assert.doesNotMatch(nativeStyles, /\.ordax-desktop-shortcuts\s*\{/);
  assert.doesNotMatch(webStyles, /\.desktop-shortcuts\s*\{/);
  assert.doesNotMatch(webStyles, /max-height:\s*760px[^}]*\.desktop-shortcuts/);
});
test("Web and Native desktop canvas share the Meridian wallpaper and contrast preference", async () => {
  const [tokens, nativeStyles, webStyles, sharedMeridianStyles, webDesktop, nativeEntry, webEntry] = await Promise.all([
    readFile(new URL("../system/surface/ui/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/desktop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/index.html", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8"),
  ]);
  assert.ok(sharedMeridianStyles.includes('--md-desktop-wallpaper:url("./brand/meridian-field.svg")'));
  assert.ok(sharedMeridianStyles.includes(":is(.classic-desktop,.ordax-workspace)::before"));
  assert.doesNotMatch(nativeStyles, /\.ordax-workspace::before\s*\{/);
  assert.ok(sharedMeridianStyles.includes("opacity:var(--ordax-wallpaper-opacity,1)"));
  assert.ok(sharedMeridianStyles.includes('[data-ordax-contrast="high"] :is(.ordax-desktop-shortcut,.desktop-shortcut)'));
  assert.ok(tokens.includes("[data-ordax-contrast=\"high\"]"));
  assert.ok(tokens.includes("--ordax-wallpaper-opacity: 0"));
  assert.ok(nativeEntry.includes('href="../../surface/ui/meridian.css"'));
  assert.ok(webEntry.includes("../../surface/ui/meridian.css"));
  assert.doesNotMatch(webDesktop, /meridian-field|desktop-wallpaper|desktop-watermark|OrdaX OS Web/);
  assert.doesNotMatch(webStyles, /\.desktop-wallpaper|\.desktop-watermark/);
  assert.doesNotMatch(nativeStyles, /brand\/meridian-field\.svg/);
});
test("Native USB keeps the computer shell instead of switching to mobile geometry", async () => {
  const [nativeStyles, sharedMeridianStyles, tokens, nativeSettings, nativeAccount, nativeNotifications, nativeSettingsJourney, sidebarStyles, webStyles, webResponsive, webEntry] = await Promise.all([
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/settings.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/account.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/notification-center.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/journeys/settings.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/sidebar-layout.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/web/responsive.css", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8"),
  ]);
  const nativePhoneLayoutStyles = await Promise.all([
    "surface.css", "first-run.css", "workspace-areas.css", "system.css", "local-session-lock.css",
    "space-switcher.css", "files.css",
  ].map(file => readFile(new URL(`../system/surface/ui/${file}`, import.meta.url), "utf8")));
  assert.doesNotMatch(nativeStyles, /@media\s*\(max-width:\s*(?:760|600|560|420)px/i, "Native must not switch to a phone layout at narrow viewport widths");
  assert.doesNotMatch(nativeStyles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.ordax-home-panel\s*\{[^}]*flex-direction:\s*column/i, "Native Home keeps its desktop information layout");
  assert.equal((nativeStyles.match(/@container\s+meridian-native-home\s*\(/g) ?? []).length, 3, "Native Home responds to the available computer workspace width");
  assert.match(nativeStyles, /@container\s+meridian-native-home\s*\(max-width:\s*66rem\)[\s\S]*?\.ordax-home-panel\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "medium computer workspaces reflow the existing Home areas");
  assert.match(nativeStyles, /@container\s+meridian-native-home\s*\(max-width:\s*50rem\)[\s\S]*?\.ordax-home-panel\s*\{\s*grid-template-areas:/, "narrow computer workspaces preserve and reorder the same Home areas");
  assert.doesNotMatch(nativeStyles, /@media\s*\(max-width:/i, "Native shell geometry never switches according to a mobile viewport breakpoint");
  assert.doesNotMatch(nativeStyles, /meridian-mobile-menu/i, "Native has no mobile-only menu styling");
  assert.doesNotMatch(sharedMeridianStyles, /@container\s+meridian-native-home/i);
  assert.doesNotMatch(sharedMeridianStyles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\[data-meridian\]\s*\{[^}]*--md-desktop-shortcut/i, "shared Meridian styles do not shrink Native desktop shortcuts for phones");
  assert.doesNotMatch(sidebarStyles, /@media\s*\(max-width:/i, "viewport-responsive rail behavior is owned by the Web composition");
  assert.doesNotMatch(tokens, /@media\s*\(max-width:\s*600px\)\s*\{\s*\[data-meridian\]/i, "shared tokens do not change Native dock geometry by viewport width");
  assert.doesNotMatch(tokens, /@media\s*\(max-width:\s*1100px\)[\s\S]*?--ordax-rail-width/i, "Native sidebar width follows its explicit user state instead of automatic viewport collapse");
  for (const styles of [nativeNotifications, nativeSettingsJourney]) {
    assert.doesNotMatch(styles, /@media\s*\(max-width:/i, "Native screens do not switch to phone layouts at narrow viewport widths");
  }
  for (const styles of nativePhoneLayoutStyles) {
    assert.doesNotMatch(styles, /@media\s*\([^)]*max-width:\s*(?:820|760|650|620|600|560|450)px/i, "Native app surfaces retain computer layouts across their screens");
  }
  assert.doesNotMatch(nativeAccount, /@media\s*\(max-width:/i, "Native account rules adapt to their app window, not phone viewport breakpoints");
  assert.doesNotMatch(nativeSettings, /@media\s*\(max-width:/i, "Native settings rules adapt to their app window, not phone viewport breakpoints");
  assert.match(webEntry, /import ['"]\.\/responsive\.css['"];?/);
  assert.match(webResponsive, /@media\s*\(max-width:\s*600px\)[\s\S]*?\.window-workspace\.meridian-workspace \.ordax-product-sidebar\s*\{\s*display:\s*none/i,
    "only the Web composition may hide its rail at phone widths");
  assert.match(webResponsive, /@media\s*\(max-width:\s*950px\)\s*and\s*\(min-width:\s*601px\)[\s\S]*?\.sidebar-collapse\)\s*\{\s*display:\s*none/i,
    "only the Web composition compacts the sidebar controls at intermediate widths");
  const nativeJourneys = await readFile(new URL("../system/surface/ui/journeys/styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(nativeJourneys, /@media\s*\([^)]*max-width:\s*(?:650|620|600|560|450)px/i, "Native journeys do not turn into mobile sheets or vertical trails");
  assert.match(nativeStyles, /\[data-native-sidebar="collapsed"\] \.ordax-shell \{ --ordax-rail-width: var\(--ordax-sidebar-collapsed-width\); \}/);
  assert.match(nativeStyles, /\[data-native-sidebar="expanded"\] \.ordax-shell \{ --ordax-rail-width: var\(--ordax-sidebar-expanded-width\); \}/);
  assert.doesNotMatch(nativeStyles, /\.ordax-shell\.meridian-native-workspace\[data-view="desktop"\]\s*\{[^}]*--ordax-rail-width/,
    "sidebar width follows the user's navigation state, not the Central/Desktop workspace presentation");
  assert.match(webStyles, /@media\s*\(max-width:\s*600px\)/i, "responsive layouts remain a Web capability");
  assert.match(webStyles, /@media\(max-width:600px\)\s*\{\.meridian-workspace\s*\{--md-dock:4\.5rem;/i, "the Web dock retains its mobile size adjustment");
  assert.match(webStyles, /@media\(max-width:760px\)\s*\{\.meridian-workspace\s*\{--md-desktop-shortcut-inset/i, "the Web may compact its shortcut grid at phone widths");
});
test("Web Settings loads the Meridian presentation used by its rendered component", async () => {
  const [webEntry, settingsPresentation] = await Promise.all([
    readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/journeys/settings.css", import.meta.url), "utf8"),
  ]);
  assert.match(webEntry, /import ['"]\.\.\/\.\.\/surface\/ui\/journeys\/settings\.css['"];?/);
  assert.match(settingsPresentation, /\.wm-settings\s*\{[^}]*container:\s*settings-web\s*\/\s*inline-size/);
  assert.match(settingsPresentation, /\.wm-settings-grid\s*\{[^}]*display:\s*grid/);
});
test("Web and Native taskbars share one Meridian frame and dock glyph scale", async () => {
  const [tokens, sharedStyles, nativeStyles, webStyles, nativeShell, webNavigation] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian-navigation.tsx", import.meta.url), "utf8"),
  ]);
  assert.ok(tokens.includes("--md-taskbar-side-min:5.3125rem"));
  assert.ok(tokens.includes("--md-taskbar-inline-padding:1.25rem"));
  assert.ok(tokens.includes("--md-taskbar-control-gap:.4375rem"));
  assert.ok(tokens.includes("--md-dock-glyph-size:1.3125rem"));
  assert.ok(sharedStyles.includes("grid-template-columns:minmax(max-content,1fr) minmax(0,auto) minmax(max-content,1fr)"));
  assert.ok(sharedStyles.includes(".meridian-taskbar-start,.meridian-taskbar-end"));
  assert.ok(nativeShell.includes('class="ordax-dock ordax-statusbar meridian-taskbar"'));
  assert.ok(webNavigation.includes('className="desktop-taskbar workspace-navigation meridian-taskbar"'));
  assert.doesNotMatch(nativeStyles, /\.meridian-native-workspace \.ordax-statusbar \{\s*display:grid;\s*grid-template-columns/);
  assert.doesNotMatch(webStyles, /\.meridian-workspace \.meridian-taskbar \{display:grid;grid-template-columns/);
  assert.ok(sharedStyles.includes("var(--md-dock-glyph-size)"));
  assert.doesNotMatch(nativeStyles, /\.ordax-running-app \.ordax-rail-icon svg \{ width:/);
  assert.doesNotMatch(webStyles, /\.meridian-dock \.app-icon svg \{width:/);
});
test("Web and Native dock items share Meridian geometry and open, active, and minimized states", async () => {
  const [sharedStyles, nativeStyles, webStyles, nativeRuntime] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/surface.mjs", import.meta.url), "utf8"),
  ]);
  assert.ok(sharedStyles.includes(":is(.ordax-dock-shortcut,.ordax-running-app,.desktop-task)"));
  assert.ok(sharedStyles.includes("var(--md-dock-control-size)"));
  assert.ok(sharedStyles.includes("[data-active=\"true\"]::after"));
  assert.ok(sharedStyles.includes("[data-minimized=\"true\"]::after"));
  assert.ok(nativeRuntime.includes("button.dataset.minimized = String(windowState.minimized)"));
  assert.doesNotMatch(nativeStyles, /\.meridian-dock-shortcuts \.ordax-dock-shortcut \{ display:grid/);
  assert.doesNotMatch(nativeStyles, /\.ordax-running-app \{ display:grid/);
  assert.doesNotMatch(webStyles, /\.meridian-dock \.desktop-task \{display:grid/);
});
test("Web and Native taskbar controls share Meridian focus, hover, and accurate pressed states", async () => {
  const [sharedStyles, nativeStyles, webStyles] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/identity.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian.css", import.meta.url), "utf8"),
  ]);
  assert.ok(sharedStyles.includes("[data-workspace-switch],[data-presentation-toggle])[aria-pressed=\"true\"]"));
  assert.ok(sharedStyles.includes(".meridian-taskbar button:focus-visible"));
  assert.ok(sharedStyles.includes(".ordax-tray-item[aria-expanded=\"true\"]"));
  assert.doesNotMatch(nativeStyles, /\.ordax-presentation-toggle\[aria-pressed="true"\]/);
  assert.doesNotMatch(webStyles, /\.meridian-taskbar-start \[data-workspace-switch\] \{background:/);
});
test("Web and Native windows share the Meridian chrome and titlebar control scale", async () => {
  const [tokens, sharedStyles, nativeStyles, webStyles, webWindowLayer, nativeWindowMarkup] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/surface.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/window-layer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/surface.mjs", import.meta.url), "utf8"),
  ]);
  assert.ok(tokens.includes("--ordax-window-titlebar-height:3.375rem"));
  assert.ok(tokens.includes("--ordax-window-control-size:2.75rem"));
  assert.ok(tokens.includes("--ordax-window-mark-size:2.125rem"));
  assert.ok(sharedStyles.includes(":is(.workspace-window,.ordax-window)"));
  assert.ok(sharedStyles.includes('[data-active="false"] {opacity:1'));
  assert.ok(sharedStyles.includes(':is([data-maximized="true"],[data-mode="maximized"])'));
  assert.ok(sharedStyles.includes(":is(.desktop-titlebar,.ordax-window-titlebar)"));
  assert.ok(sharedStyles.includes("var(--ordax-window-control-size)"));
  assert.ok(sharedStyles.includes("var(--md-window-title-size)"));
  assert.ok(webWindowLayer.includes('className="desktop-window-mark"'));
  assert.ok(nativeWindowMarkup.includes('element("header", "ordax-window-titlebar")'));
  assert.ok(nativeStyles.includes("width: var(--ordax-window-control-size, 2rem)"));
  assert.doesNotMatch(webStyles, /\.workspace-window \.desktop-titlebar \{ height: 48px/);
  assert.doesNotMatch(webStyles, /\.workspace-window \.desktop-window-controls button \{ width: 44px/);
});
test("equivalent desktop shortcuts share Meridian identity colors without removing Web destinations", async () => {
  const [tokens, webDesktop, webConfig, nativeShell, shortcutCatalog] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/desktop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/config.ts", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/services/surface/shortcut-catalog.mjs", import.meta.url), "utf8"),
  ]);
  for (const appId of ["central", "files", "apps"]) {
    assert.ok(tokens.includes(`[data-desktop-app="${appId}"] :is(.ordax-rail-icon,.app-icon)`), `${appId} color is owned by shared Meridian policy`);
    assert.ok(webDesktop.includes(`id: '${appId}'`) || webConfig.includes(`id: '${appId}'`), `Web shortcut has stable ${appId} identity`);
  }
  assert.ok(nativeShell.includes('data-desktop-app="central"'));
  assert.ok(nativeShell.includes('data-desktop-app="apps"'));
  assert.ok(nativeShell.includes('data-desktop-app="${appId}"'));
  assert.ok(shortcutCatalog.includes('appId: "files"'));
  assert.ok(shortcutCatalog.includes('appId: "settings"'));
  assert.ok(webConfig.includes("id: 'projects'"));
  assert.ok(webConfig.includes("id: 'internet'"));
  assert.ok(webDesktop.includes("id: 'aura'"));
  assert.ok(webDesktop.includes("open(item.name)"));
});
test("Web and Native desktop shortcuts consume one canonical glyph source", async () => {
  const [webDesktop, nativeShell] = await Promise.all([
    readFile(new URL("../system/surface/workspace/components/central/desktop.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
  ]);
  assert.ok(webDesktop.includes("getDesktopShortcutGlyphMarkup(item.id)"));
  assert.ok(webDesktop.includes("<DesktopShortcutIcon item={item}/>"));
  for (const [key, appId] of [["presentation", "central"], ["files", "files"], ["studio", "studio"], ["settings", "settings"], ["apps", "apps"]]) {
    assert.ok(nativeShell.includes(`${key}: getDesktopShortcutGlyphMarkup("${appId}")`), `${appId} Native glyph comes from the shared catalog`);
  }
});
test("Native rail keeps shared Meridian destinations, area switching, and System controls", async () => {
  const nativeShell = await readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8");
  const rail = nativeShell.slice(nativeShell.indexOf("function meridianNavigation("), nativeShell.indexOf("function meridianNavigationMenu("));
  const menu = nativeShell.slice(nativeShell.indexOf("function meridianNavigationMenu("), nativeShell.indexOf("export function createDesktopShellMarkup"));
  assert.ok(rail.includes('data-nav-group="dispositivo"'));
  assert.match(rail, /data-sidebar-app="system" data-launch-app="system"/);
  assert.match(rail, /data-nav-group-label="dispositivo"/);
  assert.ok(menu.includes('data-nav-menu-group="dispositivo"'));
  assert.match(nativeShell, /listSurfaceShortcutAppIds\("navigation-menu"\)/);
  assert.match(menu, /const deviceApps = NAVIGATION_MENU_APP_IDS\.map\(id =>/);
  assert.deepEqual(listSurfaceShortcutAppIds("navigation-menu"), ["files", "settings", "system"]);
  assert.ok(menu.includes('data-nav-menu-app="${id}"'));
  assert.ok(nativeShell.includes('data-current-area>${t("surface.area.label", { ordinal: "01" })}</span>'));
  assert.ok(nativeShell.includes('data-area-switcher aria-label="${t("shell.areas.aria")}"'));
  assert.ok(nativeShell.includes('data-update-slot'));
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
  let headingDisplay = "block";
  let groupHidden = false;
  const firstButton = { getBoundingClientRect: () => ({ height: 44, top: 33, bottom: 77 }) };
  const group = { get hidden() { return groupHidden; }, querySelector: () => firstButton };
  const heading = { getBoundingClientRect: () => headingVisible ? ({ height: 30, top: 0, bottom: 30 }) : ({ height: 0, top: 0, bottom: 0 }), parentElement: group, closest: () => groupHidden ? group : null };
  const nav = {
    clientHeight: 236,
    ownerDocument: { defaultView: { getComputedStyle: element => element === nav ? ({ rowGap: "4px" }) : ({ marginTop: "0px", marginBottom: "0px", display: headingDisplay }) } },
    querySelector: () => firstButton,
    querySelectorAll: selector => selector === ".meridian-nav-label" ? [heading] : [],
  };
  assert.equal(sidebarNavigationCapacity(nav), 4);
  headingVisible = false;
  groupHidden = true;
  assert.equal(sidebarNavigationCapacity(nav), 4);
  headingDisplay = "none";
  assert.equal(sidebarNavigationCapacity(nav), 5, "a collapsed rail must reclaim space used only by CSS-hidden headings");
});
function navigationFixture({ count = 6, gap = 4, rowHeight = 44, scale = 1, headingHeight = 0 } = {}) {
  let resize, disconnected = false;
  const listeners = new Map();
  const document = { activeElement: null, fonts: {
    ready: Promise.resolve(),
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: event => listeners.delete(event),
  } };
  const destinations = Array.from({ length: count }, () => ({ hidden: false }));
  const apps = destinations.map(destination => ({ hidden: false, closest: () => destination,
    focus() { document.activeElement = this; } }));
  const groups = [0, 1].map(groupIndex => ({ hidden: false,
    querySelector: selector => {
      const index = apps.findIndex((button, i) => Math.floor(i / (count / 2)) === groupIndex && !button.hidden);
      return index < 0 ? null : selector.startsWith(".meridian-nav-destination:not") ? destinations[index] : apps[index];
    },
  }));
  const more = { hidden: true, focus() { document.activeElement = this; } };
  function boxes() {
    let cursor = 100;
    const result = new Map();
    const append = (element, height) => {
      if (result.size) cursor += gap;
      result.set(element, { top: cursor * scale, bottom: (cursor + height) * scale, height: height * scale });
      cursor += height;
    };
    groups.forEach((group, index) => {
      if (group.hidden) return;
      destinations.forEach((destination, i) => {
        if (Math.floor(i / (count / 2)) !== index || destination.hidden) return;
        append(destination, rowHeight + (i === count / 2 ? headingHeight : 0));
      });
    });
    if (!more.hidden) append(more, rowHeight);
    return result;
  }
  destinations.forEach(destination => { destination.getBoundingClientRect = () => boxes().get(destination) ?? { bottom: 0, height: 0 }; });
  more.getBoundingClientRect = () => boxes().get(more) ?? { bottom: 0, height: 0 };
  const nav = {
    clientHeight: 188, ownerDocument: document,
    getBoundingClientRect: () => ({ top: 100 * scale, bottom: (100 + nav.clientHeight) * scale, height: nav.clientHeight * scale }),
    querySelectorAll: selector => selector === ".meridian-nav-destination button" ? apps : selector === "[data-nav-group]" ? groups : [],
    querySelector: () => more,
  };
  document.defaultView = {
    getComputedStyle: () => ({ height: `${nav.clientHeight}px`, boxSizing: "border-box" }),
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() { disconnected = true; } },
  };
  return { nav, apps, destinations, groups, more, document, listeners, resize: () => resize(), get disconnected() { return disconnected; } };
}

test("Native overflow measures destinations separately from the persistent Home slot", () => {
  const fixture = navigationFixture();
  const { nav, apps, groups, more, resize } = fixture;
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
  assert.equal(fixture.disconnected, true);
  assert.equal(fixture.listeners.size, 0);
});

test("Native sidebar navigation keeps a visible overflow path at every desktop height", () => {
  const { nav, apps, destinations, groups, more, resize } = navigationFixture({ count: 8, gap: 5 });
  nav.clientHeight = 44;
  const fit = mountNativeSidebarFit(nav, () => {});
  for (let height = 44; height <= 4320; height += 1) {
    nav.clientHeight = height;
    resize();
    const visible = apps.filter(button => !button.hidden).length;
    assert.equal(more.hidden, visible === apps.length, `More visibility at ${height}px`);
    assert.ok(visible <= apps.length, `destination count remains bounded at ${height}px`);
    assert.equal(groups.every(group => group.hidden), visible === 0, `empty groups are hidden at ${height}px`);
    assert.ok(destinations.every((destination, index) => destination.hidden === apps[index].hidden), `hidden destinations leave no flex gap at ${height}px`);
    if (!more.hidden) assert.ok(more.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom, `More fits at ${height}px`);
  }
  fit.destroy();
});

test("Native overflow fits fractional scaled rows without reserving hidden group headings", () => {
  for (const scale of [.9, 1, 1.1, 1.2, 1.5, 2]) {
    const { nav, apps, more, resize, document, listeners } = navigationFixture({ scale, rowHeight: 43.5, headingHeight: 30 });
    nav.clientHeight = 186;
    const fit = mountNativeSidebarFit(nav, () => {});
    assert.equal(apps.filter(button => !button.hidden).length, 3, `the hidden Ecosystem heading does not displace a destination at ${scale}`);
    document.activeElement = more;
    resize();
    assert.equal(document.activeElement, more);
    nav.clientHeight = 600;
    listeners.get("loadingdone")();
    assert.equal(more.hidden, true);
    assert.equal(document.activeElement, apps.at(-1));
    document.activeElement = apps.at(-1);
    nav.clientHeight = 186;
    resize();
    assert.equal(document.activeElement, more);
    fit.destroy();
  }
});

test("sidebar expanded state follows its actual width across scaled desktop rail widths", () => {
  const sidebarAt = width => ({ getBoundingClientRect: () => ({ width }) });
  for (const width of [43, 64.8, 72, 90, 100]) assert.equal(sidebarIsExpanded(sidebarAt(width)), false, `${width}px is icon-only`);
  for (const width of [100.1, 108, 172.8, 192, 208, 240]) assert.equal(sidebarIsExpanded(sidebarAt(width)), true, `${width}px shows labels`);
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
  const [shared,webStyles,native,web,nativeStyles,brandStyles,tokens]=await Promise.all([
    read("system/surface/ui/sidebar-layout.css"),
    read("system/surface/workspace/components/central/meridian.css"),
    read("system/composition/native/index.html"),
    read("system/composition/web/main.tsx"),
    read("system/surface/ui/identity.css"),
    read("system/surface/ui/brand/symbol.css"),
    read("system/surface/ui/meridian.tokens.css"),
  ]);
  assert.ok(shared.includes(".ordax-product-sidebar .meridian-rail-account {"));
  assert.match(shared, /\.meridian-workspace \.ordax-product-sidebar \{[^}]*gap:var\(--md-sidebar-gap\);[^}]*padding:var\(--md-sidebar-padding-block\)/);
  assert.match(tokens, /--md-sidebar-gap:\.75rem;/);
  assert.match(tokens, /--md-sidebar-padding-block:1\.25rem;/);
  assert.match(tokens, /--md-sidebar-padding-inline:1rem;/);
  assert.ok(shared.includes(":is(.ordax-space-switcher-trigger,.meridian-rail-space)"));
  assert.ok(brandStyles.includes('background: url("./ordax-symbol.png")'));
  assert.doesNotMatch(native,/style="mask-image:/);
  assert.doesNotMatch(webStyles,/\.meridian-workspace \.meridian-rail \{padding:/);
  assert.doesNotMatch(nativeStyles,/\.meridian-native-workspace \.ordax-rail \[data-sidebar-slot=\"navigation\"\]/);
  assert.doesNotMatch(webStyles,/^\.meridian-rail-account\s*\{/m);
  for(const entry of [native,web])assert.ok(entry.includes("surface/ui/sidebar-layout.css"));
});
test("Web and Native shells contain no global workspace header", async () => {
  const [shared, webStyles, native, nativeShell, webNavigation, webCentral] = await Promise.all([
    readFile(new URL("../system/surface/ui/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian.css", import.meta.url), "utf8"),
    readFile(new URL("../system/composition/native/index.html", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/desktop-shell.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/meridian-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/workspace/components/central/central.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(shared, /meridian-system-header|meridian-system-search/);
  assert.doesNotMatch(webStyles, /meridian-system-header|meridian-system-search/);
  assert.doesNotMatch(native, /ordax-native-header|meridian-system-header/);
  assert.doesNotMatch(nativeShell, /ordax-native-header|meridian-system-header/);
  assert.doesNotMatch(webNavigation, /WorkspaceHeader|meridian-system-header/);
  assert.doesNotMatch(webCentral, /WorkspaceHeader/);
  assert.ok(native.includes("surface/ui/meridian.css"));
});
test("Store removes its duplicate page header and keeps the catalog switch in window controls", async () => {
  const [experience, styles] = await Promise.all([
    readFile(new URL("../system/surface/ui/store-experience.mjs", import.meta.url), "utf8"),
    readFile(new URL("../system/surface/ui/store-experience.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(experience, /ordax-store-context|data-store-context-title|data-store-context-note/);
  assert.match(experience, /windowNode\?\.querySelector\('\.ordax-window-controls, \.desktop-window-controls'\)/);
  assert.match(experience, /windowControls\.prepend\(toggle\)/);
  assert.match(experience, /toggle\.remove\(\)/);
  assert.match(styles, /\.ordax-store-window-action/);
});
