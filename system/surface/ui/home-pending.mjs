import {
  assertNotificationsPort,
  validateNotificationsSnapshot,
} from "../../contracts/notifications.mjs";
import {
  assertSyncRuntimePort,
  validateSyncRuntimeSnapshot,
} from "../../contracts/sync-runtime.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { restoreHomeCollectionFocus } from "./home-collection-focus.mjs";

const MAX_HOME_PENDING_ITEMS = 2;

export function createHomePendingPresentation({
  notifications = null,
  syncRuntime = null,
} = {}) {
  const notificationsSnapshot = notifications === null
    ? null
    : validateNotificationsSnapshot(notifications);
  const syncSnapshot = syncRuntime === null
    ? null
    : validateSyncRuntimeSnapshot(syncRuntime);
  const items = [];

  if (notificationsSnapshot?.unreadCount > 0) {
    const unread = notificationsSnapshot.unreadCount;
    items.push(Object.freeze({
      key: "notifications",
      kind: "notifications",
      titleMessageId: unread === 1
        ? "home.pending.notifications.title.one"
        : "home.pending.notifications.title.many",
      titleParams: Object.freeze({ count: unread }),
      detailMessageIds: Object.freeze([
        "home.pending.notifications.detail.center",
        ...(notificationsSnapshot.doNotDisturb
          ? ["home.pending.notifications.detail.dnd"]
          : []),
        ...(notificationsSnapshot.persistence === "session"
          ? ["home.pending.notifications.detail.session"]
          : []),
      ]),
      actionMessageId: unread === 1
        ? "home.pending.notifications.action.one"
        : "home.pending.notifications.action.many",
      actionParams: Object.freeze({ count: unread }),
      actionKind: "quick-panel",
      panel: "notifications",
      appId: null,
      target: null,
    }));
  }

  if (syncSnapshot?.pendingMutationCount > 0) {
    const pending = syncSnapshot.pendingMutationCount;
    items.push(Object.freeze({
      key: "sync",
      kind: "sync",
      titleMessageId: pending === 1
        ? "home.pending.sync.title.one"
        : "home.pending.sync.title.many",
      titleParams: Object.freeze({ count: pending }),
      detailMessageIds: Object.freeze([
        syncSnapshot.transport === "available"
          ? "home.pending.sync.transport.available"
          : "home.pending.sync.transport.unavailable",
        syncSnapshot.accountContinuity === "active"
          ? "home.pending.sync.account.active"
          : "home.pending.sync.account.inactive",
        syncSnapshot.queuePersistence === "device"
          ? "home.pending.sync.queue.device"
          : "home.pending.sync.queue.session",
      ]),
      actionMessageId: "home.pending.sync.action",
      actionParams: Object.freeze({}),
      actionKind: "app",
      panel: null,
      appId: "account",
      target: "sync",
    }));
  }

  const boundedItems = items.slice(0, MAX_HOME_PENDING_ITEMS);
  return Object.freeze({
    visible: boundedItems.length > 0,
    items: Object.freeze(boundedItems),
  });
}

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function assertHomeRoot(root) {
  if (
    !root
    || typeof root !== "object"
    || typeof root.querySelector !== "function"
    || !root.ownerDocument
  ) {
    throw new TypeError("Home pending summary requires a Surface root");
  }
  return root;
}

function canonicalHomeSpace(homePanel) {
  return Array.from(homePanel.querySelectorAll(".ordax-space"))
    .find((element) => (
      element.dataset?.homeContinuation === undefined
      && element.dataset?.homePending === undefined
    )) ?? null;
}

