import { createSidebarMarkup, sidebarBrandMarkup } from "./sidebar-layout.mjs";
import { presentationDestination } from "../workspace/presentation.mjs";
import { projectSidebarAccount, sidebarProfileMarkup } from "./sidebar-account.mjs";
import { assertLocalizationPort } from "../../contracts/localization.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  REGIONAL_LOCALE_PREFERENCE_ID,
  REGIONAL_TIME_ZONE_PREFERENCE_ID,
} from "../../services/preferences/regional.mjs";
import { MERIDIAN_RAIL_DESTINATIONS } from "../../services/surface/meridian-navigation.mjs";

export function syncDesktopPresentationToggle(button, presentation, localization) {
  const destination = presentationDestination(presentation);
  const label = localization.translate(destination.labelId);
  button.setAttribute("aria-pressed", String(presentation === "desktop"));
  button.setAttribute("aria-label", label);
  button.title = label;
  if (button.dataset.presentationDestination !== destination.target) {
    button.querySelector(".ordax-rail-icon").innerHTML = destination.target === "desktop" ? ICONS.system : ICONS.presentation;
    button.dataset.presentationDestination = destination.target;
  }
}

export function syncDesktopThemeToggle(button, appearance, localization) {
  const nextScheme = appearance.scheme === "dark" ? "light" : "dark";
  const english = localization.getLocale().toLowerCase().startsWith("en");
  const label = nextScheme === "light"
    ? (english ? "Use light theme" : "Usar tema claro")
    : (english ? "Use dark theme" : "Usar tema escuro");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector(".ordax-rail-icon").innerHTML = appearance.scheme === "dark" ? ICONS.sun : ICONS.moon;
}

const SURFACE_LOCALE = "pt-BR";
const SURFACE_TIME_ZONE = "America/Bahia";
const QUICK_ACCESS_APP_IDS = Object.freeze(["studio", "files", "settings"]);
const DOCK_PINNED_APP_IDS = Object.freeze(["studio", "files", "store", "account", "settings", "system"]);

const ICONS = Object.freeze({
  presentation: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/></svg>`,
  files: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 8.5v-3A1.5 1.5 0 0 1 5 4h4.3l2.2 2.5"/></svg>`,
  studio: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11m4-7 2 2-2 2m4 0h2"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a8 8 0 0 0-2-1.2L14 3h-4l-.4 2.6a8 8 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a8 8 0 0 0 2 1.2L10 21h4l.4-2.6a8 8 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>`,
  account: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21v-2.2A6.8 6.8 0 0 1 11.3 12h1.4a6.8 6.8 0 0 1 6.8 6.8V21z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`,
  networkWifi: `<svg class="ordax-network-symbol ordax-network-symbol-wifi" viewBox="0 0 24 24" aria-hidden="true"><path class="ordax-wifi-arc ordax-wifi-arc-outer" d="M4 9.5a12 12 0 0 1 16 0"/><path class="ordax-wifi-arc ordax-wifi-arc-middle" d="M7 13a7.5 7.5 0 0 1 10 0"/><path class="ordax-wifi-arc ordax-wifi-arc-inner" d="M10 16.4a3 3 0 0 1 4 0"/><circle class="ordax-wifi-dot" cx="12" cy="19" r="1"/></svg>`,
  networkEthernet: `<svg class="ordax-network-symbol ordax-network-symbol-ethernet" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M8 15v4M16 15v4M8 19h8"/><path d="M9 9h6"/></svg>`,
  networkOther: `<svg class="ordax-network-symbol ordax-network-symbol-other" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 11l8-3M8 13l8 3"/></svg>`,
  battery: `<svg class="ordax-battery-symbol" viewBox="0 0 28 16" aria-hidden="true"><rect x="1.5" y="2" width="22" height="12" rx="2"/><path d="M25 6h1.5v4H25"/><rect class="ordax-battery-segment ordax-battery-segment-1" x="4" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-2" x="8.5" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-3" x="13" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-4" x="17.5" y="4.5" width="3.5" height="7" rx="0.8"/><path class="ordax-battery-bolt" d="m14.7 1.8-4 6.1h3l-1 6.3 4.5-7h-3z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>`,
  sidebarClose: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>`,
  sidebarOpen: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>`,
  aura: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>`,
  spaces: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h18v12H3z"/><path d="M3 10.5h18M7 4h10M8 14h3m2 0h3"/></svg>`,
  apps: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  profiles: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 11h18M10 11v2h4v-2"/></svg>`,
  devices: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4" width="14" height="12" rx="1.5"/><path d="M7 20h5m-2.5-4v4"/><rect x="18" y="7" width="4" height="12" rx="1"/></svg>`,
  store: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v10h16V10M3 10l2-6h14l2 6"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M10 20v-6h4v6"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.6 8.6 0 1 0 20.2 15.4z"/></svg>`,
});

export function syncDesktopSidebarToggle(button, expanded, localization) {
  const label = localization.translate(expanded ? "shell.sidebar.collapse" : "shell.sidebar.expand");
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector("svg").innerHTML = expanded ? ICONS.sidebarClose : ICONS.sidebarOpen;
}

