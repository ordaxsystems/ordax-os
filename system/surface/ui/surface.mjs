import { mountNativeSidebarFit, sidebarIsExpanded, sidebarItemIsActive } from "./sidebar-layout.mjs";
import { mountSidebarHints } from "./sidebar-hints.mjs";
import { assertAppRuntimeCatalog, defaultAppRuntimeCatalog } from "../../apps/runtime-catalog.mjs";
import { externalAppCopy } from "../../apps/external-app-definition.mjs";
import { nativeHomeAssistantApp, nativeHomeInstalledApps, nativeNavigationInstalledApps } from "./application-presentations.mjs";
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
  getActiveSurfaceAppId,
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

// Search projection comes from the canonical catalog and current locale.
// It is neither a second app registry nor a persistent search service.
function normalizeNativeSearch(value, locale) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(locale).trim();
}

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

// Window chrome and panels remain mounted across Native workspace renders.
function syncText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}
function syncAttribute(node, name, value) {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function syncDataset(node, key, value) {
  const next = String(value);
  if (node.dataset[key] !== next) node.dataset[key] = next;
}

function syncHidden(node, value) {
  if (node.hidden !== value) node.hidden = value;
}

// A cosmetic preference cannot change the signed app catalog, capability
// grants, workspace areas or launcher search. Keep those DOM collections
// mounted; an open preference-choice panel still needs its selection updated.
function nativeRenderPlan(action, previousLocale, currentLocale, hasPreferenceChoices) {
  const preferenceOnly = action?.type === "preference.set" && previousLocale === currentLocale;
  const focusedWindow = action?.type === "window.focus";
  const movedWindow = action?.type === "window.move";
  return {
    catalog: !preferenceOnly && !focusedWindow && !movedWindow,
    windows: !preferenceOnly || hasPreferenceChoices,
    focusedWindow,
    movedWindow,
  };
}

// The host contract is fully validated by reduceSurfaceState before this
// check. Only connectivity can use a narrow render; an ordered capability
// change must still reconcile every authorized app and destination.
function isConnectivityOnlyHostUpdate(action, previous, next) {
  return action?.type === "host.snapshot"
    && previous.connectivity !== next.connectivity
    && previous.capabilityIds.length === next.capabilityIds.length
    && previous.capabilityIds.every((id, index) => id === next.capabilityIds[index]);
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
    // Focusable choices must survive ordinary window and host repaints.
    if (button.textContent !== option.label) button.textContent = option.label;
    if (button.dataset.preferenceId !== panel.preferenceId) button.dataset.preferenceId = panel.preferenceId;
    if (button.dataset.preferenceValue !== option.value) button.dataset.preferenceValue = option.value;
    const pressed = String(selected === option.value);
    if (button.dataset.selected !== pressed) button.dataset.selected = pressed;
    if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
    placeChildAt(choices, button, index);
    retained.add(button);
  }

  for (const child of Array.from(choices.children)) {
    if (!retained.has(child)) child.remove();
  }
}

