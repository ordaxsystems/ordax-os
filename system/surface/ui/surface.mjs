import { mountNativeSidebarFit, sidebarIsExpanded, sidebarItemIsActive } from "./sidebar-layout.mjs";
import { mountSidebarHints } from "./sidebar-hints.mjs";
import { assertAppRuntimeCatalog, defaultAppRuntimeCatalog } from "../../apps/runtime-catalog.mjs";
import { externalAppCopy } from "../../apps/external-app-definition.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { PREFERENCE_RUNTIME_SCHEMA } from "../../contracts/preference-runtime.mjs";
import { createPreferencePersistence } from "../../services/preferences/runtime.mjs";
import { assertPreferenceStore, validatePreferenceRecord } from "../../contracts/preference-store.mjs";
import { assertSurfaceHost } from "../../contracts/surface-host.mjs";
import {
  MAX_WORKSPACE_AREAS,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";
import {
  ACCESSIBILITY_CONTRAST_PREFERENCE_ID,
  ACCESSIBILITY_MOTION_PREFERENCE_ID,
  ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID,
} from "../../services/preferences/accessibility.mjs";
import { resolveColorAppearance } from "../../services/preferences/color-palette.mjs";
import { APPEARANCE_PREFERENCE_ID } from "../../services/preferences/appearance.mjs";
import { COLOR_PALETTE_PREFERENCE_ID } from "../../services/preferences/color-palette.mjs";
import { DISPLAY_SCALE_PREFERENCE_ID } from "../../services/preferences/display.mjs";
import {
  createDesktopShellMarkup,
  mountDesktopClock,
  syncDesktopShellLocalization,
  syncDesktopPresentationToggle,
  syncDesktopSidebarToggle,
  syncDesktopThemeToggle,
} from "./desktop-shell.mjs";
import { createSurfaceLocalization } from "../../services/i18n/surface.mjs";
import { moveDesktopShortcutFocus, moveDockFocus, scrollDockFromWheel } from "../../services/surface/dock-navigation.mjs";
import { syncDocumentLocaleProfile } from "./document-localization.mjs";
import { SURFACE_RENDER_LIFECYCLE_SCHEMA } from "../../contracts/surface-render-lifecycle.mjs";
import {
  createSurfaceState,
  createWorkspaceSnapshot,
  getActiveArea,
  reduceSurfaceState,
} from "./surface-state.mjs";

const MOVABLE_WORKSPACE_MIN_WIDTH = 761;
const KEYBOARD_MOVE_STEP = 24;
const WORKSPACE_PERSIST_ACTIONS = new Set([
  "area.create",
  "area.switch",
  "app.launch",
  "app.target",
  "window.focus",
  "window.move",
  "window.minimize",
  "window.maximize",
  "window.close",
  "workspace.show-desktop",
  "app.catalog.sync",
]);

const CONNECTIVITY_MESSAGE_IDS = Object.freeze({
  online: "surface.connectivity.online",
  offline: "surface.connectivity.offline",
  unknown: "surface.connectivity.unknown",
});

function appTitle(localization, app) {
  return app.presentation ? externalAppCopy(app, localization.getLocale()).title
    : localization.translate(`app.${app.id}.title`);
}

function appDescription(localization, app) {
  return app.presentation ? externalAppCopy(app, localization.getLocale()).description
    : localization.translate(`app.${app.id}.description`);
}

function panelCopy(localization, app, index, field) {
  return app.presentation
    ? (field === "body" ? app.panels[index].body : appTitle(localization, app))
    : localization.translate(`app.${app.id}.panel.${index}.${field}`);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function placeChildAt(container, child, index) {
  // Never reinsert an already connected interactive node. Traditional DOM
  // insertion APIs remove + reinsert existing nodes and may reset focus and
  // other interaction state. Runtime collection order is stable by identity;
  // visual window stacking is carried by active state, not DOM movement.
  if (child.parentElement === container) return;
  const current = container.children[index] ?? null;
  container.insertBefore(child, current);
}

function areaLabel(area, localization) {
  return localization.translate("surface.area.label", {
    ordinal: String(area.ordinal).padStart(2, "0"),
  });
}

function capabilityState(capabilityIds, capabilityId, localization) {
  return capabilityIds.includes(capabilityId)
    ? localization.translate("surface.capability.available")
    : localization.translate("surface.capability.unavailable");
}

function panelKey(panel, index) {
  if (panel.kind === "extension") return `extension:${panel.extensionId}`;
  if (panel.kind === "preference-choice") return `preference:${panel.preferenceId}`;
  if (panel.kind === "capability") return `capability:${panel.capabilityId}`;
  return `${panel.kind}:${index}`;
}

function createPreferenceChoice(panel, state) {
  const choices = element("div", "ordax-preference-choices");
  choices.dataset.preferenceChoices = panel.preferenceId;
  syncPreferenceChoice(choices, panel, state);
  return choices;
}

function syncPreferenceChoice(choices, panel, state) {
  const selected = state.preferences[panel.preferenceId];
  const existing = new Map(
    Array.from(choices.children)
      .filter((child) => child.dataset?.preferenceValue !== undefined)
      .map((child) => [child.dataset.preferenceValue, child]),
  );
  const retained = new Set();

  for (const [index, option] of panel.options.entries()) {
    let button = existing.get(option.value) ?? null;
    if (!button) {
      button = element("button", "ordax-preference-choice");
      button.type = "button";
    }
    button.textContent = option.label;
    button.dataset.preferenceId = panel.preferenceId;
    button.dataset.preferenceValue = option.value;
    button.dataset.selected = String(selected === option.value);
    button.setAttribute("aria-pressed", String(selected === option.value));
    placeChildAt(choices, button, index);
    retained.add(button);
  }

  for (const child of Array.from(choices.children)) {
    if (!retained.has(child)) child.remove();
  }
}

function renderCapabilitiesPanel(section, state, localization) {
  section.querySelector("[data-surface-capabilities]")?.remove();
  let content;
  if (state.capabilityIds.length === 0) {
    content = element(
      "p",
      "ordax-empty",
      localization.translate("surface.capability.none"),
    );
  } else {
    content = element("ul", "ordax-capability-list");
    for (const capabilityId of state.capabilityIds) {
      content.append(element("li", "", capabilityId));
    }
  }
  content.dataset.surfaceCapabilities = "";
  const body = section.querySelector(".ordax-app-panel-body");
  if (body) section.insertBefore(content, body);
  else section.append(content);
}

function renderPanel(panel, state, index, app, localization) {
  const section = element(
    "section",
    panel.kind === "extension" ? "ordax-app-extension" : "ordax-app-panel",
  );
  section.dataset.surfacePanelKey = panelKey(panel, index);
  section.dataset.surfacePanelKind = panel.kind;
  const label = panelCopy(localization, app, index, "label");
  const title = panelCopy(localization, app, index, "title");
  const bodyCopy = panel.body ? panelCopy(localization, app, index, "body") : "";
  section.append(element("span", "ordax-app-panel-label", label));
  section.append(element("h3", "ordax-app-panel-title", title));

  if (panel.kind === "extension") {
    section.dataset.appExtension = panel.extensionId;
    section.setAttribute("aria-label", title);
  } else if (panel.kind === "connectivity") {
    const messageId =
      CONNECTIVITY_MESSAGE_IDS[state.connectivity] ?? CONNECTIVITY_MESSAGE_IDS.unknown;
    const badge = element(
      "span",
      "ordax-inline-status",
      localization.translate(messageId),
    );
    badge.dataset.state = state.connectivity;
    section.append(badge);
  } else if (panel.kind === "capability") {
    const available = state.capabilityIds.includes(panel.capabilityId);
    const badge = element(
      "span",
      "ordax-inline-status",
      capabilityState(state.capabilityIds, panel.capabilityId, localization),
    );
    badge.dataset.state = available ? "available" : "unavailable";
    section.append(badge);
  } else if (panel.kind === "capabilities") {
    renderCapabilitiesPanel(section, state, localization);
  } else if (panel.kind === "preference-choice") {
    section.append(createPreferenceChoice(panel, state));
  }

  if (panel.body) section.append(element("p", "ordax-app-panel-body", bodyCopy));
  return section;
}

function syncPanel(section, panel, state, index, app, localization) {
  section.dataset.surfacePanelKind = panel.kind;
  const label = section.querySelector(".ordax-app-panel-label");
  const title = section.querySelector(".ordax-app-panel-title");
  if (label) label.textContent = panelCopy(localization, app, index, "label");
  if (title) title.textContent = panelCopy(localization, app, index, "title");

  if (panel.kind === "extension") {
    section.dataset.appExtension = panel.extensionId;
    section.setAttribute("aria-label", panelCopy(localization, app, index, "title"));
    const body = section.querySelector(".ordax-app-panel-body");
    if (body && panel.body) {
      body.textContent = panelCopy(localization, app, index, "body");
    }
    return;
  }

  if (panel.kind === "connectivity") {
    const badge = section.querySelector(".ordax-inline-status");
    if (badge) {
      const messageId =
        CONNECTIVITY_MESSAGE_IDS[state.connectivity] ?? CONNECTIVITY_MESSAGE_IDS.unknown;
      badge.textContent = localization.translate(messageId);
      badge.dataset.state = state.connectivity;
    }
  } else if (panel.kind === "capability") {
    const available = state.capabilityIds.includes(panel.capabilityId);
    const badge = section.querySelector(".ordax-inline-status");
    if (badge) {
      badge.textContent = capabilityState(
        state.capabilityIds,
        panel.capabilityId,
        localization,
      );
      badge.dataset.state = available ? "available" : "unavailable";
    }
  } else if (panel.kind === "capabilities") {
    renderCapabilitiesPanel(section, state, localization);
  } else if (panel.kind === "preference-choice") {
    const choices = section.querySelector(".ordax-preference-choices");
    if (choices) syncPreferenceChoice(choices, panel, state);
  }

  const body = section.querySelector(".ordax-app-panel-body");
  if (body && panel.body) {
    body.textContent = panelCopy(localization, app, index, "body");
  }
}

function syncWindowPanels(body, app, state, localization) {
  const existing = new Map(
    Array.from(body.children)
      .filter((child) => child.dataset?.surfacePanelKey)
      .map((child) => [child.dataset.surfacePanelKey, child]),
  );
  const retained = new Set();

  for (const [index, panel] of app.panels.entries()) {
    const key = panelKey(panel, index);
    let section = existing.get(key) ?? null;
    if (!section || section.dataset.surfacePanelKind !== panel.kind) {
      section?.remove();
      section = renderPanel(panel, state, index, app, localization);
    } else {
      syncPanel(section, panel, state, index, app, localization);
    }
    placeChildAt(body, section, index);
    retained.add(section);
  }

  for (const child of Array.from(body.children)) {
    if (!retained.has(child)) child.remove();
  }
}

function syncWindowNode(windowNode, app, windowState, state, index, area, localization) {
  windowNode.dataset.windowId = windowState.id;
  windowNode.dataset.appId = app.id;
  windowNode.dataset.windowAreaId = area.id;
  windowNode.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized);
  windowNode.dataset.maximized = String(windowState.maximized);
  windowNode.dataset.minimized = String(windowState.minimized);
  windowNode.hidden = windowState.minimized;
  delete windowNode.dataset.dragging;

  const placementOrdinal = windowState.placementOrdinal ?? index + 1;
  windowNode.style.setProperty("--ordax-window-offset", `${((placementOrdinal - 1) % 5) * 18}px`);
  if (
    !windowState.maximized &&
    Number.isFinite(windowState.positionX) &&
    Number.isFinite(windowState.positionY)
  ) {
    windowNode.style.left = `${windowState.positionX}px`;
    windowNode.style.top = `${windowState.positionY}px`;
    windowNode.style.transform = "none";
    windowNode.dataset.positioned = "true";
  } else {
    windowNode.style.removeProperty("left");
    windowNode.style.removeProperty("top");
    windowNode.style.removeProperty("transform");
    delete windowNode.dataset.positioned;
  }

  const localizedTitle = appTitle(localization, app);
  const localizedDescription = appDescription(localization, app);
  windowNode.setAttribute("role", "region");
  windowNode.setAttribute("aria-label", localizedTitle);
  const titleGroup = windowNode.querySelector(".ordax-window-title-group");
  const titleNode = titleGroup?.querySelector("strong");
  const descriptionNode = titleGroup?.querySelector("small");
  if (titleNode) titleNode.textContent = localizedTitle;
  if (descriptionNode) descriptionNode.textContent = localizedDescription;
  const titlebar = windowNode.querySelector("[data-window-titlebar]");
  titlebar?.setAttribute(
    "aria-label",
    localization.translate("surface.window.move", { app: localizedTitle }),
  );

  for (const control of windowNode.querySelectorAll("[data-window-action]")) {
    control.dataset.windowId = windowState.id;
    const action = control.dataset.windowAction;
    if (action === "minimize") {
      control.setAttribute(
        "aria-label",
        localization.translate("surface.window.minimize", { app: localizedTitle }),
      );
    }
    if (action === "maximize") {
      control.setAttribute(
        "aria-label",
        localization.translate(
          windowState.maximized ? "surface.window.restore" : "surface.window.maximize",
          { app: localizedTitle },
        ),
      );
    }
    if (action === "close") {
      control.setAttribute(
        "aria-label",
        localization.translate("surface.window.close", { app: localizedTitle }),
      );
    }
  }

  const body = windowNode.querySelector(".ordax-window-body");
  if (body) syncWindowPanels(body, app, state, localization);
}

function createWindow(app, windowState, state, index, area, localization) {
  const windowNode = element("article", "ordax-window");
  const titlebar = element("header", "ordax-window-titlebar");
  titlebar.dataset.windowTitlebar = "";
  titlebar.tabIndex = 0;

  const identity = element("div", "ordax-window-identity");
  identity.append(element("span", "ordax-app-mark", app.monogram));
  const titleGroup = element("div", "ordax-window-title-group");
  titleGroup.append(element("strong", "", appTitle(localization, app)));
  titleGroup.append(element("small", "", appDescription(localization, app)));
  identity.append(titleGroup);

  const controls = element("div", "ordax-window-controls");
  for (const [action, glyph] of [
    ["minimize", "−"],
    ["maximize", "□"],
    ["close", "×"],
  ]) {
    const button = element("button", `ordax-window-control ordax-window-${action}`, glyph);
    button.type = "button";
    button.dataset.windowAction = action;
    controls.append(button);
  }
  titlebar.append(identity, controls);

  const body = element("div", "ordax-window-body");
  windowNode.append(titlebar, body);
  syncWindowNode(windowNode, app, windowState, state, index, area, localization);
  return windowNode;
}

export function mountSurface(
  root,
  host,
  preferenceStore = null,
  workspaceStore = null,
  appActivation = null,
  appCatalog = defaultAppRuntimeCatalog,
) {
  if (!(root instanceof Element)) {
    throw new TypeError("Surface root must be a DOM Element");
  }
  assertSurfaceHost(host);
  let catalog = assertAppRuntimeCatalog(appCatalog);
  const store = preferenceStore === null ? null : assertPreferenceStore(preferenceStore);
  const workspacePort = workspaceStore === null ? null : assertWorkspaceStore(workspaceStore);
  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);
  const documentElement = root.ownerDocument.documentElement;
  const originalDocumentLanguage = documentElement.getAttribute("lang");
  const originalDocumentDirection = documentElement.getAttribute("dir");
  const preferenceSeed = store ? validatePreferenceRecord(store.load()) : {};
  const workspaceSeed = workspacePort ? validateWorkspaceRecord(workspacePort.load()) : null;
  let dragSession = null;
  const renderListeners = new Set();
  const preferenceListeners = new Set();
  const preferencePersistence = createPreferencePersistence(store);
  let preferenceDispatching = false;

  let state = createSurfaceState(host.getSnapshot(), preferenceSeed, workspaceSeed, catalog);
  const unsubscribePreferencePersistence = preferencePersistence.subscribe(() => {
    // The reducer publishes a synchronous preference change after render.
    // Only a later host ACK needs an independent UI notification.
    if (!preferenceDispatching) {
      for (const listener of [...preferenceListeners]) listener(state.preferences);
    }
  });
  const preferences = Object.freeze({
    schema: PREFERENCE_RUNTIME_SCHEMA,
    getSnapshot() {
      return state.preferences;
    },
    getPersistenceSnapshot() {
      return preferencePersistence.getSnapshot();
    },
    set(preferenceId, value) {
      dispatch({ type: "preference.set", preferenceId, value });
      return state.preferences;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Preference runtime listener must be a function");
      }
      preferenceListeners.add(listener);
      listener(state.preferences);
      return () => preferenceListeners.delete(listener);
    },
  });
  const localization = createSurfaceLocalization(preferences);
  root.innerHTML = createDesktopShellMarkup(localization);

  const desktopClock = mountDesktopClock(root, preferences, localization);
  const sidebarHints = mountSidebarHints(root, root.querySelector(".ordax-rail"));
  function syncSidebarToggle() {
    const toggle = root.querySelector("[data-sidebar-toggle]");
    const expanded = sidebarIsExpanded(root.querySelector(".ordax-rail"));
    syncDesktopSidebarToggle(toggle, expanded, localization);
  }
  const sidebarFit = mountNativeSidebarFit(root.querySelector('[data-sidebar-slot="navigation"]'), syncSidebarToggle);

  const workspace = root.querySelector("[data-workspace]");
  const launcher = root.querySelector("[data-launcher]");
  const navigationMenu = root.querySelector("[data-native-navigation-menu]");
  const navigationQuery = root.querySelector("[data-native-navigation-query]");
  const launcherToggle = root.querySelector("[data-launcher-toggle]");
  const launcherQuery = root.querySelector("[data-launcher-query]");
  const appLauncher = root.querySelector("[data-app-launcher]");
  const windowLayer = root.querySelector("[data-window-layer]");
  const nativeDock = root.querySelector(".meridian-native-dock");
  const runningApps = root.querySelector("[data-running-apps]");
  const areaSwitcher = root.querySelector("[data-area-switcher]");
  const areaMenu = root.querySelector("[data-native-area-menu]");
  const areaMenuToggle = root.querySelector("[data-area-menu-toggle]");
  const areaKicker = root.querySelector("[data-area-kicker]");

  const updateDockOverflow = () => {
    if (!nativeDock) return;
    const remaining = Math.max(0, nativeDock.scrollWidth - nativeDock.clientWidth - nativeDock.scrollLeft);
    nativeDock.dataset.scrollBefore = String(nativeDock.scrollLeft > 1);
    nativeDock.dataset.scrollAfter = String(remaining > 1);
  };

  const onNativeDockWheel = (event) => scrollDockFromWheel(event, nativeDock);

  const revealDockButton = (button) => {
    if (!nativeDock || !button) return;
    const viewport = nativeDock.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    if (target.left < viewport.left) nativeDock.scrollLeft -= viewport.left - target.left;
    else if (target.right > viewport.right) nativeDock.scrollLeft += target.right - viewport.right;
    updateDockOverflow();
  };

  const setAreaMenuOpen = (open, { restoreFocus = false } = {}) => {
    areaMenu.hidden = !open;
    areaMenuToggle.setAttribute("aria-expanded", String(open));
    if (restoreFocus) areaMenuToggle.focus();
  };

  const findRenderedWindow = (windowId) => {
    const areaId = getActiveArea(state).id;
    return Array.from(windowLayer.children).find(
      (node) => node.dataset.windowAreaId === areaId && node.dataset.windowId === windowId,
    ) ?? null;
  };

  const isMovableWorkspace = () =>
    windowLayer.getBoundingClientRect().width >= MOVABLE_WORKSPACE_MIN_WIDTH;

  const clampPosition = (x, y, width, height) => {
    const layerRect = windowLayer.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(0, x), Math.max(0, layerRect.width - width))),
      y: Math.round(Math.min(Math.max(0, y), Math.max(0, layerRect.height - height))),
    };
  };

  const renderedGeometry = (windowNode) => {
    const layerRect = windowLayer.getBoundingClientRect();
    const windowRect = windowNode.getBoundingClientRect();
    return {
      x: windowRect.left - layerRect.left,
      y: windowRect.top - layerRect.top,
      width: windowRect.width,
      height: windowRect.height,
    };
  };

  const renderLauncher = () => {
    const locale = localization.getLocale();
    const query = launcherQuery.value.trim().toLocaleLowerCase(locale);
    const focusedLauncherApp = root.ownerDocument.activeElement?.dataset?.launchApp ?? null;
    const retained = new Set();
    let visible = 0;

    for (const [index, app] of catalog.list().entries()) {
      const available = catalog.isAvailable(app, state.capabilityIds);
      const localizedTitle = appTitle(localization, app);
      const localizedDescription = appDescription(localization, app);
      const searchable = `${localizedTitle} ${localizedDescription} ${app.id}`.toLocaleLowerCase(locale);
      const matches = !query || searchable.includes(query);
      let button = Array.from(appLauncher.children).find(
        (child) => child.dataset?.launchApp === app.id,
      ) ?? null;
      if (!button) {
        button = element("button", "ordax-launcher-app");
        button.type = "button";
        button.dataset.launchApp = app.id;
        button.append(element("span", "ordax-app-mark", app.monogram));
        const copy = element("span", "ordax-launcher-app-copy");
        copy.append(element("strong"));
        copy.append(element("small"));
        button.append(copy);
      }

      button.hidden = !matches;
      button.disabled = !available;
      button.setAttribute(
        "aria-label",
        available
          ? localization.translate("surface.launcher.open", { app: localizedTitle })
          : localization.translate("surface.launcher.unavailable", { app: localizedTitle }),
      );
      const copy = button.querySelector(".ordax-launcher-app-copy");
      if (copy) {
        const title = copy.querySelector("strong");
        const description = copy.querySelector("small");
        if (title) title.textContent = localizedTitle;
        if (description) {
          description.textContent = available
            ? localizedDescription
            : localization.translate("surface.launcher.requirementsUnavailable");
        }
      }
      placeChildAt(appLauncher, button, index);
      retained.add(button);
      if (matches) visible += 1;
    }

    for (const child of Array.from(appLauncher.children)) {
      if (child.dataset?.launchApp && !retained.has(child)) child.remove();
    }

    let empty = appLauncher.querySelector("[data-launcher-empty]");
    if (visible === 0) {
      if (!empty) {
        empty = element(
          "p",
          "ordax-launcher-empty",
          localization.translate("surface.launcher.empty"),
        );
        empty.dataset.launcherEmpty = "";
      }
      placeChildAt(appLauncher, empty, retained.size);
    } else {
      empty?.remove();
    }

    if (focusedLauncherApp) {
      const focusedButton = Array.from(appLauncher.children).find(
        (child) => child.dataset?.launchApp === focusedLauncherApp,
      ) ?? null;
      if (!focusedButton || focusedButton.hidden || focusedButton.disabled) {
        launcherQuery.focus({ preventScroll: true });
      }
    }
  };

  const renderWindows = () => {
    const area = getActiveArea(state);
    const retained = new Set();
    let renderedIndex = 0;
    let visibleIndex = 0;

    for (const windowState of area.windows) {
      const app = catalog.get(windowState.appId);
      if (!app) continue;
      const index = visibleIndex;
      if (!windowState.minimized) visibleIndex += 1;

      let windowNode = Array.from(windowLayer.children).find(
        (node) =>
          node.dataset.windowAreaId === area.id
          && node.dataset.windowId === windowState.id
          && node.dataset.appId === app.id,
      ) ?? null;
      if (!windowNode) {
        windowNode = createWindow(app, windowState, state, index, area, localization);
      } else {
        syncWindowNode(windowNode, app, windowState, state, index, area, localization);
      }
      placeChildAt(windowLayer, windowNode, renderedIndex);
      renderedIndex += 1;
      retained.add(windowNode);
    }

    for (const staleWindow of Array.from(windowLayer.children)) {
      if (!retained.has(staleWindow)) staleWindow.remove();
    }
  };

  const renderDock = () => {
    const area = getActiveArea(state);
    const retained = new Set();
    const pinnedButtons = Array.from(root.querySelectorAll("[data-dock-pinned-app]"));
    const pinnedAppIds = new Set(pinnedButtons.map((button) => button.dataset.dockPinnedApp));
    for (const button of pinnedButtons) {
      const appId = button.dataset.dockPinnedApp;
      const app = catalog.get(appId);
      const windowState = area.windows.find((item) => item.appId === appId) ?? null;
      if (!app) {
        button.hidden = true;
        continue;
      }
      button.hidden = false;
      const localizedTitle = appTitle(localization, app);
      if (windowState) {
        button.dataset.openWindow = windowState.id;
        button.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized);
        button.dataset.minimized = String(windowState.minimized);
        button.removeAttribute("data-launch-app");
        button.setAttribute("aria-label", localization.translate(
          windowState.minimized ? "surface.dock.restore" : "surface.dock.focus",
          { app: localizedTitle },
        ));
        button.title = `${localizedTitle} · ${localization.translate(
          windowState.minimized ? "surface.dock.restore" : "surface.dock.focus",
          { app: localizedTitle },
        )}`;
        if (button.dataset.active === "true") button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      } else {
        delete button.dataset.openWindow;
        delete button.dataset.active;
        delete button.dataset.minimized;
        button.dataset.launchApp = appId;
        button.setAttribute("aria-label", localization.translate("surface.launcher.open", { app: localizedTitle }));
        button.title = localizedTitle;
        button.removeAttribute("aria-current");
      }
    }
    let index = 0;
    for (const windowState of area.windows) {
      const app = catalog.get(windowState.appId);
      if (!app) continue;
      if (pinnedAppIds.has(app.id)) continue;
      let button = Array.from(runningApps.children).find(
        (child) => child.dataset?.openWindow === windowState.id,
      ) ?? null;
      if (!button) {
        button = element("button", "ordax-running-app");
        button.type = "button";
        button.dataset.openWindow = windowState.id;
      }
      let icon = button.querySelector(".ordax-rail-icon");
      if (!icon) {
        // Preserve existing, potentially focused controls and their children
        // when repairing an absent icon during incremental reconciliation.
        icon = element("span", "ordax-rail-icon");
        icon.setAttribute("aria-hidden", "true");
        button.prepend(icon);
      }
      if (ICONS[app.id]) icon.innerHTML = ICONS[app.id];
      else icon.textContent = app.monogram;
      button.dataset.active = String(area.activeWindowId === windowState.id && !windowState.minimized);
      button.dataset.minimized = String(windowState.minimized);
      if (button.dataset.active === "true") button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
      const localizedTitle = appTitle(localization, app);
      button.setAttribute(
        "aria-label",
        localization.translate(
          windowState.minimized ? "surface.dock.restore" : "surface.dock.focus",
          { app: localizedTitle },
        ),
      );
      button.title = localizedTitle;
      placeChildAt(runningApps, button, index);
      index += 1;
      retained.add(button);
    }
    for (const child of Array.from(runningApps.children)) {
      if (child.dataset?.openWindow && !retained.has(child)) child.remove();
    }
    updateDockOverflow();
  };

  const renderSidebar = () => {
    const area = getActiveArea(state);
    const activeWindow = area.windows.find((item) => item.id === area.activeWindowId) ?? null;
    const homeButton = root.querySelector(".meridian-home-destination");
    if (homeButton) {
      homeButton.hidden = state.presentation !== "central";
      const homeActive = activeWindow === null && state.presentation === "central";
      homeButton.dataset.active = String(homeActive);
      if (homeActive) homeButton.setAttribute("aria-current", "page");
      else homeButton.removeAttribute("aria-current");
    }
    for (const button of root.querySelectorAll("[data-sidebar-app]")) {
      const appId = button.dataset.sidebarApp;
      const app = catalog.get(appId);
      button.disabled = !catalog.isAvailable(app, state.capabilityIds);
      const active = sidebarItemIsActive(activeWindow, button);
      button.dataset.active = String(active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  };

  const renderAreas = () => {
    const activeArea = getActiveArea(state);
    const retained = new Set();
    let index = 0;
    for (const area of state.areas) {
      const active = area.id === state.activeAreaId;
      let button = Array.from(areaSwitcher.children).find(
        (child) => child.dataset?.areaId === area.id,
      ) ?? null;
      if (!button) {
        button = element("button", "ordax-area-button");
        button.type = "button";
        button.dataset.areaId = area.id;
      }
      button.textContent = areaLabel(area, localization);
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "true" : "false");
      button.setAttribute(
        "aria-label",
        localization.translate("surface.area.switch", {
          area: areaLabel(area, localization),
        }),
      );
      if (active) {
        const dot = element("span", "ordax-area-dot");
        dot.setAttribute("aria-hidden", "true");
        button.prepend(dot);
      }
      placeChildAt(areaSwitcher, button, index);
      index += 1;
      retained.add(button);
    }

    let add = areaSwitcher.querySelector("[data-area-create]");
    if (state.areas.length < MAX_WORKSPACE_AREAS) {
      if (!add) {
        add = element("button", "ordax-area-button ordax-area-add", "+");
        add.type = "button";
        add.dataset.areaCreate = "";
      }
      add.setAttribute(
        "aria-label",
        localization.translate("surface.area.create"),
      );
      placeChildAt(areaSwitcher, add, index);
      retained.add(add);
    } else {
      add?.remove();
    }

    for (const child of Array.from(areaSwitcher.children)) {
      if (!retained.has(child)) child.remove();
    }
    areaKicker.textContent = areaLabel(activeArea, localization);
    root.querySelector("[data-current-area]").textContent = areaLabel(activeArea, localization);
  };

  const render = () => {
    syncDocumentLocaleProfile(documentElement, localization);
    syncDesktopShellLocalization(root, localization);
    const appearance = resolveColorAppearance(state.preferences);
    root.dataset.ordaxTheme = appearance.scheme;
    root.dataset.theme = appearance.colorTheme;
    root.dataset.ordaxPalette = appearance.colorTheme === "native" ? "native" : "standard";
    const themeToggle = root.querySelector("[data-native-theme-toggle]");
    if (themeToggle) {
      syncDesktopThemeToggle(themeToggle, appearance, localization);
    }
    root.dataset.workspacePresentation = state.presentation;
    root.dataset.view = state.presentation;
    root.dataset.nativeSidebar = state.sidebarMode;
    const sidebarToggle = root.querySelector("[data-sidebar-toggle]");
    const sidebarExpanded = sidebarIsExpanded(root.querySelector(".ordax-rail"));
    sidebarToggle.hidden = state.presentation === "desktop";
    syncDesktopSidebarToggle(sidebarToggle, sidebarExpanded, localization);
    root.querySelector("[data-central-presentation]").hidden = state.presentation !== "central";
    root.querySelector("[data-desktop-presentation]").hidden = state.presentation !== "desktop";
    const presentationToggle = root.querySelector("[data-presentation-toggle]");
    syncDesktopPresentationToggle(presentationToggle, state.presentation, localization);
    root.dataset.ordaxContrast = state.preferences[ACCESSIBILITY_CONTRAST_PREFERENCE_ID];
    root.dataset.ordaxMotion = state.preferences[ACCESSIBILITY_MOTION_PREFERENCE_ID];
    documentElement.dataset.ordaxTextScale =
      state.preferences[ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID];
    documentElement.dataset.ordaxDisplayScale =
      state.preferences[DISPLAY_SCALE_PREFERENCE_ID];
    root.dataset.ordaxDisplayScale = state.preferences[DISPLAY_SCALE_PREFERENCE_ID];
    launcher.hidden = !state.launcherOpen;
    root.querySelectorAll("[data-launcher-toggle]").forEach(button => button.setAttribute("aria-expanded", String(state.launcherOpen)));
    root.querySelectorAll("[data-navigation-menu-toggle]").forEach(button => button.setAttribute("aria-expanded", String(!navigationMenu.hidden)));
    const moreDestinations = root.querySelector("[data-nav-menu-more]");
    if (moreDestinations) {
      const label = localization.translate("shell.sidebar.more");
      moreDestinations.setAttribute("aria-label", label);
      moreDestinations.title = label;
      const labelNode = moreDestinations.querySelector("span:last-child");
      if (labelNode) labelNode.textContent = label;
    }

    const connectivityMessage =
      CONNECTIVITY_MESSAGE_IDS[state.connectivity] ?? CONNECTIVITY_MESSAGE_IDS.unknown;
    const connectivityLabel = localization.translate(connectivityMessage);
    const connectivityTray = root.querySelector("[data-connectivity-tray]");
    if (connectivityTray.dataset.networkDetailOwner !== "true") {
      root.querySelector("[data-connectivity-label]").textContent = connectivityLabel;
      const connectivityIcon = root.querySelector("[data-connectivity-icon]");
      connectivityIcon.dataset.state = state.connectivity;
      connectivityIcon.dataset.networkKind = "unknown";
      connectivityIcon.dataset.signalLevel = "0";
      connectivityTray.title = localization.translate("surface.network.label", {
        status: connectivityLabel,
      });
    }

    for (const targetButton of root.querySelectorAll("[data-requires-capability]")) {
      const capabilityId = targetButton.dataset.requiresCapability;
      const available = state.capabilityIds.includes(capabilityId);
      targetButton.disabled = !available;
      targetButton.setAttribute("aria-disabled", String(!available));
      targetButton.title = available
        ? ""
        : localization.translate("surface.capability.destinationRequired");
    }

    const activeNavigationWindow = getActiveArea(state).windows.find(item => item.id === getActiveArea(state).activeWindowId) ?? null;
    for (const targetButton of navigationMenu.querySelectorAll("[data-nav-menu-app]")) {
      const app = catalog.get(targetButton.dataset.navMenuApp);
      const available = catalog.isAvailable(app, state.capabilityIds);
      targetButton.disabled = !available;
      targetButton.setAttribute("aria-disabled", String(!available));
      targetButton.dataset.active = String(activeNavigationWindow?.appId === targetButton.dataset.navMenuApp);
    }

    renderLauncher();
    renderWindows();
    renderDock();
    renderSidebar();
    renderAreas();
    for (const listener of [...renderListeners]) listener();
  };

  const dispatch = (action) => {
    const previousPreferences = state.preferences;
    const next = reduceSurfaceState(state, action, catalog);
    if (next === state) return;
    state = next;
    const preferencesChanged = state.preferences !== previousPreferences;
    if (preferencesChanged) {
      preferenceDispatching = true;
      try { preferencePersistence.save(state.preferences); }
      finally { preferenceDispatching = false; }
    }
    if (workspacePort && WORKSPACE_PERSIST_ACTIONS.has(action?.type)) {
      workspacePort.save(createWorkspaceSnapshot(state));
    }
    render();
    if (preferencesChanged) {
      for (const listener of [...preferenceListeners]) listener(state.preferences);
    }
  };

  const openLauncher = () => {
    if (!state.launcherOpen) dispatch({ type: "launcher.toggle" });
    queueMicrotask(() => {
      launcherQuery.focus();
      launcherQuery.select();
    });
  };
  let navigationMenuTrigger = null;
  const openNativeNavigation = (trigger = document.activeElement) => {
    navigationMenuTrigger = trigger instanceof HTMLElement ? trigger : null;
    navigationQuery.value = "";
    filterNativeNavigation("");
    navigationMenu.hidden = false;
    root.querySelectorAll("[data-navigation-menu-toggle]").forEach(button => button.setAttribute("aria-expanded", "true"));
    queueMicrotask(() => navigationQuery.focus());
  };
  const closeNativeNavigation = ({ restoreFocus = false } = {}) => {
    if (navigationMenu.hidden) return;
    navigationMenu.hidden = true;
    root.querySelectorAll("[data-navigation-menu-toggle]").forEach(button => button.setAttribute("aria-expanded", "false"));
    if (restoreFocus && navigationMenuTrigger?.isConnected) navigationMenuTrigger.focus({ preventScroll: true });
    navigationMenuTrigger = null;
  };
  const filterNativeNavigation = query => {
    const locale = localization.getLocale();
    const normalized = String(query).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale).trim();
    for (const button of navigationMenu.querySelectorAll("[data-nav-menu-item]")) {
      const value = button.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale);
      button.hidden = normalized !== "" && !value.includes(normalized);
    }
    for (const group of navigationMenu.querySelectorAll("[data-nav-menu-group]")) {
      group.hidden = !group.querySelector("[data-nav-menu-item]:not([hidden])");
    }
  };

  const onClick = (event) => {
    const areaMenuButton = event.target.closest("[data-area-menu-toggle]");
    if (areaMenuButton) {
      setAreaMenuOpen(areaMenu.hidden);
      return;
    }

    if (!areaMenu.hidden && !event.target.closest("[data-native-area-menu]")) {
      setAreaMenuOpen(false);
    }

    const areaButton = event.target.closest("[data-area-id]");
    if (areaButton) {
      dispatch({ type: "area.switch", areaId: areaButton.dataset.areaId });
      setAreaMenuOpen(false);
      workspace.focus({ preventScroll: true });
      return;
    }

    const areaCreate = event.target.closest("[data-area-create]");
    if (areaCreate) {
      dispatch({ type: "area.create" });
      setAreaMenuOpen(false);
      workspace.focus({ preventScroll: true });
      return;
    }

    const launcherButton = event.target.closest("[data-launcher-toggle]");
    if (launcherButton) {
      closeNativeNavigation();
      if (state.launcherOpen) {
        dispatch({ type: "launcher.close" });
      } else {
        openLauncher();
      }
      return;
    }

    const navigationToggle = event.target.closest("[data-navigation-menu-toggle]");
    if (navigationToggle) {
      if (navigationMenu.hidden) openNativeNavigation(navigationToggle);
      else closeNativeNavigation({ restoreFocus: true });
      return;
    }

    if (event.target.closest("[data-navigation-menu-close]")) {
      closeNativeNavigation({ restoreFocus: true });
      return;
    }

    if (event.target.closest("[data-native-navigation-home]")) {
      closeNativeNavigation();
      dispatch({ type: "workspace.presentation", value: "central" });
      dispatch({ type: "workspace.show-desktop" });
      workspace.focus({ preventScroll: true });
      return;
    }

    if (!navigationMenu.hidden && !event.target.closest("[data-native-navigation-menu]")) {
      closeNativeNavigation();
    }

    const themeToggle = event.target.closest("[data-native-theme-toggle]");
    if (themeToggle) {
      const appearance = resolveColorAppearance(state.preferences);
      const nextScheme = appearance.scheme === "dark" ? "light" : "dark";
      dispatch({ type: "preference.set", preferenceId: APPEARANCE_PREFERENCE_ID, value: nextScheme });
      if (state.preferences[COLOR_PALETTE_PREFERENCE_ID] === "native") {
        dispatch({ type: "preference.set", preferenceId: COLOR_PALETTE_PREFERENCE_ID, value: "standard" });
      }
      return;
    }

    const appButton = event.target.closest("[data-launch-app]");
    if (appButton) {
      closeNativeNavigation();
      const appId = appButton.dataset.launchApp;
      const requiredCapability = appButton.dataset.requiresCapability;
      const app = catalog.get(appId);
      if (
        (requiredCapability && !state.capabilityIds.includes(requiredCapability)) ||
        !catalog.isAvailable(app, state.capabilityIds)
      ) {
        return;
      }
      const target = appButton.dataset.appTarget;
      if (target && activationPort) {
        activationPort.publish({ appId, target });
      } else {
        dispatch({ type: "app.launch", appId });
      }
      launcherQuery.value = "";
      return;
    }

    const preferenceButton = event.target.closest("[data-preference-id]");
    if (preferenceButton) {
      dispatch({
        type: "preference.set",
        preferenceId: preferenceButton.dataset.preferenceId,
        value: preferenceButton.dataset.preferenceValue,
      });
      return;
    }

    const sidebarToggle = event.target.closest("[data-sidebar-toggle]");
    if (sidebarToggle) {
      dispatch({ type: "workspace.sidebar", value: sidebarIsExpanded(root.querySelector(".ordax-rail")) ? "collapsed" : "expanded" });
      return;
    }
    const presentationToggle = event.target.closest("[data-presentation-toggle]");
    if (presentationToggle) {
      dispatch({ type: "workspace.presentation", value: state.presentation === "central" ? "desktop" : "central" });
      workspace.focus({ preventScroll: true });
      return;
    }
    const showDesktop = event.target.closest("[data-show-desktop]");
    if (showDesktop) {
      dispatch({ type: "workspace.presentation", value: "central" });
      dispatch({ type: "workspace.show-desktop" });
      workspace.focus({ preventScroll: true });
      return;
    }

    const runningButton = event.target.closest("[data-open-window]");
    if (runningButton) {
      dispatch({ type: "window.focus", windowId: runningButton.dataset.openWindow });
      return;
    }

    const control = event.target.closest("[data-window-action]");
    if (control) {
      const action = control.dataset.windowAction;
      dispatch({ type: `window.${action}`, windowId: control.dataset.windowId });
      if (action === "minimize" || action === "close") {
        workspace.focus({ preventScroll: true });
      }
      return;
    }

    const windowNode = event.target.closest("[data-window-id]");
    if (windowNode) {
      dispatch({ type: "window.focus", windowId: windowNode.dataset.windowId });
      return;
    }

    if (state.launcherOpen && !event.target.closest("[data-launcher]")) {
      dispatch({ type: "launcher.close" });
    }
  };

  const onInput = (event) => {
    if (event.target === launcherQuery) renderLauncher();
    if (event.target === navigationQuery) filterNativeNavigation(navigationQuery.value);
  };

  // The embedded browser is an implementation detail of the native Surface.
  // Do not leak its vendor context menu (and untranslated browser actions) into
  // the OrdaX product. A future OrdaX-owned context menu can replace this with
  // localized actions once those actions have product semantics.
  const onContextMenu = (event) => {
    event.preventDefault();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !isMovableWorkspace()) return;
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!titlebar || !windowNode || event.target.closest("[data-window-action]")) return;
    const area = getActiveArea(state);
    const windowState = area.windows.find((item) => item.id === windowNode.dataset.windowId);
    if (!windowState || windowState.maximized) return;

    const geometry = renderedGeometry(windowNode);
    dispatch({ type: "window.focus", windowId: windowState.id });
    const focusedNode = findRenderedWindow(windowState.id);
    const focusedTitlebar = focusedNode?.querySelector("[data-window-titlebar]");
    if (!focusedNode || !focusedTitlebar) return;

    focusedTitlebar.setPointerCapture?.(event.pointerId);
    dragSession = {
      pointerId: event.pointerId,
      windowId: windowState.id,
      node: focusedNode,
      titlebar: focusedTitlebar,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: geometry.x,
      startY: geometry.y,
      width: geometry.width,
      height: geometry.height,
      x: geometry.x,
      y: geometry.y,
      moved: false,
    };
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const deltaX = event.clientX - dragSession.startClientX;
    const deltaY = event.clientY - dragSession.startClientY;
    if (!dragSession.moved && Math.abs(deltaX) + Math.abs(deltaY) < 3) return;

    const position = clampPosition(
      dragSession.startX + deltaX,
      dragSession.startY + deltaY,
      dragSession.width,
      dragSession.height,
    );
    dragSession.moved = true;
    dragSession.x = position.x;
    dragSession.y = position.y;
    dragSession.node.dataset.dragging = "true";
    dragSession.node.style.left = `${position.x}px`;
    dragSession.node.style.top = `${position.y}px`;
    dragSession.node.style.transform = "none";
    event.preventDefault();
  };

  const finishPointerDrag = (event, commit) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    const current = dragSession;
    dragSession = null;
    current.titlebar.releasePointerCapture?.(event.pointerId);
    if (current.moved && commit) {
      dispatch({ type: "window.move", windowId: current.windowId, x: current.x, y: current.y });
    } else if (current.moved) {
      render();
    }
  };

  const onPointerUp = (event) => finishPointerDrag(event, true);
  const onPointerCancel = (event) => finishPointerDrag(event, false);

  const onDoubleClick = (event) => {
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!windowNode || event.target.closest("[data-window-action]")) return;
    dispatch({ type: "window.maximize", windowId: windowNode.dataset.windowId });
  };

  const onKeyDown = (event) => {
    if (moveDockFocus(event, nativeDock, "button", revealDockButton)) return;
    if (moveDesktopShortcutFocus(event, root, "[data-desktop-app]")) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      openNativeNavigation(event.target);
      return;
    }

    if (event.key === "Escape" && !navigationMenu.hidden) {
      closeNativeNavigation({ restoreFocus: true });
      return;
    }

    if (event.key === "Escape" && !areaMenu.hidden) {
      setAreaMenuOpen(false, { restoreFocus: true });
      return;
    }

    if (event.key === "Escape" && state.launcherOpen) {
      dispatch({ type: "launcher.close" });
      launcherToggle.focus();
      return;
    }

    if (event.target === launcherQuery && state.launcherOpen) {
      const firstApp = appLauncher.querySelector("button:not(:disabled):not([hidden])");
      if (event.key === "ArrowDown" && firstApp) {
        firstApp.focus();
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && firstApp) {
        firstApp.click();
        event.preventDefault();
        return;
      }
    }

    if (!event.altKey || !isMovableWorkspace()) return;
    const deltas = {
      ArrowLeft: [-KEYBOARD_MOVE_STEP, 0],
      ArrowRight: [KEYBOARD_MOVE_STEP, 0],
      ArrowUp: [0, -KEYBOARD_MOVE_STEP],
      ArrowDown: [0, KEYBOARD_MOVE_STEP],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    const titlebar = event.target.closest("[data-window-titlebar]");
    const windowNode = titlebar?.closest("[data-window-id]");
    if (!titlebar || !windowNode || event.target.closest("[data-window-action]")) return;
    const area = getActiveArea(state);
    const windowState = area.windows.find((item) => item.id === windowNode.dataset.windowId);
    if (!windowState || windowState.maximized) return;

    const geometry = renderedGeometry(windowNode);
    const position = clampPosition(
      geometry.x + delta[0],
      geometry.y + delta[1],
      geometry.width,
      geometry.height,
    );
    dispatch({ type: "window.move", windowId: windowState.id, x: position.x, y: position.y });
    event.preventDefault();
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("dblclick", onDoubleClick);
  root.addEventListener("keydown", onKeyDown);
  nativeDock?.addEventListener("scroll", updateDockOverflow, { passive: true });
  nativeDock?.addEventListener("wheel", onNativeDockWheel, { passive: false });
  const nativeWindow = root.ownerDocument?.defaultView;
  nativeWindow?.addEventListener("resize", updateDockOverflow, { passive: true });
  updateDockOverflow();
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    const app = catalog.get(activation.appId);
    if (!catalog.isAvailable(app, state.capabilityIds)) return;
    dispatch({
      type: "app.launch",
      appId: activation.appId,
      target: activation.target,
    });
  });
  const unsubscribeHost = host.subscribe((snapshot) => dispatch({ type: "host.snapshot", snapshot }));
  render();

  return Object.freeze({
    schema: SURFACE_RENDER_LIFECYCLE_SCHEMA,
    preferences,
    localization,
    replaceAppCatalog(nextCatalog) {
      // Only trusted composition should hold this management method. External
      // runtimes receive a restricted SurfaceRenderLifecycle projection.
      const next = assertAppRuntimeCatalog(nextCatalog);
      if (next === catalog) return catalog.list();
      catalog = next;
      dispatch({ type: "app.catalog.sync" });
      return catalog.list();
    },
    getAppTarget(appId) {
      const area = getActiveArea(state);
      const windowState = area.windows.find((item) => item.appId === appId);
      return windowState?.target ?? null;
    },
    setAppTarget(appId, target) {
      dispatch({ type: "app.target", appId, target });
      const area = getActiveArea(state);
      const windowState = area.windows.find((item) => item.appId === appId);
      return windowState?.target ?? null;
    },
    subscribeRender(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Surface render listener must be a function");
      }
      renderListeners.add(listener);
      listener();
      return () => renderListeners.delete(listener);
    },
    destroy() {
      if (workspacePort) workspacePort.save(createWorkspaceSnapshot(state));
      sidebarFit.destroy();
      sidebarHints.destroy();
      desktopClock.destroy();
      localization.dispose();
      if (dragSession) {
        dragSession.titlebar.releasePointerCapture?.(dragSession.pointerId);
        dragSession = null;
      }
      unsubscribeHost?.();
      unsubscribeActivation?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
      root.removeEventListener("dblclick", onDoubleClick);
      root.removeEventListener("keydown", onKeyDown);
      nativeDock?.removeEventListener("scroll", updateDockOverflow);
      nativeDock?.removeEventListener("wheel", onNativeDockWheel);
      nativeWindow?.removeEventListener("resize", updateDockOverflow);
      unsubscribePreferencePersistence();
      preferencePersistence.dispose();
      preferenceListeners.clear();
      renderListeners.clear();
      delete root.dataset.ordaxTheme;
      delete root.dataset.ordaxContrast;
      delete root.dataset.ordaxMotion;
      delete root.dataset.ordaxDisplayScale;
      delete documentElement.dataset.ordaxTextScale;
      delete documentElement.dataset.ordaxDisplayScale;
      if (originalDocumentLanguage === null) {
        documentElement.removeAttribute("lang");
      } else {
        documentElement.setAttribute("lang", originalDocumentLanguage);
      }
      if (originalDocumentDirection === null) {
        documentElement.removeAttribute("dir");
      } else {
        documentElement.setAttribute("dir", originalDocumentDirection);
      }
      root.replaceChildren();
    },
  });
}