function railButton(appId, label, icon, t, className = "ordax-rail-button") {
  return `
    <button type="button" class="${className}" data-sidebar-app="${appId}" data-launch-app="${appId}" title="${label}" aria-label="${t("surface.launcher.open", { app: label })}">
      <span class="ordax-rail-icon">${icon}</span>
      <span>${label}</span>
    </button>`;
}

function spaceLink(messageId, target, t) {
  const label = t(messageId);
  return `
    <button
      type="button"
      class="ordax-space-link"
      data-launch-app="files"
      data-app-target="${target}"
      data-requires-capability="filesystem.user-space"
      aria-label="${t("surface.launcher.open", { app: label })}"
    >
      <span class="ordax-space-icon">${ICONS.folder}</span>
      <span>${label}</span>
      <span class="ordax-space-arrow">${ICONS.arrow}</span>
    </button>`;
}

const MERIDIAN_NATIVE_DESTINATION_TARGETS = Object.freeze({
  intelligence: { appId: "intelligence" },
  spaces: { appId: "account", target: "spaces" },
  profiles: { appId: "account", target: "profiles" },
  devices: { appId: "account", target: "devices" },
  store: { appId: "store" },
});

function meridianDestinationButton(destination, localization, groupLabel = "") {
  const locale = localization.getLocale();
  const label = locale.toLowerCase().startsWith("en") ? destination.englishName : destination.name;
  if (destination.key === "apps") {
    return `<div class="meridian-nav-destination" data-meridian-destination-group="${destination.group}">${groupLabel}<button type="button" class="os-nav-item meridian-application-launcher" data-launcher-toggle data-meridian-application-launcher data-meridian-destination="${destination.key}" aria-label="${label}" title="${label}"><span class="ordax-rail-icon">${ICONS.apps}</span><span>${label}</span></button></div>`;
  }
  const target = MERIDIAN_NATIVE_DESTINATION_TARGETS[destination.key];
  if (!target) return "";
  const appTarget = target.target ? ` data-app-target="${target.target}"` : "";
  const planned = destination.key === "intelligence"
    ? `<span class="meridian-planned-mark" aria-label="${localization.translate("sidebar.native.planned")}" title="${localization.translate("sidebar.native.unavailable")}">•</span>` : "";
  return `<div class="meridian-nav-destination" data-meridian-destination-group="${destination.group}">${groupLabel}<button type="button" class="ordax-rail-button os-nav-item" data-sidebar-app="${target.appId}" data-launch-app="${target.appId}" data-meridian-destination="${destination.key}"${appTarget} aria-label="${label}" title="${label}"><span class="ordax-rail-icon">${ICONS[destination.key === "intelligence" ? "aura" : destination.key]}</span><span>${label}</span>${planned}</button></div>`;
}

function meridianNavigation(localization, t) {
  const destinations = MERIDIAN_RAIL_DESTINATIONS.filter(item => item.key !== "home");
  const primary = destinations.filter(item => item.group === "principal").map(item => meridianDestinationButton(item, localization)).join("");
  const ecosystem = destinations.filter(item => item.group === "ecossistema").map((item, index) => meridianDestinationButton(
    item,
    localization,
    index === 0 ? `<p class="meridian-nav-label" data-nav-group-label="ecossistema">Ecossistema</p>` : "",
  )).join("");
  return `<div class="meridian-native-nav-group" data-nav-group="principal">${primary}</div><div class="meridian-native-nav-group" data-nav-group="ecossistema">${ecosystem}</div><button type="button" class="ordax-rail-button os-nav-item meridian-nav-more" data-navigation-menu-toggle data-nav-menu-more aria-controls="ordax-native-navigation" aria-expanded="false" hidden><span class="ordax-rail-icon">${ICONS.more}</span><span>${t("shell.sidebar.more")}</span></button>`;
}

