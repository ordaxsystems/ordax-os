import { assertLocalizationPort } from "../../contracts/localization.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { assertNotificationsPort } from "../../contracts/notifications.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { createLocaleFormatting } from "../../services/i18n/formatting.mjs";
import { notificationSourceLabel } from "../../services/notifications/catalog.mjs";
import { notificationPresentationCopy } from "../../services/notifications/presentation.mjs";
import { resolveRegionalTimeZone } from "../../services/preferences/regional.mjs";

function requireHost(root, selector, label) {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Notification center requires ${label}`);
  }
  return element;
}

function ensureNotificationMarkup(root, translate) {
  if (root.querySelector("[data-notification-tray], [data-quick-panel='notifications']")) {
    throw new Error("Notification center is already mounted");
  }
  const documentRef = root.ownerDocument;
  const trayHost = requireHost(root, "[data-sidebar-notification-slot]", "sidebar notification host");
  const panelHost = requireHost(root, "[data-quick-panel-layer]", "quick-panel layer");

  const tray = documentRef.createElement("button");
  tray.type = "button";
  tray.className = "ordax-tray-item ordax-tray-notifications";
  tray.dataset.notificationTray = "";
  tray.dataset.quickPanelToggle = "notifications";
  tray.setAttribute("aria-expanded", "false");
  tray.setAttribute("aria-controls", "ordax-quick-notifications");
  tray.setAttribute("aria-label", translate("notifications.tray.none"));

  const icon = documentRef.createElement("span");
  icon.className = "ordax-tray-icon ordax-notification-bell";
  icon.setAttribute("aria-hidden", "true");
  const bellShape = documentRef.createElement("span");
  bellShape.className = "ordax-notification-bell-shape";
  icon.append(bellShape);

  const badge = documentRef.createElement("span");
  badge.className = "ordax-notification-badge";
  badge.dataset.notificationUnreadCount = "";
  badge.setAttribute("aria-hidden", "true");
  badge.hidden = true;
  tray.append(icon, badge);
  trayHost.replaceChildren(tray);

  const panel = documentRef.createElement("section");
  panel.id = "ordax-quick-notifications";
  panel.className = "ordax-quick-panel ordax-quick-panel-notifications";
  panel.dataset.quickPanel = "notifications";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "ordax-quick-notifications-title");
  panel.hidden = true;

  const header = documentRef.createElement("header");
  header.className = "ordax-quick-panel-header";
  const headingWrap = documentRef.createElement("div");
  const kicker = documentRef.createElement("span");
  kicker.className = "ordax-quick-kicker";
  const heading = documentRef.createElement("h2");
  heading.id = "ordax-quick-notifications-title";
  headingWrap.append(kicker, heading);
  const close = documentRef.createElement("button");
  close.type = "button";
  close.className = "ordax-quick-close";
  close.dataset.quickPanelClose = "";
  close.textContent = "×";
  header.append(headingWrap, close);

  const content = documentRef.createElement("div");
  content.dataset.notificationContent = "";
  panel.append(header, content);
  panelHost.prepend(panel);
  return Object.freeze({ tray, badge, panel, kicker, heading, close, content,
    remove() { panel.remove(); tray.remove(); },
  });
}

// One presentation consumes an optional authorized port; absence never creates a feed.
function createViewMarkup(root) {
  const documentRef = root.ownerDocument;
  const create = (tag, className, attribute = null) => {
    const node = documentRef.createElement(tag);
    node.className = className;
    if (attribute) node.setAttribute(attribute, "");
    return node;
  };
  const button = (attribute) => {
    const node = create("button", "ordax-notification-action", attribute);
    node.type = "button";
    return node;
  };
  const view = create("section", "ordax-notification-center", "data-notification-center");
  const summary = create("div", "ordax-notification-summary");
  const status = create("p", "ordax-notification-status", "data-notification-status");
  status.setAttribute("role", "status");
  const doNotDisturb = button("data-notification-do-not-disturb");
  doNotDisturb.setAttribute("aria-pressed", "false");
  summary.append(status, doNotDisturb);
  const filters = create("div", "ordax-notification-filters");
  filters.setAttribute("role", "group");
  const all = button("data-notification-filter");
  all.dataset.notificationFilter = "all";
  const unread = button("data-notification-filter");
  unread.dataset.notificationFilter = "unread";
  filters.append(all, unread);
  const scroll = create("div", "ordax-notification-scroll");
  const empty = create("p", "ordax-notification-empty", "data-notification-empty");
  const list = create("div", "ordax-notification-list", "data-notification-list");
  const error = create("p", "ordax-notification-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  scroll.append(empty, list);
  const footer = create("footer", "ordax-notification-footer");
  const actions = create("div", "ordax-notification-footer-actions");
  const markAllRead = button("data-notification-mark-all-read");
  const clearRead = button("data-notification-clear-read");
  actions.append(markAllRead, clearRead);
  const persistence = create("p", "ordax-notification-persistence", "data-notification-persistence");
  footer.append(actions, persistence);
  view.append(summary, filters, scroll, error, footer);
  root.append(view);
  return { view, filters, all, unread, status, list, empty, error, persistence, actions,
    doNotDisturb, markAllRead, clearRead };
}

function buildEntryNode(documentRef, entry) {
  const article = documentRef.createElement("article");
  article.className = "ordax-notification-entry";
  article.dataset.notificationId = entry.id;

  const header = documentRef.createElement("div");
  header.className = "ordax-notification-entry-header";
  const source = documentRef.createElement("span");
  source.dataset.notificationSource = "";
  source.className = "ordax-notification-source";
  const time = documentRef.createElement("time");
  time.dataset.notificationTime = "";
  time.className = "ordax-notification-time";
  const level = documentRef.createElement("span");
  level.className = "ordax-notification-level";
  level.dataset.notificationLevel = "";
  header.append(source, level, time);

  const title = documentRef.createElement("strong");
  title.dataset.notificationTitle = "";
  title.className = "ordax-notification-title";
  const message = documentRef.createElement("p");
  message.dataset.notificationMessage = "";
  message.className = "ordax-notification-message";

  const actions = documentRef.createElement("div");
  actions.className = "ordax-notification-actions";
  const open = documentRef.createElement("button");
  open.type = "button";
  open.className = "ordax-notification-action";
  open.dataset.notificationOpen = entry.id;
  const dismiss = documentRef.createElement("button");
  dismiss.type = "button";
  dismiss.className = "ordax-notification-action";
  dismiss.dataset.notificationDismiss = entry.id;
  const markRead = documentRef.createElement("button");
  markRead.type = "button";
  markRead.className = "ordax-notification-action";
  markRead.dataset.notificationMarkRead = entry.id;
  actions.append(open, markRead, dismiss);
  article.append(header, title, message, actions);
  return article;
}

function syncTimestamp(time, value, formatting, timeZone, translate) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    time.removeAttribute("datetime");
    time.textContent = translate("notifications.time.unavailable");
    return;
  }
  time.dateTime = date.toISOString();
  time.textContent = formatting.formatDate(date, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function updateEntryNode(node, entry, localization, formatting, timeZone) {
  const t = localization.translate;
  node.dataset.level = entry.level;
  node.dataset.read = String(entry.read);
  const source = node.querySelector("[data-notification-source]");
  const time = node.querySelector("[data-notification-time]");
  const title = node.querySelector("[data-notification-title]");
  const message = node.querySelector("[data-notification-message]");
  const open = node.querySelector("[data-notification-open]");
  const dismiss = node.querySelector("[data-notification-dismiss]");
  const markRead = node.querySelector("[data-notification-mark-read]");
  const copy = notificationPresentationCopy(entry, localization);
  source.textContent = notificationSourceLabel(entry.sourceId, t);
  node.querySelector("[data-notification-level]").textContent = t(`notifications.level.${entry.level}`);
  syncTimestamp(time, entry.createdAt, formatting, timeZone, t);
  title.textContent = copy.title;
  message.textContent = copy.message;
  open.textContent = t("notifications.action.open");
  dismiss.textContent = t("notifications.action.dismiss");
  dismiss.setAttribute("aria-label", t("notifications.action.dismissItem", { title: copy.title }));
  markRead.hidden = entry.read;
  markRead.textContent = t("notifications.action.markRead");
  markRead.setAttribute("aria-label", t("notifications.action.markReadItem", { title: copy.title }));
  if (entry.destination) {
    open.hidden = false;
    open.dataset.notificationOpen = entry.id;
    open.setAttribute(
      "aria-label",
      t("notifications.action.openDestination", { title: copy.title }),
    );
  } else {
    open.hidden = true;
    open.removeAttribute("aria-label");
  }
}

function trayAriaLabel(snapshot, translate) {
  const unread = snapshot.unreadCount;
  if (snapshot.doNotDisturb) {
    if (unread === 0) return translate("notifications.tray.dnd.none");
    if (unread === 1) return translate("notifications.tray.dnd.one");
    return translate("notifications.tray.dnd.many", { count: unread });
  }
  if (unread === 0) return translate("notifications.tray.none");
  if (unread === 1) return translate("notifications.tray.unread.one");
  return translate("notifications.tray.unread.many", { count: unread });
}

/**
 * @param {Element} root
 * @param {ReturnType<typeof assertNotificationsPort> | null} notifications
 * @param {ReturnType<typeof assertAppActivationPort> | null} appActivation
 * @param {{ preferences: ReturnType<typeof assertPreferenceRuntimePort>, localization: ReturnType<typeof assertLocalizationPort>, tray?: HTMLElement | null }} options
 */
export function mountNotificationCenterView(
  root,
  notifications,
  appActivation,
  { preferences: preferencePort, localization: localizationPort, tray = null },
) {
  if (!(root instanceof Element)) throw new TypeError("Notification view requires an Element");
  if (root.querySelector("[data-notification-center]")) throw new Error("Notification view already mounted");
  const center = notifications === null ? null : assertNotificationsPort(notifications);
  const activation = appActivation === null ? null : assertAppActivationPort(appActivation);
  const preferences = assertPreferenceRuntimePort(preferencePort);
  const localization = assertLocalizationPort(localizationPort);
  const formatting = createLocaleFormatting(localization);
  const t = localization.translate;
  const markup = createViewMarkup(root);
  const { view, list, empty, persistence, doNotDisturb, markAllRead, clearRead } = markup;
  const entryNodes = new Map();
  let snapshot = center?.getSnapshot() ?? null;
  let filter = "all";
  let destroyed = false;
  let observedTimeZone = resolveRegionalTimeZone(preferences.getSnapshot());

  const render = (nextSnapshot) => {
    if (destroyed) return;
    snapshot = nextSnapshot;
    const entries = snapshot?.entries ?? [];
    const unread = snapshot?.unreadCount ?? 0;
    const visible = entries.filter(entry => filter !== "unread" || !entry.read);
    const visibleIds = new Set(visible.map(entry => entry.id));
    const focused = root.ownerDocument.activeElement;
    const focusedEntry = focused?.closest("[data-notification-id]");
    const recoverFocus = view.contains(focusedEntry) && !visibleIds.has(focusedEntry.dataset.notificationId);
    for (const [id, node] of entryNodes) {
      if (visibleIds.has(id)) continue;
      node.remove(); entryNodes.delete(id);
    }
    let previousNode = null;
    for (const entry of visible) {
      let node = entryNodes.get(entry.id);
      if (!node) {
        node = buildEntryNode(root.ownerDocument, entry);
        entryNodes.set(entry.id, node);
      }
      updateEntryNode(node, entry, localization, formatting, observedTimeZone);
      node.querySelector("[data-notification-open]").disabled = activation === null;
      const expectedBefore = previousNode === null ? list.firstElementChild : previousNode.nextElementSibling;
      if (node !== expectedBefore) list.insertBefore(node, expectedBefore);
      previousNode = node;
    }
    view.dataset.availability = center ? "available" : "unavailable";
    markup.filters.hidden = center === null;
    markup.actions.hidden = center === null;
    doNotDisturb.hidden = center === null;
    markup.status.textContent = center === null
      ? t("notifications.center.unavailable")
      : t(snapshot.doNotDisturb ? "notifications.center.dnd" : "notifications.center.summary", { count: unread });
    markup.filters.setAttribute("aria-label", t("notifications.filter.label"));
    markup.all.textContent = t("notifications.filter.all", { count: entries.length });
    markup.unread.textContent = t("notifications.filter.unread", { count: unread });
    for (const button of [markup.all, markup.unread]) {
      button.setAttribute("aria-pressed", String(button.dataset.notificationFilter === filter));
      button.disabled = center === null;
    }
    empty.hidden = visible.length !== 0;
    empty.textContent = t(center === null ? "notifications.center.unavailableDetail"
      : filter === "unread" ? "notifications.center.emptyUnread" : "notifications.center.empty");
    doNotDisturb.disabled = center === null;
    doNotDisturb.setAttribute("aria-pressed", String(snapshot?.doNotDisturb ?? false));
    doNotDisturb.textContent = t(snapshot?.doNotDisturb ? "notifications.dnd.disable" : "notifications.dnd.enable");
    markAllRead.textContent = t("notifications.action.markAllRead");
    clearRead.textContent = t("notifications.action.clearRead");
    markAllRead.disabled = center === null || unread === 0;
    clearRead.disabled = center === null || !entries.some(entry => entry.read);
    persistence.textContent = snapshot === null ? t("notifications.persistence.unavailable")
      : `${t(snapshot.persistence === "device" ? "notifications.persistence.history.device" : "notifications.persistence.history.session")} · ${t(snapshot.policyPersistence === "device" ? "notifications.persistence.policy.device" : "notifications.persistence.policy.session")}`;
    if (tray) {
      const attentionVisible = unread > 0 && !snapshot.doNotDisturb;
      const badge = tray.querySelector("[data-notification-unread-count]");
      badge.hidden = !attentionVisible;
      badge.textContent = String(unread);
      tray.dataset.unread = String(attentionVisible);
      tray.dataset.doNotDisturb = String(snapshot?.doNotDisturb ?? false);
      tray.setAttribute("title", t("sidebar.notifications"));
      tray.setAttribute("aria-label", snapshot ? trayAriaLabel(snapshot, t) : t("notifications.center.unavailable"));
    }
    // Explicit actions keep keyboard focus when a filtered or dismissed row disappears.
    if (recoverFocus || (view.contains(focused) && (focused.hidden || focused.disabled))) {
      (list.querySelector("button:not([hidden]):not(:disabled)") ?? markup[filter === "unread" ? "unread" : "all"]).focus();
    }
  };

  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const filterButton = target?.closest("[data-notification-filter]");
    if (filterButton && view.contains(filterButton) && center) {
      filter = filterButton.dataset.notificationFilter;
      render(center.getSnapshot()); return;
    }
    if (!center) return;
    const button = target?.closest("button");
    if (!button || !view.contains(button) || button.disabled) return;
    markup.error.hidden = true;
    try {
      if (button.hasAttribute("data-notification-do-not-disturb")) center.setDoNotDisturb(!snapshot.doNotDisturb);
      else if (button.hasAttribute("data-notification-mark-all-read")) center.markAllRead();
      else if (button.hasAttribute("data-notification-clear-read")) center.clearRead();
      else if (button.hasAttribute("data-notification-dismiss")) center.dismiss(button.dataset.notificationDismiss);
      else if (button.hasAttribute("data-notification-mark-read")) center.markRead(button.dataset.notificationMarkRead);
      else if (button.hasAttribute("data-notification-open") && activation) {
        const entry = snapshot.entries.find(candidate => candidate.id === button.dataset.notificationOpen);
        if (!entry?.destination) return;
        activation.publish(entry.destination);
        center.markRead(entry.id);
        root.closest("[data-quick-panel]")?.querySelector("[data-quick-panel-close]")?.click();
      }
    } catch {
      markup.error.textContent = t("notifications.action.failed");
      markup.error.hidden = false;
    }
  };

  const unsubscribeNotifications = center?.subscribe(render);
  const unsubscribeLocalization = localization.subscribe(() => render(center?.getSnapshot() ?? null));
  const unsubscribePreferences = preferences.subscribe(preferenceSnapshot => {
    const nextTimeZone = resolveRegionalTimeZone(preferenceSnapshot);
    if (nextTimeZone !== observedTimeZone) { observedTimeZone = nextTimeZone; render(center?.getSnapshot() ?? null); }
  });
  view.addEventListener("click", onClick);
  render(snapshot);
  return Object.freeze({ destroy() {
    if (destroyed) return;
    destroyed = true;
    unsubscribeNotifications?.(); unsubscribeLocalization(); unsubscribePreferences();
    view.removeEventListener("click", onClick);
    entryNodes.clear(); view.remove();
  } });
}

export function mountNotificationCenterControls(root, notifications, appActivation, surfaceRuntime) {
  const center = notifications === null ? null : assertNotificationsPort(notifications);
  const activation = appActivation === null ? null : assertAppActivationPort(appActivation);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceRuntime);
  const preferences = assertPreferenceRuntimePort(surfaceRuntime.preferences);
  const t = lifecycle.localization.translate;
  const markup = ensureNotificationMarkup(root, t);
  const syncCopy = () => {
    markup.kicker.textContent = t("notifications.center.kicker");
    markup.heading.textContent = t("notifications.center.title");
    markup.close.setAttribute("aria-label", t("notifications.center.close"));
  };
  const unsubscribeLocalization = lifecycle.localization.subscribe(syncCopy);
  const view = mountNotificationCenterView(markup.content, center, activation, {
    preferences, localization: lifecycle.localization, tray: markup.tray,
  });
  const positionPanel = () => {
    const sidebar = root.querySelector(".ordax-product-sidebar");
    const edge = sidebar?.getBoundingClientRect().right ?? 0;
    markup.panel.style.setProperty("--notification-sidebar-edge", `${edge}px`);
  };
  const documentWindow = root.ownerDocument.defaultView;
  const sidebarObserver = documentWindow?.ResizeObserver ? new documentWindow.ResizeObserver(positionPanel) : null;
  const sidebar = root.querySelector(".ordax-product-sidebar");
  if (sidebar) sidebarObserver?.observe(sidebar);
  documentWindow?.addEventListener("resize", positionPanel);
  markup.panel.addEventListener("ordax:quick-panel-open", positionPanel);
  positionPanel();
  syncCopy();
  return Object.freeze({ destroy() {
    sidebarObserver?.disconnect();
    documentWindow?.removeEventListener("resize", positionPanel);
    markup.panel.removeEventListener("ordax:quick-panel-open", positionPanel);
    view.destroy(); unsubscribeLocalization(); markup.remove();
  } });
}