function renderCapabilitiesPanel(section, state, localization) {
  const existing = section.querySelector("[data-surface-capabilities]");
  const empty = state.capabilityIds.length === 0;
  const expectedTag = empty ? "P" : "UL";
  let content = existing?.tagName === expectedTag ? existing : null;
  if (!content) {
    content = empty ? element("p", "ordax-empty") : element("ul", "ordax-capability-list");
    content.dataset.surfaceCapabilities = "";
    // Replace the previous presentation in place; keep its position before
    // the body and never tear down an unchanged capability list.
    if (existing) existing.replaceWith(content);
    else {
      const body = section.querySelector(".ordax-app-panel-body");
      if (body) section.insertBefore(content, body);
      else section.append(content);
    }
  }
  if (empty) {
    const label = localization.translate("surface.capability.none");
    if (content.textContent !== label) content.textContent = label;
    return;
  }
  const current = Array.from(content.children);
  const sameEntries = current.length === state.capabilityIds.length
    && current.every((item, index) => item.textContent === state.capabilityIds[index]);
  if (!sameEntries) {
    content.replaceChildren(...state.capabilityIds.map((id) => element("li", "", id)));
  }
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
  syncText(label, panelCopy(localization, app, index, "label"));
  syncText(title, panelCopy(localization, app, index, "title"));

  if (panel.kind === "extension") {
    section.dataset.appExtension = panel.extensionId;
    syncAttribute(section, "aria-label", panelCopy(localization, app, index, "title"));
    const body = section.querySelector(".ordax-app-panel-body");
    if (body && panel.body) {
      syncText(body, panelCopy(localization, app, index, "body"));
    }
    return;
  }

  if (panel.kind === "connectivity") {
    const badge = section.querySelector(".ordax-inline-status");
    if (badge) {
      const messageId =
        CONNECTIVITY_MESSAGE_IDS[state.connectivity] ?? CONNECTIVITY_MESSAGE_IDS.unknown;
      syncText(badge, localization.translate(messageId));
      badge.dataset.state = state.connectivity;
    }
  } else if (panel.kind === "capability") {
    const available = state.capabilityIds.includes(panel.capabilityId);
    const badge = section.querySelector(".ordax-inline-status");
    if (badge) {
      syncText(badge, capabilityState(
        state.capabilityIds,
        panel.capabilityId,
        localization,
      ));
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
    syncText(body, panelCopy(localization, app, index, "body"));
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
  if (windowNode.hidden !== windowState.minimized) windowNode.hidden = windowState.minimized;
  delete windowNode.dataset.dragging;

  const placementOrdinal = windowState.placementOrdinal ?? index + 1;
  const offset = state.presentation === "desktop"
    ? `${[-8, 8, -4, 4, 0][(placementOrdinal - 1) % 5]}%`
    : `${((placementOrdinal - 1) % 5) * 18}px`;
  if (windowNode.style.getPropertyValue("--ordax-window-offset") !== offset) {
    windowNode.style.setProperty("--ordax-window-offset", offset);
  }
  if (
    !windowState.maximized &&
    Number.isFinite(windowState.positionX) &&
    Number.isFinite(windowState.positionY)
  ) {
    if (windowNode.style.left !== `${windowState.positionX}px`) windowNode.style.left = `${windowState.positionX}px`;
    if (windowNode.style.top !== `${windowState.positionY}px`) windowNode.style.top = `${windowState.positionY}px`;
    if (windowNode.style.transform !== "none") windowNode.style.transform = "none";
    windowNode.dataset.positioned = "true";
  } else {
    if (windowNode.style.left) windowNode.style.removeProperty("left");
    if (windowNode.style.top) windowNode.style.removeProperty("top");
    if (windowNode.style.transform) windowNode.style.removeProperty("transform");
    delete windowNode.dataset.positioned;
  }

  const localizedTitle = appTitle(localization, app);
  const localizedDescription = appDescription(localization, app);
  syncAttribute(windowNode, "role", "region");
  syncAttribute(windowNode, "aria-label", localizedTitle);
  const titleGroup = windowNode.querySelector(".ordax-window-title-group");
  const titleNode = titleGroup?.querySelector("strong");
  const descriptionNode = titleGroup?.querySelector("small");
  syncText(titleNode, localizedTitle);
  syncText(descriptionNode, localizedDescription);
  const titlebar = windowNode.querySelector("[data-window-titlebar]");
  syncAttribute(
    titlebar, "aria-label",
    localization.translate("surface.window.move", { app: localizedTitle }),
  );

  for (const control of windowNode.querySelectorAll("[data-window-action]")) {
    control.dataset.windowId = windowState.id;
    const action = control.dataset.windowAction;
    if (action === "minimize") {
      syncAttribute(
        control, "aria-label",
        localization.translate("surface.window.minimize", { app: localizedTitle }),
      );
    }
    if (action === "maximize") {
      syncAttribute(
        control, "aria-label",
        localization.translate(
          windowState.maximized ? "surface.window.restore" : "surface.window.maximize",
          { app: localizedTitle },
        ),
      );
    }
    if (action === "close") {
      syncAttribute(
        control, "aria-label",
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
    const scrollLeft = nativeDock.scrollLeft;
    const remaining = Math.max(0, nativeDock.scrollWidth - nativeDock.clientWidth - scrollLeft);
    // Scroll/resize notifications must not rewrite unchanged DOM affordances.
    syncDataset(nativeDock, "scrollBefore", scrollLeft > 1);
    syncDataset(nativeDock, "scrollAfter", remaining > 1);
  };

  const onNativeDockWheel = (event) => scrollDockFromWheel(event, nativeDock);

  const revealDockButton = (button) => {
    if (!nativeDock || !button) return;
    const viewport = nativeDock.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    const scale = nativeDock.offsetWidth > 0 ? viewport.width / nativeDock.offsetWidth : 1;
    if (!(scale > 0)) return;
    const inset = 4 * scale;
    if (target.left < viewport.left + inset || target.width > viewport.width - inset * 2) {
      nativeDock.scrollLeft += (target.left - viewport.left - inset) / scale;
    } else if (target.right > viewport.right - inset) {
      nativeDock.scrollLeft += (target.right - viewport.right + inset) / scale;
    }
    updateDockOverflow();
  };

  const onDockFocus = (event) => revealDockButton(event.target.closest?.("button"));
  const onDockResize = () => {
    const focused = root.ownerDocument.activeElement;
    if (nativeDock?.contains(focused)) revealDockButton(focused.closest("button"));
    else updateDockOverflow();
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

  // Typing only filters the canonical rendered projection. Catalog, locale
  // and capability events still perform full reconciliation.
  const filterLauncher = (query = launcherQuery.value) => {
    const normalized = normalizeNativeSearch(query, localization.getLocale());
    let visible = 0;
    let total = 0;
    for (const button of appLauncher.children) {
      if (!button.dataset?.launchApp) continue;
      total += 1;
      const matches = !normalized || (button.dataset.launcherSearch ?? "").includes(normalized);
      syncHidden(button, !matches);
      if (matches) visible += 1;
    }
    let empty = appLauncher.querySelector("[data-launcher-empty]");
    if (visible === 0) {
      const message = localization.translate("surface.launcher.empty");
      if (!empty) {
        empty = element("p", "ordax-launcher-empty", message);
        empty.dataset.launcherEmpty = "";
      } else {
        syncText(empty, message);
      }
      placeChildAt(appLauncher, empty, total);
    } else {
      empty?.remove();
    }

    // A revoked or hidden choice must never retain keyboard focus.
    const active = root.ownerDocument.activeElement;
    if (active?.dataset?.launchApp && (active.hidden || active.disabled || !appLauncher.contains(active))) {
      launcherQuery.focus({ preventScroll: true });
    }
  };

  const renderLauncher = () => {
    const locale = localization.getLocale();
    const focusedLauncherApp = root.ownerDocument.activeElement?.dataset?.launchApp ?? null;
    const retained = new Set();
    const existingButtons = new Map();
    for (const child of appLauncher.children) {
      if (child.dataset?.launchApp && !existingButtons.has(child.dataset.launchApp)) {
        existingButtons.set(child.dataset.launchApp, child);
      }
    }

    for (const [index, app] of catalog.list().entries()) {
      const available = catalog.isAvailable(app, state.capabilityIds);
      const localizedTitle = appTitle(localization, app);
      const localizedDescription = appDescription(localization, app);
      let button = existingButtons.get(app.id) ?? null;
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

      // A disposable DOM search projection, rebuilt only from the canonical
      // catalog; it never stores permissions, user input or runtime state.
      const searchText = normalizeNativeSearch(localizedTitle + " " + localizedDescription + " " + app.id, locale);
      syncDataset(button, "launcherSearch", searchText);
      if (button.disabled !== !available) button.disabled = !available;
      syncAttribute(
        button, "aria-label",
        available
          ? localization.translate("surface.launcher.open", { app: localizedTitle })
          : localization.translate("surface.launcher.unavailable", { app: localizedTitle }),
      );
      const copy = button.querySelector(".ordax-launcher-app-copy");
      if (copy) {
        syncText(copy.querySelector("strong"), localizedTitle);
        syncText(copy.querySelector("small"),
          available ? localizedDescription : localization.translate("surface.launcher.requirementsUnavailable"));
      }
      placeChildAt(appLauncher, button, index);
      existingButtons.set(app.id, button);
      retained.add(button);
    }

    for (const child of Array.from(appLauncher.children)) {
      if (child.dataset?.launchApp && !retained.has(child)) child.remove();
    }

    filterLauncher(launcherQuery.value);
    if (focusedLauncherApp) {
      const focusedButton = existingButtons.get(focusedLauncherApp) ?? null;
      if (!focusedButton || !retained.has(focusedButton) || focusedButton.hidden || focusedButton.disabled) {
        launcherQuery.focus({ preventScroll: true });
      }
    }
  };

  const renderWindows = () => {
    const area = getActiveArea(state);
    const retained = new Set();
    const existingWindows = new Map();
    for (const node of windowLayer.children) {
      if (node.dataset.windowAreaId === area.id && !existingWindows.has(node.dataset.windowId)) {
        existingWindows.set(node.dataset.windowId, node);
      }
    }
    let renderedIndex = 0;
    let visibleIndex = 0;

    for (const windowState of area.windows) {
      const app = catalog.get(windowState.appId);
      if (!app) continue;
      const index = visibleIndex;
      if (!windowState.minimized) visibleIndex += 1;

      const existing = existingWindows.get(windowState.id);
      let windowNode = existing?.dataset.appId === app.id ? existing : null;
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

  // Focus only changes the active and previous windows; movement changes
  // one window. Recover through the full owner-driven reconciliation if a
  // trusted node was detached or its catalog identity no longer matches.
  const renderSelectedWindows = (windowIds) => {
    const area = getActiveArea(state);
    const wanted = new Set(windowIds.filter(Boolean));
    let visibleIndex = 0;
    let matched = 0;
    for (const windowState of area.windows) {
      const index = visibleIndex;
      if (!windowState.minimized) visibleIndex += 1;
      if (!wanted.has(windowState.id)) continue;
      const app = catalog.get(windowState.appId);
      const windowNode = findRenderedWindow(windowState.id);
      if (!app || !windowNode || windowNode.dataset.appId !== app.id) {
        renderWindows();
        return;
      }
      syncWindowNode(windowNode, app, windowState, state, index, area, localization);
      matched += 1;
    }
    if (matched !== wanted.size) renderWindows();
  };

  const renderDock = () => {
    const area = getActiveArea(state);
    const retained = new Set();
    const pinnedButtons = Array.from(root.querySelectorAll("[data-dock-pinned-app]"));
    const pinnedAppIds = new Set(pinnedButtons.map((button) => button.dataset.dockPinnedApp));
    // A pinned app selects its first active-area window. Index once rather
    // than scanning every window for every pinned control on focus events.
    const firstWindowByAppId = new Map();
    for (const windowState of area.windows) {
      if (!firstWindowByAppId.has(windowState.appId)) {
        firstWindowByAppId.set(windowState.appId, windowState);
      }
    }
    const existingRunningButtons = new Map();
    for (const child of runningApps.children) {
      if (child.dataset?.openWindow && !existingRunningButtons.has(child.dataset.openWindow)) {
        existingRunningButtons.set(child.dataset.openWindow, child);
      }
    }
    for (const button of pinnedButtons) {
      const appId = button.dataset.dockPinnedApp;
      const app = catalog.get(appId);
      const windowState = firstWindowByAppId.get(appId) ?? null;
      if (!app) {
        syncHidden(button, true);
        continue;
      }
      syncHidden(button, false);
      const localizedTitle = appTitle(localization, app);
      if (windowState) {
        syncDataset(button, "openWindow", windowState.id);
        syncDataset(button, "active", area.activeWindowId === windowState.id && !windowState.minimized);
        syncDataset(button, "minimized", windowState.minimized);
        if (button.hasAttribute("data-launch-app")) button.removeAttribute("data-launch-app");
        const actionLabel = localization.translate(
          windowState.minimized ? "surface.dock.restore" : "surface.dock.focus",
          { app: localizedTitle },
        );
        syncAttribute(button, "aria-label", actionLabel);
        const title = localizedTitle + " · " + actionLabel;
        if (button.title !== title) button.title = title;
        if (button.dataset.active === "true") syncAttribute(button, "aria-current", "true");
        else if (button.hasAttribute("aria-current")) button.removeAttribute("aria-current");
      } else {
        if ("openWindow" in button.dataset) delete button.dataset.openWindow;
        if ("active" in button.dataset) delete button.dataset.active;
        if ("minimized" in button.dataset) delete button.dataset.minimized;
        syncDataset(button, "launchApp", appId);
        syncAttribute(button, "aria-label", localization.translate("surface.launcher.open", { app: localizedTitle }));
        if (button.title !== localizedTitle) button.title = localizedTitle;
        if (button.hasAttribute("aria-current")) button.removeAttribute("aria-current");
      }
    }
    let index = 0;
    for (const windowState of area.windows) {
      const app = catalog.get(windowState.appId);
      if (!app) continue;
      if (pinnedAppIds.has(app.id)) continue;
      let button = existingRunningButtons.get(windowState.id) ?? null;
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
      // Preserve the icon subtree on ordinary focus/window state changes.
      if (ICONS[app.id]) {
        if (icon.innerHTML !== ICONS[app.id]) icon.innerHTML = ICONS[app.id];
      } else if (icon.textContent !== app.monogram) {
        icon.textContent = app.monogram;
      }
      syncDataset(button, "active", area.activeWindowId === windowState.id && !windowState.minimized);
      // Preserve the explicit Native/OS minimized projection while avoiding
      // a mutation when focus changes without changing window visibility.
      if (button.dataset.minimized !== String(windowState.minimized)) {
        button.dataset.minimized = String(windowState.minimized);
      }
      if (button.dataset.active === "true") syncAttribute(button, "aria-current", "true");
      else if (button.hasAttribute("aria-current")) button.removeAttribute("aria-current");
      const localizedTitle = appTitle(localization, app);
      syncAttribute(
        button,
        "aria-label",
        localization.translate(
          windowState.minimized ? "surface.dock.restore" : "surface.dock.focus",
          { app: localizedTitle },
        ),
      );
      if (button.title !== localizedTitle) button.title = localizedTitle;
      placeChildAt(runningApps, button, index);
      index += 1;
      retained.add(button);
    }
    for (const child of Array.from(runningApps.children)) {
      if (child.dataset?.openWindow && !retained.has(child)) child.remove();
    }
    updateDockOverflow();
  };

  const renderHomeAssistant = () => {
    const button = root.querySelector("[data-native-home-assistant]");
    if (!button) return;
    const app = nativeHomeAssistantApp(catalog, state.capabilityIds);
    const labelNode = button.querySelector("[data-native-home-assistant-label]");
    if (!app) {
      // Fail closed before clearing the route. A repeated missing or revoked
      // app must not toggle the element or rewrite empty metadata.
      if (!button.disabled) button.disabled = true;
      syncHidden(button, true);
      if (button.hasAttribute("data-launch-app")) button.removeAttribute("data-launch-app");
      if (button.hasAttribute("aria-label")) button.removeAttribute("aria-label");
      if (button.hasAttribute("title")) button.removeAttribute("title");
      syncText(labelNode, "");
      return;
    }
    const label = appTitle(localization, app);
    // The catalog remains the only authority for this action. Set its route
    // before making the control visible and enabled.
    if (button.dataset.launchApp !== app.id) button.dataset.launchApp = app.id;
    syncAttribute(button, "aria-label", localization.translate("surface.launcher.open", { app: label }));
    if (button.title !== label) button.title = label;
    syncText(labelNode, label);
    if (button.disabled) button.disabled = false;
    syncHidden(button, false);
  };

  const renderHomeInstalledApps = () => {
    const grid = root.querySelector(".ordax-home-action-grid");
    const addAppButton = grid?.querySelector(".ordax-home-add-app");
    if (!grid || !addAppButton) return;
    const installed = nativeHomeInstalledApps(catalog, state.capabilityIds);
    const retained = new Set();
    const existingButtons = new Map(
      Array.from(grid.querySelectorAll("[data-native-home-installed-app]"))
        .map((button) => [button.dataset.nativeHomeInstalledApp, button]),
    );
    for (const app of installed) {
      let button = existingButtons.get(app.id) ?? null;
      if (!button) {
        button = element("button", "ordax-home-action");
        button.type = "button";
        button.dataset.nativeHomeInstalledApp = app.id;
        const icon = element("span", "ordax-rail-icon");
        icon.setAttribute("aria-hidden", "true");
        button.append(icon, element("span", "ordax-home-installed-app-label"));
        addAppButton.before(button);
        existingButtons.set(app.id, button);
      }
      // Every shortcut goes through the same catalog availability check as
      // the launcher. Text comes from installed presentation metadata only.
      const label = appTitle(localization, app);
      if (button.dataset.launchApp !== app.id) button.dataset.launchApp = app.id;
      const icon = button.querySelector(".ordax-rail-icon");
      if (icon.textContent !== app.monogram) icon.textContent = app.monogram;
      const titleNode = button.querySelector(".ordax-home-installed-app-label");
      if (titleNode.textContent !== label) titleNode.textContent = label;
      const ariaLabel = localization.translate("surface.launcher.open", { app: label });
      if (button.getAttribute?.("aria-label") !== ariaLabel) button.setAttribute("aria-label", ariaLabel);
      if (button.title !== label) button.title = label;
      retained.add(button);
    }
    for (const button of grid.querySelectorAll("[data-native-home-installed-app]")) {
      if (retained.has(button)) continue;
      if (button.contains(root.ownerDocument.activeElement)) {
        addAppButton.focus({ preventScroll: true });
      }
      button.remove();
    }
  };

  const renderNativeNavigationInstalledApps = () => {
    const slot = navigationMenu.querySelector("[data-native-navigation-installed-apps]");
    if (!slot) return;
    const installed = nativeNavigationInstalledApps(catalog, state.capabilityIds);
    const retained = new Set();
    const existingButtons = new Map();
    for (const button of slot.children) {
      if (button.dataset?.nativeNavigationInstalledApp) {
        existingButtons.set(button.dataset.nativeNavigationInstalledApp, button);
      }
    }
    for (const app of installed) {
      let button = existingButtons.get(app.id) ?? null;
      if (!button) {
        button = element("button", "meridian-menu-item");
        button.type = "button";
        button.dataset.navMenuItem = "";
        button.dataset.nativeNavigationInstalledApp = app.id;
        const monogram = element("span", "ordax-rail-icon");
        monogram.setAttribute("aria-hidden", "true");
        button.append(monogram, element("span", "ordax-nav-installed-app-label"));
        slot.append(button);
        existingButtons.set(app.id, button);
      }
      const label = appTitle(localization, app);
      if (button.dataset.launchApp !== app.id) button.dataset.launchApp = app.id;
      if (button.dataset.navMenuApp !== app.id) button.dataset.navMenuApp = app.id;
      const icon = button.querySelector(".ordax-rail-icon");
      if (icon.textContent !== app.monogram) icon.textContent = app.monogram;
      const titleNode = button.querySelector(".ordax-nav-installed-app-label");
      if (titleNode.textContent !== label) titleNode.textContent = label;
      const ariaLabel = localization.translate("surface.launcher.open", { app: label });
      if (button.getAttribute?.("aria-label") !== ariaLabel) button.setAttribute("aria-label", ariaLabel);
      if (button.title !== label) button.title = label;
      retained.add(button);
    }
    for (const button of Array.from(slot.children)) {
      if (retained.has(button)) continue;
      if (button.contains(root.ownerDocument.activeElement)) {
        navigationQuery.focus({ preventScroll: true });
      }
      button.remove();
    }
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
    const existingButtons = new Map();
    for (const child of areaSwitcher.children) {
      if (child.dataset?.areaId) existingButtons.set(child.dataset.areaId, child);
    }
    let index = 0;
    for (const area of state.areas) {
      const active = area.id === state.activeAreaId;
      let button = existingButtons.get(area.id) ?? null;
      if (!button) {
        button = element("button", "ordax-area-button");
        button.type = "button";
        button.dataset.areaId = area.id;
      }
      const label = areaLabel(area, localization);
      // textContent removes descendants. Only reset it when the localized
      // label changes, so the focused button and active dot survive repaint.
      if (button.dataset.areaLabel !== label) {
        button.textContent = label;
        button.dataset.areaLabel = label;
      }
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "true" : "false");
      button.setAttribute(
        "aria-label",
        localization.translate("surface.area.switch", { area: label }),
      );
      const dot = button.querySelector(".ordax-area-dot");
      if (active && !dot) {
        const nextDot = element("span", "ordax-area-dot");
        nextDot.setAttribute("aria-hidden", "true");
        button.prepend(nextDot);
      } else if (!active) {
        dot?.remove();
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

  // Keep status presentation in one owner-owned function for full and
  // connectivity-only updates. Native network detail remains authoritative.
  const syncConnectivityPresentation = () => {
    const message = CONNECTIVITY_MESSAGE_IDS[state.connectivity] ?? CONNECTIVITY_MESSAGE_IDS.unknown;
    const label = localization.translate(message);
    const tray = root.querySelector("[data-connectivity-tray]");
    if (tray.dataset.networkDetailOwner !== "true") {
      syncText(root.querySelector("[data-connectivity-label]"), label);
      const connectivityIcon = root.querySelector("[data-connectivity-icon]");
      if (connectivityIcon.dataset.state !== state.connectivity) {
        connectivityIcon.dataset.state = state.connectivity;
      }
      syncDataset(connectivityIcon, "networkKind", "unknown");
      syncDataset(connectivityIcon, "signalLevel", "0");
      const title = localization.translate("surface.network.label", { status: label });
      if (tray.title !== title) tray.title = title;
    }
    return label;
  };

  // Opening and closing this overlay changes no catalog, grant, workspace
  // or preference state. Keep its aria-expanded and visibility in one owner,
  // used on both full reconciliation and the narrow toggle path.
  const syncLauncherVisibility = () => {
    syncHidden(launcher, !state.launcherOpen);
    root.querySelectorAll("[data-launcher-toggle]").forEach((button) =>
      syncAttribute(button, "aria-expanded", String(state.launcherOpen)),
    );
  };

  // Only the rail geometry and its toggle change on workspace.sidebar.
  // Keep the one canonical projection shared by full and narrow renders.
  const syncSidebarPresentation = () => {
    syncDataset(root, "nativeSidebar", state.sidebarMode);
    const sidebarToggle = root.querySelector("[data-sidebar-toggle]");
    const sidebarExpanded = sidebarIsExpanded(root.querySelector(".ordax-rail"));
    syncHidden(sidebarToggle, state.presentation === "desktop");
    syncDesktopSidebarToggle(sidebarToggle, sidebarExpanded, localization);
  };

  const notifyRenderListeners = () => {
    for (const listener of [...renderListeners]) listener();
  };

  const renderSidebarModeOnly = () => {
    syncSidebarPresentation();
    // A different rail width may alter available dock space. The existing
    // ResizeObserver still owns fitting the navigation destinations.
    updateDockOverflow();
    notifyRenderListeners();
  };

  const renderLauncherVisibilityOnly = () => {
    syncLauncherVisibility();
    notifyRenderListeners();
  };

  const renderConnectivityOnly = () => {
    const label = syncConnectivityPresentation();
    // Mounted connectivity panels are the only window content that depends
    // on this host-only change. Do not rescan app windows or rebuild panels.
    for (const badge of windowLayer.querySelectorAll(
      '[data-surface-panel-kind="connectivity"] .ordax-inline-status',
    )) {
      syncText(badge, label);
      syncDataset(badge, "state", state.connectivity);
    }
    notifyRenderListeners();
  };

  const render = (action = null, previousLocale = null, previousActiveWindowId = null) => {
    const currentLocale = localization.getLocale();
    const unchangedLocalePreference = action?.type === "preference.set" && previousLocale === currentLocale;
    const hasPreferenceChoices = unchangedLocalePreference
      && getActiveArea(state).windows.some((windowState) =>
        catalog.get(windowState.appId)?.panels?.some((panel) => panel.kind === "preference-choice"),
      );
    const renderPlan = nativeRenderPlan(action, previousLocale, currentLocale, hasPreferenceChoices);
    syncDocumentLocaleProfile(documentElement, localization);
    syncDesktopShellLocalization(root, localization);
    const appearance = resolveColorAppearance(state.preferences);
    syncDataset(root, "ordaxTheme", appearance.scheme);
    syncDataset(root, "theme", appearance.colorTheme);
    syncDataset(root, "ordaxPalette", appearance.colorTheme === "native" ? "native" : "standard");
    const themeToggle = root.querySelector("[data-native-theme-toggle]");
    if (themeToggle) {
      syncDesktopThemeToggle(themeToggle, appearance, localization);
    }
    syncDataset(root, "workspacePresentation", state.presentation);
    syncDataset(root, "view", state.presentation);
    const shell = root.querySelector("[data-ordax-shell]");
    if (shell) {
      syncDataset(shell, "workspacePresentation", state.presentation);
      syncDataset(shell, "view", state.presentation);
    }
    syncSidebarPresentation();
    syncHidden(root.querySelector("[data-central-presentation]"), state.presentation !== "central");
    syncHidden(root.querySelector("[data-desktop-presentation]"), state.presentation !== "desktop");
    const presentationToggle = root.querySelector("[data-presentation-toggle]");
    syncDesktopPresentationToggle(presentationToggle, state.presentation, localization);
    syncDataset(root, "ordaxContrast", state.preferences[ACCESSIBILITY_CONTRAST_PREFERENCE_ID]);
    syncDataset(root, "ordaxMotion", state.preferences[ACCESSIBILITY_MOTION_PREFERENCE_ID]);
    syncDataset(documentElement, "ordaxTextScale", state.preferences[ACCESSIBILITY_TEXT_SCALE_PREFERENCE_ID]);
    syncDataset(documentElement, "ordaxDisplayScale", state.preferences[DISPLAY_SCALE_PREFERENCE_ID]);
    syncDataset(root, "ordaxDisplayScale", state.preferences[DISPLAY_SCALE_PREFERENCE_ID]);
    syncLauncherVisibility();
    root.querySelectorAll("[data-navigation-menu-toggle]").forEach(button => syncAttribute(button, "aria-expanded", String(!navigationMenu.hidden)));
    const moreDestinations = root.querySelector("[data-nav-menu-more]");
    if (moreDestinations) {
      const label = localization.translate("shell.sidebar.more");
      syncAttribute(moreDestinations, "aria-label", label);
      if (moreDestinations.title !== label) moreDestinations.title = label;
      const labelNode = moreDestinations.querySelector("span:last-child");
      syncText(labelNode, label);
    }

    syncConnectivityPresentation();

    for (const targetButton of root.querySelectorAll("[data-requires-capability]")) {
      const capabilityId = targetButton.dataset.requiresCapability;
      const available = state.capabilityIds.includes(capabilityId);
      if (targetButton.disabled !== !available) targetButton.disabled = !available;
      syncAttribute(targetButton, "aria-disabled", String(!available));
      const requirementTitle = available ? "" : localization.translate("surface.capability.destinationRequired");
      if (targetButton.title !== requirementTitle) targetButton.title = requirementTitle;
    }

    if (renderPlan.catalog) renderNativeNavigationInstalledApps();
    if (renderPlan.catalog || renderPlan.focusedWindow) {
      const activeArea = getActiveArea(state);
      const activeNavigationWindow = activeArea.windows.find(item => item.id === activeArea.activeWindowId) ?? null;
      for (const targetButton of navigationMenu.querySelectorAll("[data-nav-menu-app]")) {
        if (renderPlan.catalog) {
          const app = catalog.get(targetButton.dataset.navMenuApp);
          const available = catalog.isAvailable(app, state.capabilityIds);
          if (targetButton.disabled !== !available) targetButton.disabled = !available;
          syncAttribute(targetButton, "aria-disabled", String(!available));
        }
        syncDataset(targetButton, "active", activeNavigationWindow?.appId === targetButton.dataset.navMenuApp);
      }
    }
    if (renderPlan.catalog) renderLauncher();

    if (renderPlan.movedWindow) {
      renderSelectedWindows([action.windowId]);
    } else if (renderPlan.focusedWindow) {
      renderSelectedWindows([previousActiveWindowId, action.windowId]);
    } else if (renderPlan.windows) {
      renderWindows();
    }
    if (renderPlan.catalog || renderPlan.focusedWindow) {
      renderDock();
      renderSidebar();
    }
    if (renderPlan.catalog) {
      renderHomeAssistant();
      renderHomeInstalledApps();
      renderAreas();
      if (!navigationMenu.hidden) filterNativeNavigation(navigationQuery.value);
    } else if (!renderPlan.movedWindow && !renderPlan.focusedWindow) {
      // Preference-driven display scale can change dock geometry through CSS.
      updateDockOverflow();
    }
    // Native extension controllers must still observe every state update.
    notifyRenderListeners();
  };

  const dispatch = (action) => {
    const previousState = state;
    const previousPreferences = state.preferences;
    const previousLocale = action?.type === "preference.set" ? localization.getLocale() : null;
    const previousActiveWindowId = action?.type === "window.focus" ? getActiveArea(state).activeWindowId : null;
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
    if (action?.type === "launcher.toggle" || action?.type === "launcher.close") {
      renderLauncherVisibilityOnly();
    } else if (action?.type === "workspace.sidebar") {
      renderSidebarModeOnly();
    } else if (isConnectivityOnlyHostUpdate(action, previousState, state)) {
      renderConnectivityOnly();
    } else {
      render(action, previousLocale, previousActiveWindowId);
    }
    if (preferencesChanged) {
      for (const listener of [...preferenceListeners]) listener(state.preferences);
    }
  };

  let launcherOpener = null;
  const openLauncher = (trigger = null) => {
    launcherOpener = trigger instanceof HTMLElement ? trigger : null;
    if (!state.launcherOpen) dispatch({ type: "launcher.toggle" });
    queueMicrotask(() => {
      if (state.launcherOpen) {
        launcherQuery.focus({ preventScroll: true });
        launcherQuery.select();
      }
    });
  };
  let navigationMenuTrigger = null;
  const openNativeNavigation = (trigger = document.activeElement) => {
    // The launcher and Ctrl+K are alternate entry points to the same
    // app catalog. Never leave both transient overlays open together.
    if (state.launcherOpen) dispatch({ type: "launcher.close" });
    if (!areaMenu.hidden) setAreaMenuOpen(false);
    if (!navigationMenu.hidden) {
      // Repeating Ctrl+K should return to the search field, not erase a
      // partially typed query or replace the original Escape focus target.
      navigationQuery.focus({ preventScroll: true });
      return;
    }
    navigationMenuTrigger = trigger instanceof HTMLElement ? trigger : null;
    navigationQuery.value = "";
    filterNativeNavigation("");
    navigationMenu.hidden = false;
    root.querySelectorAll("[data-navigation-menu-toggle]").forEach(button => button.setAttribute("aria-expanded", "true"));
    queueMicrotask(() => {
      if (!navigationMenu.hidden) navigationQuery.focus({ preventScroll: true });
    });
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
    const normalized = normalizeNativeSearch(query, locale);
    const visibleGroups = new Set();
    for (const button of navigationMenu.querySelectorAll("[data-nav-menu-item]")) {
      const hidden = normalized !== "" && !normalizeNativeSearch(button.textContent, locale).includes(normalized);
      syncHidden(button, hidden);
      if (!hidden) {
        const group = button.closest("[data-nav-menu-group]");
        if (group) visibleGroups.add(group);
      }
    }
    // One group pass, without a nested selector for every keypress.
    for (const group of navigationMenu.querySelectorAll("[data-nav-menu-group]")) {
      syncHidden(group, !visibleGroups.has(group));
    }
    const empty = navigationMenu.querySelector("[data-native-navigation-empty]");
    if (empty) {
      syncText(empty, locale.toLowerCase().startsWith("en")
        ? "No destinations or apps found."
        : "Nenhum destino ou aplicativo encontrado.");
      syncHidden(empty, visibleGroups.size > 0);
    }
    // Search and capability revocation must not strand a focused item.
    const focused = root.ownerDocument.activeElement;
    if (!navigationMenu.hidden && focused?.matches?.("[data-nav-menu-item]")
      && (focused.hidden || focused.disabled || focused.closest("[data-nav-menu-group]")?.hidden)) {
      navigationQuery.focus({ preventScroll: true });
    }
  };

  const handleNativeNavigationArrow = (event) => {
    if (navigationMenu.hidden || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return false;
    const current = event.target.closest?.("[data-nav-menu-item]") ?? null;
    if (event.target !== navigationQuery && !current) return false;
    const results = Array.from(navigationMenu.querySelectorAll(
      "[data-nav-menu-item]:not([hidden]):not(:disabled)",
    )).filter(button => !button.closest("[data-nav-menu-group]")?.hidden);
    if (results.length === 0) return false;
    const index = results.indexOf(current);
    if (current && index < 0) return false;
    const next = event.target === navigationQuery
      ? event.key === "ArrowDown" ? results[0] : results.at(-1)
      : event.key === "ArrowDown"
        ? results[index + 1] ?? navigationQuery
        : results[index - 1] ?? navigationQuery;
    next.focus({ preventScroll: true });
    event.preventDefault();
    return true;
  };

  const focusActiveWindowOrWorkspace = () => {
    const activeId = getActiveArea(state).activeWindowId;
    const titlebar = activeId ? findRenderedWindow(activeId)?.querySelector("[data-window-titlebar]") : null;
    (titlebar ?? workspace).focus({ preventScroll: true });
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
        openLauncher(launcherButton);
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
        if (state.launcherOpen) dispatch({ type: "launcher.close" });
      } else {
        dispatch({ type: "app.launch", appId, maximized: state.presentation !== "desktop" });
        focusActiveWindowOrWorkspace();
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
      const windowId = runningButton.dataset.openWindow;
      const area = getActiveArea(state);
      const active = area.activeWindowId === windowId
        && area.windows.some((item) => item.id === windowId && !item.minimized);
      dispatch({ type: active ? "window.minimize" : "window.focus", windowId });
      focusActiveWindowOrWorkspace();
      return;
    }

    const control = event.target.closest("[data-window-action]");
    if (control) {
      const action = control.dataset.windowAction;
      dispatch({ type: `window.${action}`, windowId: control.dataset.windowId });
      if (action === "minimize" || action === "close") focusActiveWindowOrWorkspace();
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
    if (event.target === launcherQuery) filterLauncher(launcherQuery.value);
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
      // Rounded coordinates can be unchanged; cleanup must not depend on a
      // reducer commit or a subsequent render.
      delete current.node.dataset.dragging;
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

  const handleLauncherKeyboard = (event) => {
    if (!state.launcherOpen || !launcher.contains(event.target)) return false;
    if (event.target !== launcherQuery && !appLauncher.contains(event.target)) return false;
    const options = Array.from(appLauncher.querySelectorAll("button:not(:disabled):not([hidden])"))
      .filter(button => !button.closest("[hidden]"));
    if (event.target === launcherQuery && event.key === "Enter" && options.length > 0) {
      event.preventDefault();
      options[0].click();
      return true;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
    // Home and End are normal text cursor commands while the search has focus.
    if (event.target === launcherQuery && (event.key === "Home" || event.key === "End")) {
      return false;
    }
    if (options.length === 0) return false;
    const current = options.indexOf(root.ownerDocument.activeElement);
    let index;
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = options.length - 1;
    else if (event.key === "ArrowUp") {
      index = current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length;
    } else {
      index = current < 0 ? 0 : (current + 1) % options.length;
    }
    event.preventDefault();
    options[index].focus({ preventScroll: true });
    options[index].scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
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
      event.preventDefault();
      closeNativeNavigation({ restoreFocus: true });
      return;
    }

    if (handleNativeNavigationArrow(event)) return;

    if (event.key === "Escape" && !areaMenu.hidden) {
      setAreaMenuOpen(false, { restoreFocus: true });
      return;
    }

    if (event.key === "Escape" && state.launcherOpen
        && (launcher.contains(event.target) || launcherOpener?.contains(event.target))) {
      event.preventDefault();
      dispatch({ type: "launcher.close" });
      // Other transient interfaces may own focus now. Restore only a
      // mounted visible opener; never jump into a hidden sidebar item.
      const opener = launcherOpener?.isConnected && !launcherOpener.hidden
        && !launcherOpener.disabled && !launcherOpener.closest("[hidden]")
        ? launcherOpener : workspace;
      opener.focus({ preventScroll: true });
      return;
    }

    if (event.target === navigationQuery && !navigationMenu.hidden
      && event.key === "Enter") {
      const first = Array.from(navigationMenu.querySelectorAll(
        "[data-nav-menu-item]:not([hidden]):not(:disabled)",
      )).find((button) => !button.closest("[data-nav-menu-group]")?.hidden);
      if (first) {
        first.click();
        event.preventDefault();
        return;
      }
    }

    if (handleLauncherKeyboard(event)) return;

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
  nativeDock?.addEventListener("focusin", onDockFocus);
  const nativeWindow = root.ownerDocument?.defaultView;
  const DockObserver = nativeWindow?.ResizeObserver;
  const dockObserver = typeof DockObserver === "function" ? new DockObserver(onDockResize) : null;
  if (nativeDock) {
    dockObserver?.observe(nativeDock);
    for (const child of nativeDock.children) dockObserver?.observe(child);
  }
  nativeWindow?.addEventListener("resize", onDockResize, { passive: true });
  updateDockOverflow();
  const unsubscribeActivation = activationPort?.subscribe((activation) => {
    const app = catalog.get(activation.appId);
    if (!catalog.isAvailable(app, state.capabilityIds)) return;
    dispatch({
      type: "app.launch",
      appId: activation.appId,
      target: activation.target,
      maximized: state.presentation !== "desktop",
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
    /** Read-only OS presentation projection shared by Native Intelligence and MCP.
     * No DOM traversal, host credentials, or window instance IDs escape here. */
    getActiveAppId() {
      return getActiveSurfaceAppId(state);
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
      nativeDock?.removeEventListener("focusin", onDockFocus);
      dockObserver?.disconnect();
      nativeWindow?.removeEventListener("resize", onDockResize);
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