function meridianNavigationMenu(localization, t) {
  const destinationButton = destination => {
    const english = localization.getLocale().toLowerCase().startsWith("en");
    const label = english ? destination.englishName : destination.name;
    if (destination.key === "home") return `<button type="button" class="meridian-menu-item" data-nav-menu-item data-meridian-menu-destination="${destination.key}" data-native-navigation-home><span class="ordax-rail-icon">${ICONS.home}</span><span>${label}</span></button>`;
    if (destination.key === "apps") return `<button type="button" class="meridian-menu-item" data-nav-menu-item data-meridian-menu-destination="${destination.key}" data-launcher-toggle><span class="ordax-rail-icon">${ICONS.apps}</span><span>${label}</span></button>`;
    const target = MERIDIAN_NATIVE_DESTINATION_TARGETS[destination.key];
    if (!target) return "";
    const unavailable = destination.key === "intelligence";
    const icon = destination.key === "intelligence" ? "aura" : destination.key;
    return `<button type="button" class="meridian-menu-item" data-nav-menu-item data-meridian-menu-destination="${destination.key}" data-launch-app="${target.appId}" data-nav-menu-app="${target.appId}"${target.target ? ` data-app-target="${target.target}"` : ""}${unavailable ? " disabled aria-disabled=\"true\" title=\"Ainda não conectado a um serviço\"" : ""}><span class="ordax-rail-icon">${ICONS[icon]}</span><span>${label}</span>${unavailable ? "<small>Planejado</small>" : ""}</button>`;
  };
  const principal = MERIDIAN_RAIL_DESTINATIONS.filter(item => item.key === "home" || item.group === "principal").map(destinationButton).join("");
  const ecosystem = MERIDIAN_RAIL_DESTINATIONS.filter(item => item.group === "ecossistema").map(destinationButton).join("");
  const deviceApps = ["files", "studio", "settings", "system"].map(id => `<button type="button" class="meridian-menu-item" data-nav-menu-item data-launch-app="${id}" data-nav-menu-app="${id}"><span class="ordax-rail-icon">${ICONS[id]}</span><span>${t(`app.${id}.title`)}</span></button>`).join("")
    + `<button type="button" class="meridian-menu-item" data-nav-menu-item data-launch-app="system" data-app-target="updates" data-nav-menu-app="system"><span class="ordax-rail-icon">${ICONS.system}</span><span>${t("system.updateShortcut.label")}</span></button>`;
  const english = localization.getLocale().toLowerCase().startsWith("en");
  return `<section id="ordax-native-navigation" class="meridian-navigation-menu ordax-native-navigation-menu" data-native-navigation-menu role="dialog" aria-modal="false" aria-labelledby="ordax-native-navigation-title" hidden><header class="ordax-native-navigation-heading"><div><p class="ordax-section-kicker">MERIDIAN</p><h2 id="ordax-native-navigation-title">${english ? "Navigation and apps" : "Navegação e aplicativos"}</h2></div><button type="button" class="ordax-quick-close" data-navigation-menu-close aria-label="${t("shell.quick.dateTimeClose")}">×</button></header><label class="ordax-native-navigation-search"><span class="ordax-command-icon">${ICONS.search}</span><input type="search" data-native-navigation-query data-meridian-navigation-query placeholder="${english ? "Search destinations and apps" : "Buscar destinos e aplicativos"}" autocomplete="off"></label><div class="ordax-native-navigation-list"><div data-nav-menu-group="principal">${principal}</div><div data-nav-menu-group="ecossistema"><p class="meridian-nav-label" data-nav-menu-group-label="ecossistema">${english ? "Ecosystem" : "Ecossistema"}</p>${ecosystem}</div><div data-nav-menu-group="dispositivo"><p class="meridian-nav-label" data-nav-menu-group-label="dispositivo">${english ? "On this device" : "Neste dispositivo"}</p>${deviceApps}</div></div></section>`;
}

