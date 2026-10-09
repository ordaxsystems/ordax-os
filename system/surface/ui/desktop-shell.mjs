import { assertLocalizationPort } from "../../contracts/localization.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import {
  REGIONAL_LOCALE_PREFERENCE_ID,
  REGIONAL_TIME_ZONE_PREFERENCE_ID,
} from "../../services/preferences/regional.mjs";

const SURFACE_LOCALE = "pt-BR";
const SURFACE_TIME_ZONE = "America/Bahia";

const ICONS = Object.freeze({
  home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/></svg>`,
  files: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 8.5v-3A1.5 1.5 0 0 1 5 4h4.3l2.2 2.5"/></svg>`,
  projects: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="7.5" height="6.5" rx="1.2"/><rect x="13" y="4" width="7.5" height="6.5" rx="1.2"/><rect x="3.5" y="13.5" width="7.5" height="6.5" rx="1.2"/><rect x="13" y="13.5" width="7.5" height="6.5" rx="1.2"/></svg>`,
  assistant: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13z"/><path d="M9 9h6M9 12h4"/></svg>`,
  studio: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11m4-7 2 2-2 2m4 0h2"/></svg>`,
  internet: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.4 2.5 3.6 5.3 3.6 8.5S14.4 18 12 20.5C9.6 18 8.4 15.2 8.4 12S9.6 6 12 3.5z"/></svg>`,
  networkApp: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3.5 19a4.5 4.5 0 0 1 9 0M12.5 18.5a4 4 0 0 1 8 0"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.5 1a8 8 0 0 0-2-1.2L14 3h-4l-.4 2.6a8 8 0 0 0-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.5-1a8 8 0 0 0 2 1.2L10 21h4l.4-2.6a8 8 0 0 0 2-1.2l2.5 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/></svg>`,
  account: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21v-2.2A6.8 6.8 0 0 1 11.3 12h1.4a6.8 6.8 0 0 1 6.8 6.8V21z"/></svg>`,
  system: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>`,
  networkWifi: `<svg class="ordax-network-symbol ordax-network-symbol-wifi" viewBox="0 0 24 24" aria-hidden="true"><path class="ordax-wifi-arc ordax-wifi-arc-outer" d="M4 9.5a12 12 0 0 1 16 0"/><path class="ordax-wifi-arc ordax-wifi-arc-middle" d="M7 13a7.5 7.5 0 0 1 10 0"/><path class="ordax-wifi-arc ordax-wifi-arc-inner" d="M10 16.4a3 3 0 0 1 4 0"/><circle class="ordax-wifi-dot" cx="12" cy="19" r="1"/></svg>`,
  networkEthernet: `<svg class="ordax-network-symbol ordax-network-symbol-ethernet" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M8 15v4M16 15v4M8 19h8"/><path d="M9 9h6"/></svg>`,
  networkOther: `<svg class="ordax-network-symbol ordax-network-symbol-other" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 11l8-3M8 13l8 3"/></svg>`,
  battery: `<svg class="ordax-battery-symbol" viewBox="0 0 28 16" aria-hidden="true"><rect x="1.5" y="2" width="22" height="12" rx="2"/><path d="M25 6h1.5v4H25"/><rect class="ordax-battery-segment ordax-battery-segment-1" x="4" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-2" x="8.5" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-3" x="13" y="4.5" width="3.5" height="7" rx="0.8"/><rect class="ordax-battery-segment ordax-battery-segment-4" x="17.5" y="4.5" width="3.5" height="7" rx="0.8"/><path class="ordax-battery-bolt" d="m14.7 1.8-4 6.1h3l-1 6.3 4.5-7h-3z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>`,
});