export function mountHomePending(
  rootValue,
  { notifications = null, syncRuntime = null, surfaceLifecycle = null } = {},
) {
  const root = assertHomeRoot(rootValue);
  const notificationsPort = notifications === null ? null : assertNotificationsPort(notifications);
  const syncPort = syncRuntime === null ? null : assertSyncRuntimePort(syncRuntime);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const documentObject = root.ownerDocument;
  const homePanel = root.querySelector(".ordax-home-panel");
  const space = homePanel ? canonicalHomeSpace(homePanel) : null;
  if (!homePanel || !space) {
    throw new Error("Home pending summary requires the canonical Home panel");
  }

  let destroyed = false;
  let section = null;
  let renderedSignature = null;
  const render = () => {
    if (destroyed) return;
    // The current OS snapshots override event payloads: a delayed unread
    // notification or Sync callback must not resurrect cleared pending work.
    // createHomePendingPresentation performs the contract validation.
    const notificationsSnapshot = notificationsPort?.getSnapshot() ?? null;
    const syncSnapshot = syncPort?.getSnapshot() ?? null;
    const activeElement = documentObject.activeElement;
    const focusedWithin = section?.contains?.(activeElement) === true;
    const focusedKey = focusedWithin ? activeElement?.dataset?.homePendingKey ?? null : null;
    const presentation = createHomePendingPresentation({
      notifications: notificationsSnapshot,
      syncRuntime: syncSnapshot,
    });
    // Re-read current ports on every notification; skip identical two-card DOM.
    const nextSignature = JSON.stringify([presentation, localization.getLocale()]);
    if (nextSignature === renderedSignature && (
      presentation.visible ? section?.parentNode === homePanel : section === null
    )) return;

    if (!presentation.visible) {
      section?.remove();
      section = null;
      renderedSignature = nextSignature;
      restoreHomeCollectionFocus(homePanel, focusedWithin);
      return;
    }

    const next = node(documentObject, "section", "ordax-space");
    next.dataset.homePending = "";
    next.setAttribute("aria-labelledby", "ordax-home-pending-title");
    const heading = node(
      documentObject,
      "p",
      "ordax-section-kicker",
      t("home.pending.heading"),
    );
    heading.id = "ordax-home-pending-title";
    next.append(heading);

    for (const item of presentation.items) {
      const button = node(documentObject, "button", "ordax-space-link");
      button.type = "button";
      button.dataset.homePendingKey = item.key;
      button.setAttribute("aria-label", t(item.actionMessageId, item.actionParams));
      if (item.actionKind === "quick-panel") {
        button.dataset.quickPanelToggle = item.panel;
        if (item.panel === "notifications") {
          button.setAttribute("aria-controls", "ordax-quick-notifications");
        }
      } else {
        button.dataset.launchApp = item.appId;
        button.dataset.appTarget = item.target;
      }

      const marker = node(
        documentObject,
        "span",
        "ordax-space-icon",
        item.kind === "notifications" ? "N" : "S",
      );
      marker.setAttribute("aria-hidden", "true");
      const copy = node(documentObject, "span");
      copy.append(
        node(documentObject, "strong", "", t(item.titleMessageId, item.titleParams)),
        node(
          documentObject,
          "small",
          "",
          item.detailMessageIds.map((messageId) => t(messageId)).join(" · "),
        ),
      );
      const arrow = node(documentObject, "span", "ordax-space-arrow", "→");
      arrow.setAttribute("aria-hidden", "true");
      button.append(marker, copy, arrow);
      next.append(button);
    }

    if (section) section.replaceWith(next);
    else homePanel.insertBefore(next, space);
    section = next;
    renderedSignature = nextSignature;

    const target = focusedKey
      ? Array.from(section.querySelectorAll("[data-home-pending-key]"))
        .find((element) => element.dataset.homePendingKey === focusedKey) ?? null
      : null;
    restoreHomeCollectionFocus(homePanel, focusedWithin, target);
  };

  const unsubscribeNotifications = notificationsPort?.subscribe(() => {
    render();
  });
  const unsubscribeSync = syncPort?.subscribe(() => {
    render();
  });
  const unsubscribeLocalization = localization.subscribe(() => {
    renderedSignature = null;
    render();
  });

  render();

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeLocalization?.();
      unsubscribeSync?.();
      unsubscribeNotifications?.();
      section?.remove();
      section = null;
    },
  });
}