export function createDesktopShellMarkup(localization) {
  const localizationPort = assertLocalizationPort(localization);
  const t = localizationPort.translate;
  return `
    <div class="ordax-shell meridian-workspace meridian-native-workspace" data-ordax-shell data-meridian-native data-view="central">
      ${createSidebarMarkup({ id: "ordax-native-sidebar", label: t("shell.rail.aria"), content: {
        brand: `<button type="button" class="meridian-brand-home" data-show-desktop aria-label="OrdaX OS" title="OrdaX OS">${sidebarBrandMarkup()}</button>`,
        home: `<div class="meridian-native-home-nav"><div class="ordax-space-switcher-slot" data-space-switcher-slot></div><button type="button" class="ordax-rail-button os-nav-item meridian-home-destination" data-show-desktop title="${t("shell.home.title")}"><span class="ordax-rail-icon">${ICONS.apps}</span><span data-home-nav-label>${t("shell.home.title")}</span></button></div>`,
        navigation: meridianNavigation(localization, t),
        account: `<div class="meridian-rail-context"><i aria-hidden="true"></i><span><span data-native-context-title>${localization.getLocale().toLowerCase().startsWith("en") ? "This device" : "Este dispositivo"}</span><small data-native-context-subtitle>${localization.translate("sidebar.native.workspace")}</small></span></div><div class="meridian-rail-utilities"><button type="button" data-native-rail-continuity data-launch-app="account" data-app-target="sync" aria-label="${localization.getLocale().toLowerCase().startsWith("en") ? "Continuity" : "Continuidade"}" title="${localization.getLocale().toLowerCase().startsWith("en") ? "Continuity" : "Continuidade"}">${ICONS.clock}</button><span class="meridian-rail-notification-slot" data-sidebar-notification-slot></span><button type="button" data-launch-app="settings" aria-label="${t("app.settings.title")}" title="${t("app.settings.title")}">${ICONS.settings}</button></div>${sidebarProfileMarkup(projectSidebarAccount({ state: "unavailable" }, false, t), true)}`,
        auxiliary: `<div class="ordax-power-slot" data-power-slot></div><button type="button" class="sidebar-collapse ordax-sidebar-toggle" data-sidebar-toggle aria-controls="ordax-native-sidebar" aria-expanded="true" aria-label="${t("shell.sidebar.collapse")}" title="${t("shell.sidebar.collapse")}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.sidebarClose}</svg></button>`,
      } })}

      <header class="meridian-system-header ordax-native-header">
        <div class="meridian-system-location"><button type="button" class="meridian-mobile-menu" data-navigation-menu-toggle aria-controls="ordax-native-navigation" aria-expanded="false" aria-label="${localization.getLocale().toLowerCase().startsWith("en") ? "Open navigation" : "Abrir navegação"}" title="${localization.getLocale().toLowerCase().startsWith("en") ? "Open navigation" : "Abrir navegação"}">${ICONS.apps}</button><span data-current-destination>${t("shell.home.title")}</span><i aria-hidden="true">/</i><button type="button" class="meridian-native-area-trigger" data-area-menu-toggle aria-controls="ordax-native-area-menu" aria-expanded="false" aria-label="${t("shell.areas.aria")}" title="${t("shell.areas.aria")}"><span class="meridian-native-location-context" data-current-area>${t("surface.area.label", { ordinal: "01" })}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div id="ordax-native-area-menu" class="meridian-native-area-menu" data-native-area-menu hidden><div class="ordax-area-switcher" data-area-switcher aria-label="${t("shell.areas.aria")}"></div></div></div>
        <button type="button" class="meridian-system-search" data-navigation-menu-toggle data-meridian-search aria-label="${localization.getLocale().toLowerCase().startsWith("en") ? "Search apps and resources" : "Buscar aplicativos e recursos"}" aria-controls="ordax-native-navigation" aria-expanded="false"><span class="meridian-native-search-icon" aria-hidden="true">${ICONS.search}</span><span>${localization.getLocale().toLowerCase().startsWith("en") ? "Search apps and resources" : "Buscar aplicativos e recursos"}</span><kbd>Ctrl K</kbd></button>
        <div class="meridian-system-tools"><div class="ordax-status-actions meridian-header-status-actions" data-update-slot></div></div>
      </header>

      <main class="ordax-workspace" tabindex="-1" data-workspace>
        <section class="ordax-desktop" aria-labelledby="surface-home-title">
          <div class="ordax-home-panel" data-central-presentation>
            <div class="ordax-home-intro">
              <p class="ordax-area-kicker" data-area-kicker>${t("surface.area.label", { ordinal: "01" })}</p>
              <h1 id="surface-home-title" class="ordax-home-title" data-home-greeting>${t("shell.home.greeting.morning")}</h1>
              <p class="ordax-home-tagline" data-home-tagline>${t("shell.home.tagline")}</p>
            </div>
            <section class="ordax-home-hero" aria-label="${t("shell.home.hero.aria")}">
              <img class="ordax-home-hero-image" src="../../surface/workspace/assets/alpine-day.jpg" alt="" loading="eager">
              <div class="ordax-home-hero-copy">
                <p class="ordax-home-hero-label" data-home-hero-label>${t("shell.home.hero.label")}</p>
                <h2><span data-home-hero-title-first>${t("shell.home.hero.title.first")}</span><br><span data-home-hero-title-second>${t("shell.home.hero.title.second")}</span></h2>
                <p><span data-home-hero-description-first>${t("shell.home.hero.description.first")}</span><br><span data-home-hero-description-second>${t("shell.home.hero.description.second")}</span></p>
                <button type="button" class="ordax-welcome-action" data-launcher-toggle><span class="ordax-rail-icon">${ICONS.apps}</span><span data-home-hero-action>${t("shell.home.hero.action")}</span></button>
              </div>
            </section>
            <div class="meridian-session-strip" role="group" aria-label="${t("shell.home.session.aria")}">
              <span><span class="ordax-rail-icon">${ICONS.system}</span><span data-native-session-label>${t("shell.home.session.native")}</span></span>
              <button type="button" data-launch-app="account"><span class="ordax-rail-icon">${ICONS.account}</span><span data-native-session-account>${t("shell.home.session.account")}</span></button>
              <button type="button" data-launch-app="store"><span class="ordax-rail-icon">${ICONS.store}</span><span data-native-session-store>${t("shell.home.session.store")}</span></button>
              <button type="button" class="meridian-integration-status" data-launch-app="settings"><span data-native-session-pending>${t("shell.home.session.pending")}</span></button>
            </div>
            <section class="meridian-command meridian-native-command" aria-label="${t("shell.home.aura.aria")}">
              <span class="meridian-command-icon">${ICONS.aura}</span>
              <div class="meridian-command-input-row">
                <input type="text" data-native-aura-prompt aria-label="${t("shell.home.aura.aria")}" placeholder="${t("shell.home.aura.placeholder")}" disabled>
                <button type="button" data-native-aura-voice disabled aria-label="${t("shell.home.aura.voice")}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-4 0h8"/></svg></button>
                <button type="button" class="meridian-command-send" data-native-aura-send disabled aria-label="${t("shell.home.aura.send")}">${ICONS.arrow}</button>
              </div>
              <small>Intelligence <i aria-hidden="true"></i><span class="meridian-integration-status" data-native-aura-backend>${t("shell.home.aura.backend")}</span><span data-native-aura-description>${t("shell.home.aura.pendingDescription")}</span></small>
            </section>
            <div class="ordax-home-meta" role="group" aria-label="${t("shell.home.datetime")}">
              <span class="ordax-home-meta-icon" aria-hidden="true">${ICONS.clock}</span>
              <span class="ordax-home-meta-copy"><time class="ordax-clock" data-ordax-clock>--:--</time>
              <p class="ordax-date" data-ordax-date>${t("shell.home.loadingDate")}</p></span>
            </div>
            <section class="ordax-home-actions" aria-labelledby="ordax-home-actions-title">
              <p id="ordax-home-actions-title" class="ordax-section-kicker">${t("shell.home.quickAccess")}</p>
              <div class="ordax-home-action-grid">
                ${QUICK_ACCESS_APP_IDS.map((id) => railButton(id, t(`app.${id}.title`), ICONS[id], t, "ordax-home-action")).join("")}
              </div>
            </section>

            <section class="ordax-space" aria-labelledby="ordax-space-title">
              <p id="ordax-space-title" class="ordax-section-kicker">${t("shell.space.title")}</p>
              ${spaceLink("shell.space.documents", "/Documentos", t)}
              ${spaceLink("shell.space.images", "/Imagens", t)}
              ${spaceLink("shell.space.downloads", "/Downloads", t)}
            </section>
          </div>

          <section class="ordax-desktop-shortcuts" data-desktop-presentation aria-label="${t("shell.presentation.shortcuts")}" hidden>
            <button type="button" class="ordax-desktop-shortcut" data-show-desktop><span class="ordax-rail-icon">${ICONS.presentation}</span><span data-central-shortcut-label>${t("shell.presentation.centralTitle")}</span></button>
            ${QUICK_ACCESS_APP_IDS.map(id => railButton(id, t(`app.${id}.title`), ICONS[id], t, "ordax-desktop-shortcut")).join("")}
          </section>
        </section>

        <div class="ordax-window-layer" data-window-layer aria-live="polite"></div>
      </main>

      <div id="ordax-launcher" class="ordax-launcher" data-launcher hidden>
        <div class="ordax-launcher-panel" role="dialog" aria-modal="false" aria-label="${t("shell.launcher.dialog")}">
          <label class="ordax-launcher-search">
            <span class="ordax-command-icon">${ICONS.search}</span>
            <input type="search" data-launcher-query autocomplete="off" spellcheck="false" placeholder="${t("shell.launcher.search")}" aria-label="${t("shell.launcher.search")}">
            <kbd>Esc</kbd>
          </label>
          <div class="ordax-launcher-grid" data-app-launcher></div>
        </div>
      </div>

      ${meridianNavigationMenu(localization, t)}

      <footer class="ordax-dock ordax-statusbar meridian-taskbar" aria-label="${t("shell.statusbar.aria")}">
        <div class="meridian-taskbar-start"><button type="button" class="ordax-presentation-toggle" data-presentation-toggle data-presentation-destination="desktop" aria-pressed="false" aria-label="${t("shell.presentation.desktop")}" title="${t("shell.presentation.desktop")}"><span class="ordax-rail-icon">${ICONS.system}</span></button></div>
        <div class="meridian-native-dock"><div class="ordax-dock-shortcuts meridian-dock-shortcuts" aria-label="${t("shell.home.quickAccess")}">
          ${DOCK_PINNED_APP_IDS.map((id) => `<button type="button" class="ordax-dock-shortcut" data-launch-app="${id}" data-dock-pinned-app="${id}" title="${t(`app.${id}.title`)}" aria-label="${t("surface.launcher.open", { app: t(`app.${id}.title`) })}"><span class="ordax-rail-icon">${ICONS[id]}</span><span>${t(`app.${id}.title`)}</span></button>`).join("")}
        </div><div class="ordax-running-apps meridian-dock" data-running-apps aria-label="${t("shell.runningApps.aria")}"></div><span class="meridian-dock-divider" aria-hidden="true"></span><button type="button" class="ordax-dock-shortcut ordax-dock-launcher" data-launcher-toggle aria-label="${t("shell.launcher.command")}" title="${t("shell.launcher.command")}"><span class="ordax-rail-icon">${ICONS.apps}</span></button></div>
        <div class="meridian-taskbar-end"><button type="button" class="ordax-native-theme-toggle" data-native-theme-toggle aria-label="Alternar tema" title="Alternar tema"><span class="ordax-rail-icon"></span></button><div class="ordax-system-tray meridian-taskbar-system-tray" aria-label="${t("shell.systemStatus.aria")}">
          <button type="button" class="ordax-tray-item ordax-tray-network" data-connectivity-tray data-quick-panel-toggle="network" aria-expanded="false" aria-controls="ordax-quick-network" aria-label="${t("shell.network.quickOpen")}"><span class="ordax-tray-icon ordax-tray-network-icon" data-connectivity-icon data-state="unknown" data-network-kind="unknown" data-signal-level="0" aria-hidden="true">${ICONS.networkWifi}${ICONS.networkEthernet}${ICONS.networkOther}</span><span class="ordax-tray-label" data-connectivity-label>${t("surface.connectivity.unknown")}</span></button>
          <button type="button" class="ordax-tray-item ordax-tray-battery" data-battery-tray data-quick-panel-toggle="battery" aria-expanded="false" aria-controls="ordax-quick-battery" aria-label="${t("shell.battery.quickOpen")}" hidden><span class="ordax-tray-icon ordax-tray-battery-icon" data-battery-icon data-battery-level="0" data-charging="false" aria-hidden="true">${ICONS.battery}</span><span class="ordax-tray-label" data-battery-label>--%</span></button>
          <button type="button" class="ordax-tray-item ordax-tray-clock" data-quick-panel-toggle="datetime" aria-expanded="false" aria-controls="ordax-quick-datetime" aria-label="${t("shell.datetime.quickOpen")}"><span class="ordax-tray-icon" aria-hidden="true">${ICONS.clock}</span><time data-ordax-tray-clock>--:--</time></button>
        </div></div>
      </footer>

      <div class="ordax-quick-panel-layer" data-quick-panel-layer>
        <section id="ordax-quick-network" class="ordax-quick-panel" data-quick-panel="network" role="dialog" aria-modal="false" aria-labelledby="ordax-quick-network-title" hidden>
          <header class="ordax-quick-panel-header">
            <div>
              <span class="ordax-quick-kicker">${t("shell.quick.access")}</span>
              <h2 id="ordax-quick-network-title">Wi-Fi</h2>
            </div>
            <button type="button" class="ordax-quick-close" data-quick-panel-close aria-label="${t("shell.quick.wifiClose")}">×</button>
          </header>
          <div class="ordax-quick-panel-content" data-quick-network-content>
            <p class="ordax-quick-empty">${t("shell.quick.wifiReading")}</p>
          </div>
        </section>

        <section id="ordax-quick-battery" class="ordax-quick-panel ordax-quick-panel-battery" data-quick-panel="battery" role="dialog" aria-modal="false" aria-labelledby="ordax-quick-battery-title" hidden>
          <header class="ordax-quick-panel-header">
            <div>
              <span class="ordax-quick-kicker">${t("shell.quick.energy")}</span>
              <h2 id="ordax-quick-battery-title">${t("shell.quick.battery")}</h2>
            </div>
            <button type="button" class="ordax-quick-close" data-quick-panel-close aria-label="${t("shell.quick.batteryClose")}">×</button>
          </header>
          <div class="ordax-quick-battery-status" data-quick-battery-content>
            <strong data-quick-battery-percent>--%</strong>
            <span data-quick-battery-state>${t("shell.quick.batteryReading")}</span>
          </div>
          <div class="ordax-quick-battery-power">
            <span data-ordax-power-source-label>${t("shell.quick.powerSource")}</span>
            <strong data-quick-battery-power>${t("shell.quick.checking")}</strong>
          </div>
        </section>

        <section id="ordax-quick-datetime" class="ordax-quick-panel ordax-quick-panel-datetime" data-quick-panel="datetime" role="dialog" aria-modal="false" aria-labelledby="ordax-quick-datetime-title" hidden>
          <header class="ordax-quick-panel-header">
            <div>
              <span class="ordax-quick-kicker">${t("shell.quick.dateTime")}</span>
              <h2 id="ordax-quick-datetime-title"><time data-ordax-quick-clock>--:--</time></h2>
            </div>
            <button type="button" class="ordax-quick-close" data-quick-panel-close aria-label="${t("shell.quick.dateTimeClose")}">×</button>
          </header>
          <p class="ordax-quick-date" data-ordax-quick-date>${t("shell.home.loadingDate")}</p>
          <div class="ordax-quick-timezone">
            <span data-ordax-timezone-label>${t("shell.quick.timeZone")}</span>
            <strong data-ordax-timezone>${SURFACE_TIME_ZONE}</strong>
          </div>
        </section>
      </div>
    </div>
  `;
}

export function syncDesktopShellLocalization(root, localization) {
  const localizationPort = assertLocalizationPort(localization);
  const t = localizationPort.translate;
  const text = (selector, messageId) => {
    const node = root.querySelector(selector);
    if (node) node.textContent = t(messageId);
  };
  const aria = (selector, messageId) => {
    const node = root.querySelector(selector);
    if (node) node.setAttribute("aria-label", t(messageId));
  };
  const english = localizationPort.getLocale().toLowerCase().startsWith("en");

  aria(".ordax-rail", "shell.rail.aria");
  for (const appId of ["files", "studio", "notes", "settings", "account", "system"]) {
    const label = t(`app.${appId}.title`);
    for (const button of root.querySelectorAll(`[data-sidebar-app="${appId}"]`)) {
      if (button.hasAttribute("data-sidebar-account-open") || button.hasAttribute("data-meridian-destination")) continue;
      button.setAttribute("title", label);
      const labelNode = button.querySelector("span:last-child");
      if (labelNode) labelNode.textContent = label;
      button.setAttribute("aria-label", t("surface.launcher.open", { app: label }));
    }
  }
  text("[data-home-nav-label]", "shell.home.title");
  root.querySelector(".meridian-home-destination")?.setAttribute("title", t("shell.home.title"));
  const nativeContextTitle = root.querySelector("[data-native-context-title]");
  const nativeContextSubtitle = root.querySelector("[data-native-context-subtitle]");
  if (nativeContextTitle) nativeContextTitle.textContent = english ? "This device" : "Este dispositivo";
  if (nativeContextSubtitle) nativeContextSubtitle.textContent = t("sidebar.native.workspace");
  const continuityButton = root.querySelector("[data-native-rail-continuity]");
  if (continuityButton) {
    continuityButton.setAttribute("aria-label", english ? "Continuity" : "Continuidade");
    continuityButton.title = english ? "Continuity" : "Continuidade";
  }
  text("[data-central-shortcut-label]", "shell.presentation.centralTitle");
  root.querySelector("[data-desktop-presentation]")?.setAttribute("aria-label", t("shell.presentation.shortcuts"));
  text("[data-home-greeting]", "shell.home.greeting.morning");
  text("[data-home-tagline]", "shell.home.tagline");
  root.querySelector(".ordax-home-hero")?.setAttribute("aria-label", t("shell.home.hero.aria"));
  text("[data-home-hero-label]", "shell.home.hero.label");
  text("[data-home-hero-title-first]", "shell.home.hero.title.first");
  text("[data-home-hero-title-second]", "shell.home.hero.title.second");
  text("[data-home-hero-description-first]", "shell.home.hero.description.first");
  text("[data-home-hero-description-second]", "shell.home.hero.description.second");
  text("[data-home-hero-action]", "shell.home.hero.action");
  root.querySelector(".ordax-home-meta")?.setAttribute("aria-label", t("shell.home.datetime"));
  text("#ordax-home-actions-title", "shell.home.quickAccess");
  aria(".meridian-session-strip", "shell.home.session.aria");
  text("[data-native-session-label]", "shell.home.session.native");
  text("[data-native-session-account]", "shell.home.session.account");
  text("[data-native-session-store]", "shell.home.session.store");
  text("[data-native-session-pending]", "shell.home.session.pending");
  aria(".meridian-native-command", "shell.home.aura.aria");
  const nativeAuraPrompt = root.querySelector("[data-native-aura-prompt]");
  if (nativeAuraPrompt) {
    nativeAuraPrompt.placeholder = t("shell.home.aura.placeholder");
    nativeAuraPrompt.setAttribute("aria-label", t("shell.home.aura.aria"));
  }
  aria("[data-native-aura-voice]", "shell.home.aura.voice");
  aria("[data-native-aura-send]", "shell.home.aura.send");
  text("[data-native-aura-backend]", "shell.home.aura.backend");
  text("[data-native-aura-description]", "shell.home.aura.pendingDescription");
  for (const button of root.querySelectorAll("[data-launcher-toggle]")) {
    if (button.hasAttribute("data-meridian-search")) continue;
    if (button.hasAttribute("data-meridian-application-launcher")) {
      const destination = MERIDIAN_RAIL_DESTINATIONS.find(item => item.key === button.dataset.meridianDestination);
      if (destination) {
        const label = localization.getLocale().toLowerCase().startsWith("en") ? destination.englishName : destination.name;
        button.setAttribute("aria-label", label);
        button.title = label;
        const labelNode = button.querySelector("span:nth-child(2)");
        if (labelNode) labelNode.textContent = label;
      }
      continue;
    }
    const more = button.hasAttribute("data-launcher-more");
    const label = t(more ? "shell.sidebar.more" : "shell.launcher.command");
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.setAttribute("aria-controls", "ordax-launcher");
    if (more) button.querySelector("span:last-child").textContent = label;
  }
  text("#ordax-space-title", "shell.space.title");
  const spaceMessages = new Map([
    ["/Documentos", "shell.space.documents"],
    ["/Imagens", "shell.space.images"],
    ["/Downloads", "shell.space.downloads"],
  ]);
  for (const [target, messageId] of spaceMessages) {
    const button = root.querySelector(`[data-app-target="${target}"]`);
    const label = t(messageId);
    const labelNode = button?.querySelector("span:nth-child(2)");
    if (labelNode) labelNode.textContent = label;
    button?.setAttribute("aria-label", t("surface.launcher.open", { app: label }));
  }

  aria("[data-launcher] .ordax-launcher-panel", "shell.launcher.dialog");
  const launcherQuery = root.querySelector("[data-launcher-query]");
  if (launcherQuery) {
    launcherQuery.placeholder = t("shell.launcher.search");
    launcherQuery.setAttribute("aria-label", t("shell.launcher.search"));
  }
  aria(".ordax-statusbar", "shell.statusbar.aria");
  aria("[data-area-switcher]", "shell.areas.aria");
  aria("[data-area-menu-toggle]", "shell.areas.aria");
  const areaMenuToggle = root.querySelector("[data-area-menu-toggle]");
  if (areaMenuToggle) areaMenuToggle.title = t("shell.areas.aria");
  aria("[data-running-apps]", "shell.runningApps.aria");
  aria(".ordax-system-tray", "shell.systemStatus.aria");
  aria("[data-connectivity-tray]", "shell.network.quickOpen");
  const connectivityTray = root.querySelector("[data-connectivity-tray]");
  if (connectivityTray?.dataset.networkDetailOwner !== "true") {
    text("[data-connectivity-label]", "surface.connectivity.unknown");
  }
  aria("[data-battery-tray]", "shell.battery.quickOpen");
  aria('[data-quick-panel-toggle="datetime"]', "shell.datetime.quickOpen");
  text('[data-quick-panel="network"] .ordax-quick-kicker', "shell.quick.access");
  aria('[data-quick-panel="network"] [data-quick-panel-close]', "shell.quick.wifiClose");
  text('[data-quick-panel="battery"] .ordax-quick-kicker', "shell.quick.energy");
  text("#ordax-quick-battery-title", "shell.quick.battery");
  aria('[data-quick-panel="battery"] [data-quick-panel-close]', "shell.quick.batteryClose");
  text("[data-ordax-power-source-label]", "shell.quick.powerSource");
  text('[data-quick-panel="datetime"] .ordax-quick-kicker', "shell.quick.dateTime");
  aria('[data-quick-panel="datetime"] [data-quick-panel-close]', "shell.quick.dateTimeClose");
  text("[data-ordax-timezone-label]", "shell.quick.timeZone");

  const locale = localization.getLocale().toLowerCase();
  for (const button of root.querySelectorAll("[data-meridian-destination]")) {
    const destination = MERIDIAN_RAIL_DESTINATIONS.find(item => item.key === button.dataset.meridianDestination);
    if (!destination) continue;
    const label = locale.startsWith("en") ? destination.englishName : destination.name;
    button.title = label;
    button.setAttribute("aria-label", label);
    const labelNode = button.querySelector("span:nth-child(2)");
    if (labelNode) labelNode.textContent = label;
  }
  for (const label of root.querySelectorAll("[data-nav-group-label]")) {
    label.textContent = locale.startsWith("en")
      ? label.dataset.navGroupLabel === "ecossistema" ? "Ecosystem" : "On this device"
      : label.dataset.navGroupLabel === "ecossistema" ? "Ecossistema" : "Neste dispositivo";
  }
  for (const button of root.querySelectorAll("[data-meridian-menu-destination]")) {
    const destination = MERIDIAN_RAIL_DESTINATIONS.find(item => item.key === button.dataset.meridianMenuDestination);
    if (!destination) continue;
    const label = locale.startsWith("en") ? destination.englishName : destination.name;
    const labelNode = button.querySelector("span:nth-child(2)");
    if (labelNode) labelNode.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
  for (const button of root.querySelectorAll("[data-nav-menu-app]")) {
    if (button.hasAttribute("data-meridian-menu-destination")) continue;
    const appId = button.dataset.navMenuApp;
    const label = button.dataset.appTarget === "updates" ? t("system.updateShortcut.label") : t(`app.${appId}.title`);
    const labelNode = button.querySelector("span:nth-child(2)");
    if (labelNode) labelNode.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
  for (const label of root.querySelectorAll("[data-nav-menu-group-label]")) {
    label.textContent = locale.startsWith("en")
      ? label.dataset.navMenuGroupLabel === "ecossistema" ? "Ecosystem" : "On this device"
      : label.dataset.navMenuGroupLabel === "ecossistema" ? "Ecossistema" : "Neste dispositivo";
  }
  const navigationQuery = root.querySelector("[data-meridian-navigation-query]");
  if (navigationQuery) navigationQuery.placeholder = locale.startsWith("en") ? "Search destinations and apps" : "Buscar destinos e aplicativos";
}

function regionalSettings(snapshot = {}) {
  return {
    locale: snapshot[REGIONAL_LOCALE_PREFERENCE_ID] ?? SURFACE_LOCALE,
    timeZone: snapshot[REGIONAL_TIME_ZONE_PREFERENCE_ID] ?? SURFACE_TIME_ZONE,
  };
}

function formatDate(date, locale, timeZone) {
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
  const value = formatter.format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function mountDesktopClock(
  root,
  preferenceRuntime = null,
  localization = null,
  clock = globalThis,
) {
  const preferencePort = preferenceRuntime === null
    ? null
    : assertPreferenceRuntimePort(preferenceRuntime);
  const localizationPort = localization === null ? null : assertLocalizationPort(localization);
  const timeNode = root.querySelector("[data-ordax-clock]");
  const trayTimeNode = root.querySelector("[data-ordax-tray-clock]");
  const quickTimeNode = root.querySelector("[data-ordax-quick-clock]");
  const dateNode = root.querySelector("[data-ordax-date]");
  const quickDateNode = root.querySelector("[data-ordax-quick-date]");
  const timeZoneNode = root.querySelector("[data-ordax-timezone]");
  const greetingNode = root.querySelector("[data-home-greeting]");
  if (!timeNode || !trayTimeNode || !quickTimeNode || !dateNode || !quickDateNode || !timeZoneNode) {
    throw new Error("OrdaX desktop clock requires clock, date and timezone nodes");
  }

  const render = () => {
    const { locale, timeZone } = regionalSettings(preferencePort?.getSnapshot() ?? {});
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now));
    const greetingId = hour < 12
      ? "shell.home.greeting.morning"
      : hour < 18 ? "shell.home.greeting.afternoon" : "shell.home.greeting.evening";
    if (greetingNode) {
      greetingNode.textContent = localizationPort?.translate(greetingId)
        ?? (hour < 12 ? "Bom dia." : hour < 18 ? "Boa tarde." : "Boa noite.");
    }
    const formattedTime = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    timeNode.textContent = formattedTime;
    trayTimeNode.textContent = formattedTime;
    quickTimeNode.textContent = formattedTime;
    dateNode.textContent = formatDate(now, locale, timeZone);
    quickDateNode.textContent = new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(now);
    timeZoneNode.textContent = timeZone;
    const isoNow = now.toISOString();
    timeNode.setAttribute("datetime", isoNow);
    trayTimeNode.setAttribute("datetime", isoNow);
    quickTimeNode.setAttribute("datetime", isoNow);
    const timeZoneTitle = localizationPort
      ? localizationPort.translate("shell.clock.timeZone", { timeZone })
      : timeZone;
    timeNode.title = timeZoneTitle;
    trayTimeNode.title = timeZoneTitle;
  };

  const unsubscribe = preferencePort?.subscribe(render) ?? null;
  if (!preferencePort) render();
  const timer = clock.setInterval(render, 30_000);
  return Object.freeze({
    destroy() {
      unsubscribe?.();
      clock.clearInterval(timer);
    },
  });
}