function railButton(appId, label, icon, t, className = "ordax-rail-button") {
  return `
    <button type="button" class="${className}" data-sidebar-app="${appId}" data-launch-app="${appId}" aria-label="${t("surface.launcher.open", { app: label })}">
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

export function createDesktopShellMarkup(localization) {
  const localizationPort = assertLocalizationPort(localization);
  const t = localizationPort.translate;
  return `
    <div class="ordax-shell" data-ordax-shell>
      <aside class="ordax-rail" aria-label="${t("shell.rail.aria")}">
        <div class="ordax-rail-brand"><span class="ordax-brand-symbol" aria-hidden="true"></span><span class="ordax-brand-word">OrdaX <small>OS</small></span></div>
        <nav class="ordax-rail-nav">
          <button type="button" class="ordax-rail-button" data-show-desktop><span class="ordax-rail-icon">${ICONS.home}</span><span data-home-nav-label>${t("shell.home.title")}</span></button>
          ${railButton("files", t("app.files.title"), ICONS.files, t)}
          ${railButton("projects", t("app.projects.title"), ICONS.projects, t)}
          ${railButton("studio", t("app.studio.title"), ICONS.studio, t)}
          ${railButton("assistant", t("app.assistant.title"), ICONS.assistant, t)}
          ${railButton("internet", t("app.internet.title"), ICONS.internet, t)}
          ${railButton("network", t("app.network.title"), ICONS.networkApp, t)}
          ${railButton("settings", t("app.settings.title"), ICONS.settings, t)}
          ${railButton("account", t("app.account.title"), ICONS.account, t)}
          ${railButton("system", t("app.system.title"), ICONS.system, t)}
        </nav>
        <div class="ordax-power-slot" data-power-slot></div>
      </aside>

      <main class="ordax-workspace" tabindex="-1" data-workspace>
        <header class="ordax-brandbar">
          <div class="ordax-brand" aria-label="OrdaX">
            <span class="ordax-brand-symbol" aria-hidden="true"></span>
            <span class="ordax-brand-word">OrdaX</span>
          </div>
          <button type="button" class="ordax-command" data-launcher-toggle aria-expanded="false" aria-controls="ordax-launcher">
            <span class="ordax-command-icon">${ICONS.search}</span>
            <span class="ordax-command-copy">${t("shell.launcher.command")}</span>
            <kbd>Ctrl + K</kbd>
          </button>
          <div class="ordax-space-switcher-slot" data-space-switcher-slot></div>
        </header>

        <section class="ordax-desktop" aria-labelledby="surface-home-title">
          <div class="ordax-home-panel">
            <div class="ordax-home-hero">
              <p class="ordax-area-kicker" data-area-kicker>${t("surface.area.label", { ordinal: "01" })}</p>
              <span class="ordax-brand-symbol ordax-home-symbol" aria-hidden="true"></span>
              <h1 id="surface-home-title" class="ordax-home-title">OrdaX <span>OS</span></h1>
              <p class="ordax-home-tagline" data-home-tagline>${t("shell.home.tagline")}</p>
            </div>
            <div class="ordax-home-meta">
              <time class="ordax-clock" data-ordax-clock>--:--</time>
              <p class="ordax-date" data-ordax-date>${t("shell.home.loadingDate")}</p>
            </div>
            <section class="ordax-home-actions" aria-labelledby="ordax-home-actions-title">
              <p id="ordax-home-actions-title" class="ordax-section-kicker">${t("shell.home.quickAccess")}</p>
              <div class="ordax-home-action-grid">
                ${["assistant", "projects", "files", "internet", "network", "settings"].map((id) => railButton(id, t(`app.${id}.title`), ICONS[id === "network" ? "networkApp" : id], t, "ordax-home-action")).join("")}
              </div>
            </section>

            <section class="ordax-space" aria-labelledby="ordax-space-title">
              <p id="ordax-space-title" class="ordax-section-kicker">${t("shell.space.title")}</p>
              ${spaceLink("shell.space.documents", "/Documentos", t)}
              ${spaceLink("shell.space.images", "/Imagens", t)}
              ${spaceLink("shell.space.downloads", "/Downloads", t)}
            </section>
          </div>

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

      <footer class="ordax-dock ordax-statusbar" aria-label="${t("shell.statusbar.aria")}">
        <div class="ordax-area-switcher" data-area-switcher aria-label="${t("shell.areas.aria")}"></div>
        <div class="ordax-dock-shortcuts">
          ${["assistant", "files", "projects", "internet"].map((id) => railButton(id, t(`app.${id}.title`), ICONS[id], t, "ordax-dock-shortcut")).join("")}
        </div>
        <div class="ordax-running-apps" data-running-apps aria-label="${t("shell.runningApps.aria")}"></div>
        <div class="ordax-status-actions" data-update-slot></div>
        <div class="ordax-system-tray" aria-label="${t("shell.systemStatus.aria")}">
          <button type="button" class="ordax-tray-item ordax-tray-network" data-connectivity-tray data-quick-panel-toggle="network" aria-expanded="false" aria-controls="ordax-quick-network" aria-label="${t("shell.network.quickOpen")}">
            <span class="ordax-tray-icon ordax-tray-network-icon" data-connectivity-icon data-state="unknown" data-network-kind="unknown" data-signal-level="0" aria-hidden="true">${ICONS.networkWifi}${ICONS.networkEthernet}${ICONS.networkOther}</span>
            <span class="ordax-tray-label" data-connectivity-label>${t("surface.connectivity.unknown")}</span>
          </button>
          <button type="button" class="ordax-tray-item ordax-tray-battery" data-battery-tray data-quick-panel-toggle="battery" aria-expanded="false" aria-controls="ordax-quick-battery" aria-label="${t("shell.battery.quickOpen")}" hidden>
            <span class="ordax-tray-icon ordax-tray-battery-icon" data-battery-icon data-battery-level="0" data-charging="false" aria-hidden="true">${ICONS.battery}</span>
            <span class="ordax-tray-label" data-battery-label>--%</span>
          </button>
          <button type="button" class="ordax-tray-item ordax-tray-clock" data-quick-panel-toggle="datetime" aria-expanded="false" aria-controls="ordax-quick-datetime" aria-label="${t("shell.datetime.quickOpen")}">
            <span class="ordax-tray-icon" aria-hidden="true">${ICONS.clock}</span>
            <time data-ordax-tray-clock>--:--</time>
          </button>
        </div>
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

  aria(".ordax-rail", "shell.rail.aria");
  for (const appId of ["files", "projects", "notes", "assistant", "internet", "network", "settings", "account", "system"]) {
    const label = t(`app.${appId}.title`);
    for (const button of root.querySelectorAll(`[data-sidebar-app="${appId}"]`)) {
      const labelNode = button.querySelector("span:last-child");
      if (labelNode) labelNode.textContent = label;
      button.setAttribute("aria-label", t("surface.launcher.open", { app: label }));
    }
  }
  text("[data-home-nav-label]", "shell.home.title");
  text("[data-home-tagline]", "shell.home.tagline");
  text("#ordax-home-actions-title", "shell.home.quickAccess");
  text(".ordax-command-copy", "shell.launcher.command");
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
  if (!timeNode || !trayTimeNode || !quickTimeNode || !dateNode || !quickDateNode || !timeZoneNode) {
    throw new Error("OrdaX desktop clock requires clock, date and timezone nodes");
  }

  const render = () => {
    const { locale, timeZone } = regionalSettings(preferencePort?.getSnapshot() ?? {});
    const now = new Date();
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
